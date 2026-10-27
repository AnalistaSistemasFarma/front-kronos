/**
 * Lectura, desde la pantalla «Compartir en SynerLink», de los lotes que el
 * service worker (public/sw.js) guardó en IndexedDB al recibir un compartir de
 * Android. Solo navegador.
 *
 * Los archivos NUNCA salen del celular por aquí: la pantalla los lee, los
 * muestra y, si la persona confirma, los envía por la ruta normal del chat.
 * Después de enviar (o descartar) el lote se borra; los que nadie envía los
 * barre el service worker a las 24 horas.
 */
import { SHARE_IDB_NAME, SHARE_IDB_STORE, SHARE_IDB_VERSION, SHARE_LOTE_TTL_MS } from './compartir-share-target';

export interface ArchivoDeLote {
  name: string;
  type: string;
  size: number;
  /** null cuando el archivo pasaba del tope y el service worker no lo guardó. */
  blob: Blob | null;
}

export interface LoteCompartido {
  id: string;
  createdAt: number;
  title: string;
  text: string;
  url: string;
  files: ArchivoDeLote[];
}

function abrir(): Promise<IDBDatabase> {
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

/** Lee un lote. null si no existe o ya venció. */
export async function leerLoteCompartido(id: string): Promise<LoteCompartido | null> {
  if (typeof indexedDB === 'undefined' || !id) return null;
  const db = await abrir();
  try {
    const lote = await new Promise<LoteCompartido | undefined>((resolve, reject) => {
      const req = db.transaction(SHARE_IDB_STORE, 'readonly').objectStore(SHARE_IDB_STORE).get(id);
      req.onsuccess = () => resolve(req.result as LoteCompartido | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!lote || typeof lote.createdAt !== 'number') return null;
    if (Date.now() - lote.createdAt > SHARE_LOTE_TTL_MS) return null;
    return { ...lote, files: Array.isArray(lote.files) ? lote.files : [] };
  } finally {
    db.close();
  }
}

/** Borra un lote (después de enviarlo o descartarlo). Nunca lanza. */
export async function borrarLoteCompartido(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || !id) return;
  try {
    const db = await abrir();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SHARE_IDB_STORE, 'readwrite');
        tx.objectStore(SHARE_IDB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* lo barre el service worker a las 24 horas */
  }
}
