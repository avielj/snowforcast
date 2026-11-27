/* Alpe d'Huez map — offline service worker v2 (guides/sw-alpe.js).
   Install precaches the APP SHELL (map page, data JSON, Leaflet JS/CSS), so an
   offline reload works — v1 cached only tiles + data and the page could never
   come back offline. Runtime: cache-first for tiles, data and shell; anything
   fetched while online is stored (so tiles at z16+ the user actually views are
   cached too). To ship a map-page update, bump CACHE below so clients
   re-install and re-precache the fresh shell. */
const CACHE = 'adh-map-v2';
const SHELL = [
  '/guides/map-alpe-d-huez',
  '/guides/map-alpe-d-huez.html',
  '/guides/data/alpe-d-huez.json',
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
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isTile = url.includes('tile.openstreetmap.org/') || url.includes('tiles.opensnowmap.org/pistes/');
  const isData = url.includes('/guides/data/alpe-d-huez.json');
  const isShell = url.includes('/guides/map-alpe-d-huez') || url.includes('unpkg.com/leaflet@1.9.4/');
  if (!isTile && !isData && !isShell) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
