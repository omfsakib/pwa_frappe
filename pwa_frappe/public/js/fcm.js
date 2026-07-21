// Copyright (c) 2026, Md Omar Faruk and contributors
// For license information, please see license.txt
//
// Registers the browser for Firebase Cloud Messaging (FCM) push notifications
// and subscribes the current desk user's token, so `Notification Log` entries
// created by `pwa_frappe.fcm.send_push_notification` can reach them even when
// the desk tab is closed.

/* global firebase */

(function () {
	const FIREBASE_SDK_VERSION = "10.8.0";
	const TOKEN_STORAGE_KEY = "pwa_frappe_fcm_token";

	function loadScript(src) {
		return new Promise(function (resolve, reject) {
			if (document.querySelector('script[src="' + src + '"]')) {
				resolve();
				return;
			}
			const script = document.createElement("script");
			script.src = src;
			script.onload = resolve;
			script.onerror = reject;
			document.head.appendChild(script);
		});
	}

	function loadFirebaseCompatSdk() {
		const base = "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/";
		return loadScript(base + "firebase-app-compat.js").then(function () {
			return loadScript(base + "firebase-messaging-compat.js");
		});
	}

	function fetchFcmConfig() {
		return frappe.xcall("pwa_frappe.fcm.get_fcm_config");
	}

	function showForegroundNotification(payload) {
		const data = payload.data || {};
		const title = data.title || "Notification";
		const options = { body: data.body || "" };
		if (data.notification_icon) {
			options.icon = data.notification_icon;
		}
		if (!("Notification" in window) || Notification.permission !== "granted") {
			return;
		}
		const notification = new Notification(title, options);
		if (data.click_action) {
			notification.onclick = function () {
				window.open(data.click_action, "_blank");
			};
		}
	}

	function initializeFcm() {
		if (!("serviceWorker" in navigator) || !("Notification" in window)) {
			return;
		}

		fetchFcmConfig()
			.then(function (fcmSettings) {
				if (!fcmSettings || !fcmSettings.config || !fcmSettings.vapid_public_key) {
					return;
				}

				return loadFirebaseCompatSdk().then(function () {
					const encodedConfig = encodeURIComponent(JSON.stringify(fcmSettings.config));
					return navigator.serviceWorker
						.register("/sw.js?config=" + encodedConfig)
						.then(function (registration) {
							return Notification.requestPermission().then(function (permission) {
								if (permission !== "granted") {
									return;
								}

								firebase.initializeApp(fcmSettings.config);
								const messaging = firebase.messaging();

								return messaging
									.getToken({
										vapidKey: fcmSettings.vapid_public_key,
										serviceWorkerRegistration: registration,
									})
									.then(function (token) {
										if (!token) {
											return;
										}
										messaging.onMessage(showForegroundNotification);
										if (localStorage.getItem(TOKEN_STORAGE_KEY) === token) {
											return;
										}
										return frappe
											.xcall("pwa_frappe.fcm.subscribe", {
												fcm_token: token,
											})
											.then(function () {
												localStorage.setItem(TOKEN_STORAGE_KEY, token);
											});
									});
							});
						});
				});
			})
			.catch(function (err) {
				// FCM not configured/enabled on this site, or the browser denied permission.
				console.log("[FCM] Push notifications not initialized:", err.message || err);
			});
	}

	document.addEventListener("DOMContentLoaded", function () {
		if (typeof frappe === "undefined" || !frappe.session || frappe.session.user === "Guest") {
			return;
		}
		initializeFcm();
	});
})();
