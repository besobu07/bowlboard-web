/* BowlBoard offline support: keeps the app itself on the phone so it opens at the
 * lanes with no signal. Your games are stored separately (localStorage/IndexedDB)
 * and are never touched here. build.py stamps VERSION so each deploy refreshes. */
const VERSION = '2a3c4bd5cd';
const CACHE = 'bowlboard-' + VERSION;
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/score.js',
  './js/data.js',
  './js/ball-list.js',
  './js/store.js',
  './js/config.js',
  './js/account.js',
  './js/league.js',
  './js/xlsx.js',
  './js/games-import.js',
  './js/scan.js',
  './js/glyph-model.js',
  './js/glyphs.js',
  './js/insights.js',
  './js/achievements.js',
  './js/xlsx-write.js',
  './js/pdf-write.js',
  './js/export.js',
  './js/sample.js',
  './js/charts.js',
  './js/ui/core.js',
  './js/ui/shared.js',
  './js/ui/ball-add.js',
  './js/ui/home.js',
  './js/ui/setup.js',
  './js/ui/entry.js',
  './js/ui/editor.js',
  './js/ui/photo.js',
  './js/ui/games.js',
  './js/ui/stats.js',
  './js/ui/more.js',
  './js/ui/import-scores.js',
  './js/ui/export.js',
  './js/ui/achievements.js',
  './js/ui/share.js',
  './js/ui/league-shell.js',
  './js/ui/league-standings.js',
  './js/ui/league-scores.js',
  './js/ui/league-import.js',
  './js/ui/boot.js',
  './wordmark.png', './app-icon.png', './lane.jpg', './share-logo.png', './fonts/poppins-medium.woff', './fonts/poppins-bold.woff', './fonts/inter-var.woff', './fonts/OFL-Poppins.txt', './fonts/OFL-Inter.txt', './favicon.png', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
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
// library) go to the network as normal. User data never goes through here: it lives in
// localStorage/IndexedDB, and any future server data must use paths this worker skips.
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
