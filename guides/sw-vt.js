/* Val Thorens map — offline service worker (guides/sw-vt.js).
   Cache-first for the map data JSON and OSM / OpenSnowMap tiles that the
   user saved with "שמור מפה לאופליין". Nothing else is intercepted. */
const CACHE = 'vt-map-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isTile = url.includes('tile.openstreetmap.org/') || url.includes('tiles.opensnowmap.org/pistes/');
  const isData = url.includes('/guides/data/val-thorens.json');
  if (!isTile && !isData) return;
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
