# Copyright (c) 2026, Md Omar Faruk and contributors
# For license information, please see license.txt

import json
import time

import frappe
from frappe import _
from frappe.utils import get_url, get_url_to_form, strip_html

NOTIFICATION_TYPE_TITLES = {
	"Mention": "New Mention",
	"Assignment": "Assignment Update",
	"Share": "Document Shared With You",
	"Energy Point": "Energy Point Update",
	"Alert": "Alert",
}


def get_fcm_settings():
	return frappe.get_cached_doc("Service Worker")


def get_default_icon():
	settings = frappe.get_cached_doc("Website Settings")
	if settings.favicon and settings.favicon != "attach_files:":
		return get_url(settings.favicon)
	return get_url("/assets/frappe/images/favicon.png")


@frappe.whitelist()
def get_fcm_config() -> dict:
	"""Returns the Firebase Web configuration and VAPID public key for the client SDK."""
	settings = get_fcm_settings()
	if not settings.enable_fcm:
		frappe.throw(_("FCM push notifications are not enabled on this site"))

	if not settings.fcm_web_config or not settings.fcm_vapid_public_key:
		frappe.throw(
			_(
				"FCM is not configured on this site. Please set the FCM Web Config and "
				"VAPID Public Key in Service Worker settings."
			)
		)

	try:
		config = json.loads(settings.fcm_web_config)
	except ValueError:
		frappe.throw(_("FCM Web Config must be valid JSON"))

	return {"config": config, "vapid_public_key": settings.fcm_vapid_public_key}


@frappe.whitelist()
def subscribe(fcm_token: str) -> dict:
	"""Registers the current user's FCM token so they can receive push notifications."""
	if not fcm_token:
		frappe.throw(_("fcm_token is required"))

	user = frappe.session.user
	if frappe.db.exists("FCM User Token", {"user": user, "fcm_token": fcm_token}):
		return {"success": True, "message": "Already subscribed"}

	frappe.get_doc({"doctype": "FCM User Token", "user": user, "fcm_token": fcm_token}).insert(
		ignore_permissions=True
	)
	frappe.db.commit()  # nosemgrep
	return {"success": True, "message": "Subscribed"}


@frappe.whitelist()
def unsubscribe(fcm_token: str) -> dict:
	"""Removes the current user's FCM token."""
	if not fcm_token:
		frappe.throw(_("fcm_token is required"))

	frappe.db.delete("FCM User Token", {"user": frappe.session.user, "fcm_token": fcm_token})
	frappe.db.commit()  # nosemgrep
	return {"success": True, "message": "Unsubscribed"}


def send_push_notification(doc, method=None):
	"""Triggered after a new Notification Log is created; relays it to the target user via FCM."""
	try:
		settings = get_fcm_settings()
		if not settings.enable_fcm:
			return

		service_account_json = settings.get_password("fcm_service_account_json", raise_exception=False)
		if not service_account_json:
			return

		title = NOTIFICATION_TYPE_TITLES.get(doc.type, "New Notification")
		body = strip_html(doc.subject or "")[:200]

		if doc.link:
			link = get_url(doc.link)
		elif doc.document_type and doc.document_name:
			link = get_url(get_url_to_form(doc.document_type, doc.document_name))
		else:
			link = get_url("/app")

		send_direct_fcm(
			service_account_json=service_account_json,
			user_id=doc.for_user,
			title=title,
			body=body,
			link=link,
			icon=get_default_icon(),
		)
	except Exception:
		frappe.log_error(
			title="PWA FCM Push Notification Failed",
			message=f"Failed to send push notification for Notification Log '{doc.name}': {frappe.get_traceback()}",
		)


def get_fcm_access_token(service_account_info: dict) -> str:
	import jwt
	import requests

	private_key = service_account_info["private_key"]
	client_email = service_account_info["client_email"]
	token_url = "https://oauth2.googleapis.com/token"

	now = int(time.time())
	payload = {
		"iss": client_email,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud": token_url,
		"exp": now + 3600,
		"iat": now,
	}

	if isinstance(private_key, str):
		private_key = private_key.replace("\\n", "\n")

	signed_jwt = jwt.encode(payload, private_key, algorithm="RS256", headers={"alg": "RS256", "typ": "JWT"})

	response = requests.post(
		token_url,
		data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": signed_jwt},
	)
	response.raise_for_status()
	return response.json()["access_token"]


def send_direct_fcm(
	service_account_json: str,
	user_id: str,
	title: str,
	body: str,
	link: str | None = None,
	icon: str | None = None,
) -> bool:
	"""Sends a push notification directly to Google FCM (HTTP v1 API) using service account credentials."""
	import requests

	try:
		service_account = json.loads(service_account_json)
	except ValueError:
		frappe.log_error("PWA FCM: fcm_service_account_json is not valid JSON")
		return False

	tokens = frappe.get_all("FCM User Token", filters={"user": user_id}, fields=["name", "fcm_token"])
	if not tokens:
		return False

	try:
		access_token = get_fcm_access_token(service_account)
	except Exception:
		frappe.log_error(
			title="PWA FCM: Failed to get access token from Google", message=frappe.get_traceback()
		)
		return False

	project_id = service_account.get("project_id")
	url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
	headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

	success_count = 0
	for token_row in tokens:
		data_payload = {"title": title, "body": body}
		if link:
			data_payload["click_action"] = link
		if icon:
			data_payload["notification_icon"] = icon

		payload = {"message": {"token": token_row.fcm_token, "data": data_payload}}
		try:
			res = requests.post(url, json=payload, headers=headers)
			if res.status_code == 200:
				success_count += 1
			elif res.status_code == 404 or "UNREGISTERED" in res.text:
				frappe.delete_doc(
					"FCM User Token", token_row.name, ignore_permissions=True, delete_permanently=True
				)
				frappe.db.commit()  # nosemgrep
			else:
				frappe.log_error(f"PWA FCM: Google API responded with {res.status_code}: {res.text}")
		except Exception:
			frappe.log_error(title="PWA FCM: Failed to send to a token", message=frappe.get_traceback())

	return success_count > 0


@frappe.whitelist()
def test_push_notification(user: str | None = None):
	"""Helper to send a test Notification Log entry to verify the FCM pipeline end-to-end.

	Usage: bench --site [site-name] execute pwa_frappe.fcm.test_push_notification --args "['Administrator']"
	"""
	user = user or frappe.session.user
	doc = frappe.get_doc(
		{
			"doctype": "Notification Log",
			"for_user": user,
			"from_user": "Administrator",
			"type": "Alert",
			"subject": "This is a test push notification from pwa_frappe FCM integration.",
		}
	)
	doc.insert(ignore_permissions=True)
	return f"Test Notification Log '{doc.name}' created for {user}"
