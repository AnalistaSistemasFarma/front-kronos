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

  const targetUrl = data.url || '/';

  // No se le avisa de algo que ya está mirando: si hay una pestaña VISIBLE
  // parada justo en esa URL, la notificación sería ruido (el mensaje ya le
  // apareció en el chat). Cualquier otro caso —pestaña en otra página, en
  // segundo plano, o navegador cerrado— sí notifica.
  const shouldSkip = async () => {
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = new URL(targetUrl, self.location.origin);
      return clients.some((client) => {
        if (client.visibilityState !== 'visible') return false;
        const open = new URL(client.url, self.location.origin);
        return open.pathname === target.pathname && open.search === target.search;
      });
    } catch {
      // Ante cualquier duda, se muestra: perder una notificación es peor que
      // mostrar una de más.
      return false;
    }
  };

  event.waitUntil(
    shouldSkip().then((skip) => {
      if (skip) return undefined;
      return self.registration.showNotification(data.title, {
        body: data.body,
        // El icono puede venir en el payload (p.ej. la foto del agente que
        // responde en el chat de Asistentes IA). Sin él, el logo de SynerLink.
        icon: data.icon || '/iconocel.png',
        badge: '/iconocel.png',
        data: { url: targetUrl },
        requireInteraction: false,
        tag: data.tag || 'synerlink',
        renotify: true,
        vibrate: [120, 60, 120],
      });
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
