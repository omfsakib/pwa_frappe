
// Service Worker
var CACHE_NAME = 'frappe-cache-v{{ sw_version }}';

var urlsToCache = [
    '/',
    '/manifest.json',
    '{{ (favicon or "/assets/frappe/images/favicon.png") | abs_url }}',
    // CSS
    '/assets/frappe/css/bootstrap.css',
    '/assets/css/frappe-web.css',
    '/website_theme.css',
    {%- for link in web_include_css %}
    '{{ link|abs_url }}',
    {%- endfor %}
    // JS
    '/assets/frappe/js/lib/bootstrap.min.js',
    '/assets/frappe/js/lib/socket.io.min.js',
    '/assets/frappe/js/lib/jquery/jquery.min.js',
    '/assets/js/frappe-web.min.js',
	{%- for link in web_include_js %}
    '{{ link|abs_url }}',
    {%- endfor %}
];

// Install stage sets up the index page (home page) in the cache and opens a new cache
this.addEventListener('install', function (event) {
    console.log('[SW] Install Event processing');

    // Perform install steps
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                console.log('[SW] Installing cache ' + CACHE_NAME);
                return cache.addAll(urlsToCache)
                    .catch(function (err) {
                        console.log('[SW] Cache install Failed: ' + err);
                    });
            }).catch(function (err) {
                console.error(event.request.url, err);
                console.log('[SW] Install Failed: ' + err);
            })
    );
});

// If any fetch fails, it will look for the request in the cache and serve it from there first
this.addEventListener('fetch', function (event) {
    event.respondWith(
        caches.match(event.request)
            .then(function (response) {
                if (!response) {
                    return handleNoCacheMatch(event);
                }
                // Update cache record in the background
                fetchFromNetworkAndCache(event);
                // Reply with stale data
                return response
            })
    );
});

// When activating the Service Worker, clear older caches
this.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                clearCache(key);
            }));
        }));
});

// FCM config is passed as a query param when the service worker is registered
// (see public/js/fcm.js). When present, Firebase Messaging owns 'push' handling.
var fcmConfigParam = new URL(location).searchParams.get('config');

// Respond to 'push' events and trigger notifications on the registration
// Skipped when FCM is active to avoid double-handling FCM push payloads.
this.addEventListener('push', function (event) {
    if (fcmConfigParam) {
        return;
    }
    let title = (event.data && event.data.text());
    let tag = "push-frappe-notification";
    let icon = '{{ (favicon or "/assets/frappe/images/favicon.png") | abs_url }}';

    event.waitUntil(
        self.registration.showNotification(title, { icon, tag })
    );
});

// --- Firebase Cloud Messaging (background push) ---
try {
    if (fcmConfigParam) {
        importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
        importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

        firebase.initializeApp(JSON.parse(fcmConfigParam));
        var fcmMessaging = firebase.messaging();

        fcmMessaging.onBackgroundMessage(function (payload) {
            var data = payload.data || {};
            var notificationTitle = data.title || 'Notification';
            var notificationOptions = { body: data.body || '' };
            if (data.notification_icon) {
                notificationOptions.icon = data.notification_icon;
            }
            if (data.click_action) {
                notificationOptions.data = { url: data.click_action };
            }
            self.registration.showNotification(notificationTitle, notificationOptions);
        });
    }
} catch (err) {
    console.error('[SW] Failed to initialize Firebase Cloud Messaging', err);
}

this.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var url = event.notification.data && event.notification.data.url;
    if (url) {
        event.waitUntil(clients.openWindow(url));
    }
});


function fetchFromNetworkAndCache(event) {
    // DevTools opening will trigger these o-i-c requests, which this SW can't handle.
    // There's probaly more going on here, but I'd rather just ignore this problem. :)
    // https://github.com/paulirish/caltrainschedule.io/issues/49
    if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
        return;
    }

    return fetch(event.request).then(function (res) {
        // foreign requests may be res.type === 'opaque' and missing a url
        if (!res.url) {
            return res;
        }
        // Only cache GET requests
        if (event.request.method !== 'GET') {
            return res;
        }
        // regardless, we don't want to cache other origin's assets
        if (new URL(res.url).origin !== location.origin) {
            return res;
        }

        // If request was success, add or update it in the cache
        updateCache(event.request, res.clone());
        // TODO: figure out if the content is new and therefore the page needs a reload.

        return res;
    }).catch(function (err) {
        console.error(event.request.url, err);
        console.log('[SW] Network request Failed. Serving content from cache: ' + err);
        return fromCache(event.request);
    });
}

function handleNoCacheMatch(event) {
    return fetchFromNetworkAndCache(event);
}

function fromCache(request) {
    // Check to see if you have it in the cache
    // Return response
    // If not in the cache, then return error page
    return caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(request).then(function (matching) {
            if (!matching || matching.status === 404) {
                return Promise.reject("no-match");
            }

            return matching;
        });
    });
}

function updateCache(request, response) {
    return caches.open(CACHE_NAME).then(function (cache) {
        return cache.put(request, response);
    });
}

function clearCache(key) {
    if (key !== CACHE_NAME) {
        console.log('[SW] Cleaning cache ' + key);
        return caches.delete(key);
    }
}
