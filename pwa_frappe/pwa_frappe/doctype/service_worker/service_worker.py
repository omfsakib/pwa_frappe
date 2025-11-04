# Copyright (c) 2021, Md Omar Faruk and contributors
# For license information, please see license.txt

import base64

import frappe
from cryptography.hazmat.primitives import serialization
from frappe.model.document import Document
from py_vapid import Vapid01


class ServiceWorker(Document):
	@frappe.whitelist()
	def generate_vapid_key(self, event="vapid_progress_bar"):
		frappe.publish_realtime(event, {"progress": "0"}, user=frappe.session.user)

		try:
			# Generate new VAPID key pair
			vapid = Vapid01()
			vapid.generate_keys()

			# Export the public key as raw bytes (Uncompressed Point format)
			public_bytes = vapid.public_key.public_bytes(
				encoding=serialization.Encoding.X962,
				format=serialization.PublicFormat.UncompressedPoint,
			)

			# Export the private key as raw bytes
			private_bytes = vapid.private_key.private_bytes(
				encoding=serialization.Encoding.DER,
				format=serialization.PrivateFormat.PKCS8,
				encryption_algorithm=serialization.NoEncryption(),
			)

			# Encode to Base64 (URL-safe)
			public_key = base64.urlsafe_b64encode(public_bytes).decode("utf-8")
			private_key = base64.urlsafe_b64encode(private_bytes).decode("utf-8")

			# Save in the document (make sure fields exist)
			self.vapid_public_key = public_key
			self.vapid_private_key = private_key
			self.save(ignore_permissions=True)

			frappe.publish_realtime(event, {"progress": "100"}, user=frappe.session.user)

			return {
				"message": "VAPID key pair generated successfully",
				"public_key": public_key,
				"private_key": private_key,
			}

		except Exception as e:
			frappe.log_error(frappe.get_traceback(), "VAPID Key Generation Failed")
			frappe.publish_realtime(event, {"progress": "error"}, user=frappe.session.user)
			frappe.throw(f"Error generating VAPID keys: {str(e)}")
