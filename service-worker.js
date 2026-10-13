const CACHE_NAME = 'arwana-shell-v738-pwa1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/arwana-192.png', './icons/arwana-512.png', './icons/arwana.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('arwana-shell-') && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const req = event.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/functions/v1/') || url.pathname.includes('/auth/') || url.pathname.includes('/rest/v1/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => { if (res.ok) { const copy=res.clone(); caches.open(CACHE_NAME).then(c=>c.put('./index.html',copy)); } return res; }).catch(() => caches.match('./index.html').then(r=>r || caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => { if (res.ok && ['style','script','image','font'].includes(req.destination)) { const copy=res.clone(); caches.open(CACHE_NAME).then(c=>c.put(req,copy)); } return res; })));
});
