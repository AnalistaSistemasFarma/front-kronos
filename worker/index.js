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
// Espejo de public/sw.js con SW_VERSION = '2026-10-22.1' (menú Compartir de
// Android, share_target; antes: vibración del
// zumbido del chat entre personas tomada del payload).
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
// ⚠️ Constantes repetidas de lib/chat/compartir-share-target.ts (este archivo no importa
// TypeScript). lib/chat/compartir-share-target.test.ts verifica que coincidan.
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
