// =============================================================================
// SERVICE WORKER DE SYNERLINK — FUENTE DE VERDAD
// =============================================================================
// Este archivo ES el service worker que el navegador ejecuta en testing y en
// producción. Se sirve tal cual desde /sw.js y lo registra
// `components/ServiceWorkerRegistrar.tsx`.
//
// ¿Por qué está escrito a mano y no lo genera next-pwa?
//   En `next.config.ts` el plugin `@ducanh2912/next-pwa` está con
//   `disable: true`, así que NUNCA compila ni emite un service worker. En
//   consecuencia `worker/index.js` (el "custom worker" que ese plugin
//   concatenaría) es código muerto hoy.
//
// ⚠️ REGLA PARA QUIEN EDITE ESTE ARCHIVO:
//   `worker/index.js` es un ESPEJO de la lógica de abajo, mantenido solo para
//   el día en que se active el PWA (`disable: false`). Si cambia algo aquí,
//   REPLIQUE EL MISMO CAMBIO en `worker/index.js`. Los dos archivos ya se
//   bifurcaron una vez y provocaron comportamientos distintos.
//
// Versión: subir este número en cada cambio ayuda a saber qué SW está vivo
// (queda impreso en la consola del navegador al activarse).
// =============================================================================

const SW_VERSION = '2026-09-06.1';

// Toma el control de inmediato en lugar de quedarse "esperando" a que se
// cierren todas las pestañas con la versión anterior del service worker.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log(`[SW] Activo — versión ${SW_VERSION}`);
  event.waitUntil(self.clients.claim());
});

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
