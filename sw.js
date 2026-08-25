/* ChantierPro — Service Worker (mode hors-ligne après installation) */
'use strict';
const CACHE = 'chantierpro-v3.1-fix4';
const SHELL = ['/', '/index.html', '/styles.css?v=313', '/app.js?v=313', '/cloud.js?v=313', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  /* Résilient : chaque fichier mis en cache séparément — un fichier manquant (404) ne casse plus l'installation */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/share')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      if (res.ok && url.origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
