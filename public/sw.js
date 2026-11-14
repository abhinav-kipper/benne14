// Service worker for the owner app's notifications. It does one job: show a notification when the
// server sends one, and open the owner app when it is tapped. It caches nothing and touches no
// request, so the kiosk, kitchen and TV behave exactly as without it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = { title: 'Benne 14', body: 'Something needs a look.', tag: 'benne14' };
  try {
    m = { ...m, ...e.data.json() };
  } catch {
    // an empty or unreadable message still shows the default text
  }
  e.waitUntil(
    self.registration.showNotification(m.title, {
      body: m.body,
      tag: m.tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/admin' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      const open = all.find((c) => new URL(c.url).pathname.startsWith('/admin'));
      return open ? open.focus() : self.clients.openWindow('/admin');
    }),
  );
});
