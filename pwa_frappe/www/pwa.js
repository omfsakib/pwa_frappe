function showPrompt(buttonText, messageText, f) {
	const $btn = $(`<button class="pwa-next-action"><span>${__(buttonText)}</span></button>`);
	const next_action_container = $(`<div class="pwa-next-action-container"></div>`);
	$btn.click(() => f());
	next_action_container.append($btn);
	showPwaAlert({
		message: messageText,
		body: next_action_container,
		indicator: "green",
	});
	$(".btn-pwa-install")
		.click(() => f())
		.show();
}

function showPwaAlert(message, seconds = 7) {
	if (typeof message === "string") {
		message = {
			message: message,
		};
	}
	if (!$("#pwa-dialog-container").length) {
		$('<div id="pwa-dialog-container"><div id="pwa-alert-container"></div></div>').appendTo(
			"body"
		);
	}

	const div = $(`
		<div class="pwa-alert pwa-desk-alert">
			<div class="pwa-alert-message"></div>
			<div class="pwa-alert-body" style="display: none"></div>
			<a class="pwa-close">&times;</a>
		</div>`);

	let pwaMessage = div.find(".pwa-alert-message");
	pwaMessage.append(message.message);

	if (message.indicator) {
		pwaMessage.addClass("indicator " + message.indicator);
	}

	if (message.body) {
		div.find(".pwa-alert-body").show().html(message.body);
	}

	div.hide().appendTo("#pwa-alert-container").show().css("transform", "translateX(0)");

	div.find(".pwa-close, button").click(function () {
		div.remove();
		return false;
	});

	div.delay(seconds * 1000).fadeOut(300);
	return div;
}

function addToHomeScreen(event) {
	// Show the prompt
	hideAddToHomeScreen();

	if (installPromptEvent === null) {
		console.log("[PWA] No A2HS event to trigger for this device");
	} else {
		installPromptEvent.prompt();

		// Wait for the user to respond to the prompt
		installPromptEvent.userChoice.then(function (choiceResult) {
			if (choiceResult.outcome === "accepted") {
				console.log("[PWA] User accepted the A2HS prompt");
			} else {
				console.log("[PWA] User dismissed the A2HS prompt");
			}
			installPromptEvent = null;
		});
	}
}

function showAddToHomeScreen(event) {
	if (installPromptEvent === null) {
		console.log("[PWA] No A2HS event stored for this device");
	} else {
		if (window.location.pathname === "/install") {
			// show to user prompt with PWA installation
			showPrompt(
				'{{ _("Install") }}',
				'{{ _("Do you want to install PWA?") }}',
				addToHomeScreen
			);
		} else {
			// show to user prompt with Install Page redirection
			showPrompt(
				'{{ _("Go to Install Page") }}',
				'{{ _("This device supports PWA") }}',
				function () {
					window.location.href = "/install";
				}
			);
		}
	}
}

function hideAddToHomeScreen(event) {
	$("#pwa-alert-container").hide();
	$(".btn-pwa-install").hide();
}

function pushNotification(message) {
	navigator.serviceWorker.ready.then(function (serviceWorkerRegistration) {
		serviceWorkerRegistration.pushManager.getSubscription().then(function (subscription) {
			$.post("/push", {
				subscription: subscription.toJSON(),
				message: message,
			});
		});
	});
}

let installPromptEvent = null;

const vapidKey = "{{ vapid_public_key }}";

/**
 * Convert a base64 public key to a Uint8Array (required by PushManager)
 */
function urlBase64ToUint8Array(base64String) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

if ("serviceWorker" in navigator) {
	if (vapidKey) {
		console.log("[PWA] Set VAPID key for push notifications");
		window.vapidPublicKey = urlBase64ToUint8Array(vapidKey);
	}

	window.addEventListener("load", function () {
		// Register the Service Worker
		navigator.serviceWorker
			.register("/sw.js")
			.then(function (registration) {
				console.log(
					"[PWA] ServiceWorker registration successful with scope: " + registration.scope
				);

				if (window.vapidPublicKey) {
					console.log("[PWA] Subscribing to push notifications...");

					registration.pushManager
						.subscribe({
							userVisibleOnly: true,
							applicationServerKey: window.vapidPublicKey,
						})
						.then(function (subscription) {
							console.log("[PWA] Push subscription successful");
							console.log("Endpoint:", subscription.endpoint);
							console.log("Subscription:", subscription);
						})
						.catch(function (error) {
							console.error("[PWA] Push subscription failed:", error);
						});
				}
			})
			.catch(function (err) {
				console.error("[PWA] ServiceWorker registration failed:", err);
			});
	});

	window.addEventListener("beforeinstallprompt", function (e) {
		e.preventDefault();
		installPromptEvent = e;
		console.log("[PWA] Application could be installed");
		showAddToHomeScreen();
	});

	window.addEventListener("appinstalled", hideAddToHomeScreen);

	if (window.vapidPublicKey) {
		if (!("Notification" in window)) {
			console.error("[PWA] This browser does not support desktop notification");
		} else if (Notification.permission === "granted") {
			console.log("[PWA] Permission to receive notifications has been granted");
		} else if (Notification.permission !== "denied") {
			Notification.requestPermission(function (permission) {
				if (permission === "granted") {
					console.log("[PWA] Permission to receive notifications has been granted");
				}
			});
		}
	}
} else if (window.location.protocol !== "https:") {
	console.warn("[PWA] Requires secure HTTPS connection");
} else {
	console.warn("[PWA] No Service Worker support on your device");
}
