/* Val Thorens map — offline service worker v3 (guides/sw-vt.js).
   Install precaches the APP SHELL (map page, data JSON, Leaflet JS/CSS), so an
   offline reload works — v1 cached only tiles + data and the page could never
   come back offline. Runtime: cache-first for tiles, data and shell — cache-or-network
   only, nothing is stored at runtime (B9: only an explicit save writes tiles,
   so the cache never grows unboundedly or goes stale). activate() deletes only
   this resort's own old caches (prefix match) — visiting one resort never
   wipes another's offline map. To ship a map-page update, bump CACHE below so clients
   re-install and re-precache the fresh shell. */
const CACHE = 'vt-map-v3';
const PREFIX = 'vt-';
const SHELL = [
  '/guides/map-val-thorens',
  '/guides/map-val-thorens.html',
  '/guides/data/val-thorens.json',
  '/guides/sf-tokens.css',
  '/guides/map-shared.css',
  '/guides/map-shared.js',
  '/guides/favicon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of SHELL) {
      try {
        const res = await fetch(url, { mode: url.startsWith('http') ? 'no-cors' : 'same-origin' });
        if (res.ok || res.type === 'opaque') await cache.put(url, res);
      } catch (err) { /* skipped: saveOffline() on the page retries the shell */ }
    }
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isTile = url.includes('tile.openstreetmap.org/') || url.includes('tiles.opensnowmap.org/pistes/');
  const isData = url.includes('/guides/data/val-thorens.json');
  const isShell = url.includes('/guides/map-val-thorens') || url.includes('unpkg.com/leaflet@1.9.4/') || url.includes('/guides/sf-tokens.css') || url.includes('/guides/map-shared.') || url.includes('/guides/favicon.svg');
  if (!isTile && !isData && !isShell) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;
    try {
      return await fetch(e.request); // cache-or-network only: no runtime put (B9)
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
