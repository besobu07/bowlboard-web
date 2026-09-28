/* BowlBoard offline support: keeps the app itself on the phone so it opens at the
 * lanes with no signal. Your games are stored separately (localStorage/IndexedDB)
 * and are never touched here. build.py stamps VERSION so each deploy refreshes. */
const VERSION = '78c4b50303';
const CACHE = 'bowlboard-' + VERSION;
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/score.js', './js/data.js', './js/store.js', './js/league.js', './js/sample.js', './js/charts.js', './js/app.js', './js/league-ui.js',
  './logo.jpg', './logo-icon.jpg', './favicon.png', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('bowlboard-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-origin GETs: answer from the cache straight away, refresh it in the background.
// Page loads fall back to the cached app when offline. Other sites (the photo-scan
// library) go to the network as normal.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
