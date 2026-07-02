const EVENT_ICONS = {
  "sale.approved": "💰",
  "sale.pending": "⏳",
  "sale.failed": "❌",
  "checkout.abandoned": "🛒",
  refund: "↩️",
  new_customer: "👤",
  daily_summary: "📊",
  system: "🔔",
};

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch (e) {
    data = { title: 'Nova Notificação', body: event.data?.text() || 'Você tem uma nova atualização.' };
  }

  const eventType = data.event || 'system';
  const icon = EVENT_ICONS[eventType] || '🔔';
  const title = data.title || (icon + ' PaymentBlack');
  const options = {
    body: data.body || 'Uma atualização está disponível.',
    icon: '/logo-192.png',
    badge: '/logo-192.png',
    data: { url: data.url || '/dashboard', event: eventType },
    vibrate: eventType === 'sale.approved' ? [200, 100, 200, 100, 200] : [200, 100, 200],
    tag: 'paymentblack-' + eventType,
    renotify: true,
    requireInteraction: eventType === 'sale.approved' || eventType === 'sale.failed',
    actions: [
      { action: 'open', title: 'Ver agora' },
      { action: 'dismiss', title: 'Dispensar' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const urlToOpen = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if ('focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
