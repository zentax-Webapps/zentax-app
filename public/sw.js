// Service worker for PWA install + offline shell cache.
const CACHE = 'zentax-v2';
const SHELL = [
  '/', '/index.html', '/manifest.json',
  '/css/styles.css',
  '/js/app.js', '/js/config.js', '/js/sb.js', '/js/auth.js',
  '/js/router.js', '/js/ui.js', '/js/install.js',
  '/js/views/login.js', '/js/views/dashboard.js', '/js/views/companies.js',
  '/js/views/company.js', '/js/views/tasks.js', '/js/views/task.js',
  '/js/views/users.js', '/js/views/account.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache Supabase API or auth - always network
  if (url.hostname.endsWith('.supabase.co')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached ||
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/index.html'))
    )
  );
});
