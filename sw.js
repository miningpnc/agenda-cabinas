// Service worker mínimo: permite instalar la app y mostrar notificaciones.
// Los avisos push los envía la función «enviar-aviso» de Supabase.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Agenda', {
    body: d.body || 'Tienes un aviso nuevo', icon: 'icon-192.png', badge: 'icon-192.png',
    tag: d.tag || 'agenda', renotify: true, vibrate: [200, 100, 200], data: d
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    for (const c of l) if ('focus' in c) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
