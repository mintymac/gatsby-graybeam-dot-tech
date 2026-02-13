// Service worker kill switch — unregisters any old Gatsby service worker
// and clears its caches. This file exists at the same path the old SW used,
// so the browser will fetch it as an "update" and run this cleanup code.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => client.navigate(client.url));
  });
  caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))));
  self.registration.unregister();
});
