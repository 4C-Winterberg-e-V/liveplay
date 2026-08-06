// Deliberately a pass-through service worker: it has a fetch handler and caches
// nothing.
//
// The reason is not laziness. LivePlay's client is useless without its C++ audio
// engine — every cue, meter and transport action goes over HTTP+WebSocket to the
// server — so an offline app shell would boot into a screen that can do nothing.
// Worse, a cached shell is a real hazard here: the client and the server speak a
// versioned protocol, and serving yesterday's bundle against today's engine is a
// failure that would surface mid-show. Network-only means the phone always runs
// the build the host is actually serving.
//
// What it IS for: a registered service worker with a fetch handler is part of
// Chrome's installability criteria, and installing is what removes the browser's
// URL bar — worth 60-90px of cue list on a phone. That is the whole job.
//
// Note it can only ever register over HTTPS (the Cloudflare tunnel) or on
// localhost. The LAN share serves plain http://<host>:8088, where service
// workers are not allowed; see the registration plugin, which does not even try.

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every tab to close — there is
  // no cache to migrate, so there is nothing an old worker is protecting.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clean up after any earlier caching version of this worker, so an upgrade
    // can never leave stale entries behind.
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Straight to the network. Present so the app is installable; intentionally not
// a caching layer.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
