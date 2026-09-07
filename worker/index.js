// =============================================================================
// CUSTOM WORKER DE next-pwa — ESPEJO, NO ES LA FUENTE DE VERDAD
// =============================================================================
// ⚠️ HOY ESTE ARCHIVO NO SE EJECUTA.
//
// `@ducanh2912/next-pwa` está configurado con `disable: true` en
// `next.config.ts`, por lo que nunca genera un service worker y nunca
// concatena este "custom worker". El service worker que realmente corre es
// `public/sw.js`, escrito a mano y registrado por
// `components/ServiceWorkerRegistrar.tsx`.
//
// Se conserva este archivo porque `customWorkerSrc: 'worker'` sigue apuntando
// aquí: el día que alguien active el PWA (`disable: false`), next-pwa generará
// su propio service worker y le pegará este código al final. Si el archivo no
// existiera, las push dejarían de funcionar en silencio.
//
// 👉 FUENTE DE VERDAD: `public/sw.js`.
//    Cualquier cambio de lógica se hace ALLÁ primero y se copia acá igual.
//    (Estos dos archivos ya se bifurcaron una vez y quedaron con
//    comportamientos distintos en `notificationclick`.)
//
// Nota: aquí NO van `install`/`activate` con skipWaiting/clients.claim porque
// de eso se encarga workbox en el service worker que genera next-pwa.
// =============================================================================

self.addEventListener('push', (event) => {
  let data = { title: 'SynerLink', body: 'Tienes una nueva notificación', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/iconocel.png',
      badge: '/iconocel.png',
      data: { url: data.url || '/' },
      requireInteraction: false,
      tag: data.tag || 'synerlink',
      renotify: true,
      vibrate: [120, 60, 120],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // La URL del payload puede venir relativa ("/process/..."); se resuelve
  // contra el origen del service worker para poder compararla y navegar.
  const raw = event.notification.data?.url || '/';
  const targetUrl = new URL(raw, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
