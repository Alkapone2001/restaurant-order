self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }

  const title = data.title || "Porosite e Restorantit";
  const options = {
    body: data.body || "Njoftim i ri",
    tag: data.tag || "restaurant-order",
    renotify: true,
    requireInteraction: true,
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: data.url || "/" },
    vibrate: data.vibrate || [400, 120, 400]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
      return null;
    })
  );
});
