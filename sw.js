/* Offline support: the app itself is kept on the phone; song and meaning files are
 * always fetched fresh when there is internet, and the last copy is used when there isn't.
 * Audio is streamed and not stored. */
const SHELL = 'hg-shell-v15s';
const DATA = 'hg-data';
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'access.js', 'sruti.html', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/logo.jpg', 'icons/about-group.jpg', 'icons/about-jk.jpg', 'icons/icon.svg',
  'fonts/baloo-tamma-2-kannada-400-normal.woff2', 'fonts/baloo-tamma-2-kannada-700-normal.woff2', 'fonts/mukta-devanagari-400-normal.woff2', 'fonts/mukta-devanagari-700-normal.woff2', 'fonts/mukta-latin-400-normal.woff2', 'fonts/mukta-latin-600-normal.woff2', 'fonts/mukta-latin-700-normal.woff2', 'fonts/mukta-latin-ext-400-normal.woff2', 'fonts/mukta-latin-ext-700-normal.woff2', 'fonts/mukta-malar-tamil-400-normal.woff2', 'fonts/mukta-malar-tamil-700-normal.woff2'];

const DATA_FILES = ['songs.txt', 'songs_ta.txt', 'songs_kn.txt', 'songs_sa.txt',
  'meanings_ta.txt', 'meanings_en.txt', 'meanings_kn.txt', 'audio.txt', 'manifest.txt',
  'ashtapathy/songs.txt', 'ashtapathy/songs_ta.txt', 'ashtapathy/songs_kn.txt', 'ashtapathy/songs_sa.txt',
  'ashtapathy/meanings_ta.txt', 'ashtapathy/meanings_en.txt', 'ashtapathy/meanings_kn.txt',
  'ashtapathy/audio.txt', 'ashtapathy/manifest.txt',
  'community/events.txt', 'community/learn.txt', 'community/tfd.txt', 'community/manifest.txt'];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(SHELL).then(c => c.addAll(SHELL_FILES)),
    // keep every song and meaning on the phone from the first visit, so it works offline
    caches.open(DATA).then(c => Promise.all(DATA_FILES.map(f =>
      fetch(f, { cache: 'no-cache' }).then(r => r.ok && c.put(new URL(f, self.location).href, r)).catch(() => {})))),
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('hg-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // sign-in server and YouTube go straight to the network
  if (url.pathname.includes('/admin/')) return;   // the admin screens always come fresh from the network
  if (/\.(m4a|mp3|aac|wav|ogg)$/i.test(url.pathname) || url.pathname.includes('/Audio')) return; // stream audio directly

  if (url.pathname.endsWith('.txt')) {
    // network first, so new songs and meanings show up as soon as they are pushed
    const key = new Request(url.origin + url.pathname);
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then(r => r || Response.error())));
    return;
  }
  // app files: network first too (small), falling back to the stored copy offline
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {   // no-cache: a new version shows on the next open, not 10 minutes later
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
