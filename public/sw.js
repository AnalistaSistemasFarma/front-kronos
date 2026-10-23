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

const SW_VERSION = '2026-10-22.1';

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
        // El patrón puede venir en el payload (el zumbido 📳 del chat entre
        // personas vibra más largo). Sin él, el de siempre.
        vibrate: Array.isArray(data.vibrate) ? data.vibrate : [120, 60, 120],
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

// =============================================================================
// MENÚ «COMPARTIR» DE ANDROID (share_target, 2026-10-22)
// =============================================================================
// El manifiesto (app/manifest.ts) declara `share_target` con POST multipart a
// /api/chat/compartir. Aquí se intercepta ese POST ANTES de que salga a la
// red: los archivos se guardan en IndexedDB DE ESTE CELULAR y se abre la
// pantalla «Compartir en SynerLink» (/process/chat/compartir?lote=<id>). Nada
// sube al servidor hasta que la persona elige la conversación y confirma; el
// envío usa la ruta normal del chat, que valida sesión, permisos y archivos.
//
// ⚠️ Constantes repetidas de lib/chat/compartir.ts (este archivo no importa
// TypeScript). lib/chat/compartir.test.ts verifica que coincidan.
// Solo se toca ESTE POST: cualquier otra petición sigue a la red sin cambios.
const SHARE_TARGET_ACTION = '/api/chat/compartir';
const SHARE_PAGE_PATH = '/process/chat/compartir';
const SHARE_IDB_NAME = 'synerlink-compartir';
const SHARE_IDB_STORE = 'lotes';
const SHARE_IDB_VERSION = 1;
const SHARE_MAX_FILES_STORED = 10;
const SHARE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const SHARE_LOTE_TTL_MS = 24 * 60 * 60 * 1000;

function abrirBdCompartir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_IDB_NAME, SHARE_IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_IDB_STORE)) {
        req.result.createObjectStore(SHARE_IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function guardarLoteCompartido(lote) {
  const db = await abrirBdCompartir();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_IDB_STORE, 'readwrite');
      const store = tx.objectStore(SHARE_IDB_STORE);
      // De paso se barren los lotes viejos que nadie envió.
      const limite = Date.now() - SHARE_LOTE_TTL_MS;
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (!c.value || typeof c.value.createdAt !== 'number' || c.value.createdAt < limite) c.delete();
        c.continue();
      };
      store.put(lote);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function textoCampo(form, nombre) {
  const v = form.get(nombre);
  return typeof v === 'string' ? v.slice(0, 4000) : '';
}

async function recibirCompartido(request) {
  const pantalla = (qs) => Response.redirect(new URL(`${SHARE_PAGE_PATH}?${qs}`, self.location.origin).href, 303);
  try {
    const form = await request.formData();
    const archivos = [];
    for (const entrada of form.getAll('files')) {
      if (!(entrada instanceof File)) continue;
      if (entrada.size === 0 && !entrada.name) continue; // entrada vacía de Android
      if (archivos.length >= SHARE_MAX_FILES_STORED) break;
      archivos.push({
        name: entrada.name || 'archivo',
        type: entrada.type || '',
        size: entrada.size,
        // Un archivo que ya pasa del tope no se guarda: solo se muestra el aviso.
        blob: entrada.size <= SHARE_MAX_FILE_BYTES ? entrada : null,
      });
    }
    const id = self.crypto.randomUUID();
    await guardarLoteCompartido({
      id,
      createdAt: Date.now(),
      title: textoCampo(form, 'title'),
      text: textoCampo(form, 'text'),
      url: textoCampo(form, 'url'),
      files: archivos,
    });
    return pantalla(`lote=${encodeURIComponent(id)}`);
  } catch (err) {
    console.warn('[SW] No se pudo recibir lo compartido:', err);
    return pantalla('aviso=recepcion');
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'POST') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname !== SHARE_TARGET_ACTION) return;
  event.respondWith(recibirCompartido(req));
});
