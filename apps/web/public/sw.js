// Web Push has no meaning without a service worker running in the
// background — this is what actually receives a push while the /t/<code>
// tab isn't focused (or isn't even open) and turns it into a real OS
// notification. Deliberately does nothing else: no caching, no offline
// support, this app isn't a PWA, just a push receiver.

self.addEventListener('push', (event) => {
  let payload = { title: 'Queue update', body: 'Your status has changed.' };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Non-JSON payload — fall back to the default above.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: 'queueos-status',
    }),
  );
});

// Focuses an already-open status tab instead of opening a duplicate one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes('/t/'));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    }),
  );
});
