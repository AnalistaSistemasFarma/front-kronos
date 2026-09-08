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

const SW_VERSION = '2026-09-07.1';

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
        // Iconos del TAMAÑO que la notificación necesita. Antes los dos
        // apuntaban a /iconocel.png (2500 × 2500, 916 KB): cada notificación
        // se bajaba casi un mega para pintar una insignia de 24 px.
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
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

  // Abrir el destino es más delicado de lo que parece. Tres trampas, todas
  // pagadas:
  //   1. `client.navigate()` LANZA si la pestaña no está controlada por este
  //      service worker (típico: la pestaña se abrió antes de que el worker se
  //      activara). Como `matchAll` se llama con `includeUncontrolled: true`,
  //      esas pestañas SÍ vienen en la lista. Sin capturar el error, la
  //      promesa se rompe, no se navega y tampoco se abre ventana: el usuario
  //      hace clic y no pasa nada.
  //   2. Tomar la primera pestaña de la lista sin mirar el origen puede llevar
  //      a intentar navegar algo que no es la aplicación.
  //   3. Si ya hay una pestaña parada en el destino, navegarla otra vez la
  //      recarga sin necesidad; basta con enfocarla.
  const mismoOrigen = (client, destino) => {
    try {
      return new URL(client.url).origin === destino.origin;
    } catch {
      return false;
    }
  };

  event.waitUntil(
    (async () => {
      const destino = new URL(targetUrl);
      const pestanas = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // 1) ¿Ya hay una pestaña en el destino? Solo enfocarla.
      const yaEsta = pestanas.find(
        (client) =>
          mismoOrigen(client, destino) && new URL(client.url).pathname === destino.pathname
      );
      if (yaEsta) {
        try {
          await yaEsta.focus();
          return;
        } catch {
          // si no se puede enfocar, se sigue al camino de abajo
        }
      }

      // 2) Una pestaña de la aplicación: enfocarla y navegarla al hilo.
      const deLaApp = pestanas.find((client) => mismoOrigen(client, destino));
      if (deLaApp) {
        try {
          await deLaApp.focus();
        } catch {
          // enfocar puede fallar sin que navegar falle; no es motivo para parar
        }
        if ('navigate' in deLaApp) {
          try {
            await deLaApp.navigate(destino.href);
            return;
          } catch {
            // pestaña no controlada por el worker: se abre una ventana nueva
          }
        }
      }

      // 3) Nada aprovechable: ventana nueva directo al hilo.
      if (self.clients.openWindow) {
        await self.clients.openWindow(destino.href);
      }
    })()
  );
});
