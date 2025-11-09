document.addEventListener("DOMContentLoaded", function () {
	if (!frappe || !frappe.db || !frappe.db.get_single_value) {
		console.warn("[PWA] frappe.db not available yet.");
		return;
	}

	frappe.db
		.get_single_value("Web App Manifest", "configure_desk")
		.then((r) => {
			if (r && (r === 1 || r === "1" || r === true)) {
				if (!document.querySelector('link[rel="manifest"]')) {
					const manifestLink = document.createElement("link");
					manifestLink.rel = "manifest";
					manifestLink.href = "/manifest.json";
					document.head.appendChild(manifestLink);
					console.log("[PWA] Manifest added dynamically.");
				} else {
					console.log("[PWA] Manifest already exists.");
				}
			} else {
				console.log("[PWA] configure_desk is disabled.");
			}
		})
		.catch((err) => {
			console.error("[PWA] Failed to fetch configure_desk:", err);
		});
});
