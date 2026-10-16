import type { MensajeCompleto } from './types';

/**
 * Caché corta del hilo en la memoria del servidor, POR PERSONA (2026-10-16, throttling de Graph).
 *
 * - Deduplica: si el mismo hilo se pide dos veces a la vez (doble clic, «Ver imágenes», el marcado como
 *   leído que llega justo después de abrirlo), sale UNA sola consulta a Graph y ambas esperan la misma.
 * - Reutiliza: durante HILO_TTL_MS reabrir el hilo o marcarlo no vuelve a consultar Graph.
 * - Se invalida al responder (o enviar el acuse) y con los marcados masivos; al marcar el hilo se actualiza.
 *
 * La clave incluye el usuario de la SESIÓN: un hilo nunca se sirve a otra persona.
 */

export const HILO_TTL_MS = 45_000;
const MAX_ENTRADAS = 200;

interface Entrada {
  valor: MensajeCompleto[] | null;
  expira: number;
  pendiente: Promise<MensajeCompleto[]> | null;
}

const cache: Map<string, Entrada> =
  ((globalThis as Record<string, unknown>).__correoCacheHilo as Map<string, Entrada> | undefined) ??
  ((globalThis as Record<string, unknown>).__correoCacheHilo = new Map<string, Entrada>());

const clave = (idUser: string, conversationId: string) => `${idUser}\u0000${conversationId}`;

/** Solo pruebas. */
export function limpiarCacheHilos(): void {
  cache.clear();
}

/**
 * Hilo desde la caché, o `cargar()` una sola vez aunque lleguen varias peticiones a la vez.
 * `fresco` ignora lo guardado (botón «Actualizar»), pero se suma a una consulta ya en vuelo.
 */
export async function hiloConCache(
  idUser: string,
  conversationId: string,
  cargar: () => Promise<MensajeCompleto[]>,
  opciones: { fresco?: boolean; ahora?: number } = {}
): Promise<MensajeCompleto[]> {
  const ahora = opciones.ahora ?? Date.now();
  const k = clave(idUser, conversationId);
  const e = cache.get(k);
  if (e?.pendiente) return e.pendiente;
  if (!opciones.fresco && e?.valor && e.expira > ahora) return e.valor;
  const pendiente = cargar();
  cache.set(k, { valor: null, expira: 0, pendiente });
  try {
    const valor = await pendiente;
    // Si mientras tanto se invalidó (respuesta, marcado), no se guarda una versión vieja.
    if (cache.get(k)?.pendiente === pendiente) cache.set(k, { valor, expira: ahora + HILO_TTL_MS, pendiente: null });
    podar(ahora);
    return valor;
  } catch (err) {
    if (cache.get(k)?.pendiente === pendiente) cache.delete(k);
    throw err;
  }
}

/** Reemplaza un mensaje del hilo guardado (p. ej. con sus imágenes ya descargadas). */
export function actualizarMensajeEnCache(idUser: string, conversationId: string, mensaje: MensajeCompleto): void {
  const e = cache.get(clave(idUser, conversationId));
  if (!e?.valor) return;
  e.valor = e.valor.map((m) => (m.id === mensaje.id ? mensaje : m));
}

/**
 * Tras marcar leído / no leído el hilo: la copia guardada se actualiza (en vez de borrarse) para que desplegar
 * un mensaje o «Ver imágenes» no vuelva a leer el hilo de Graph. Sin copia guardada no hace nada.
 */
export function marcarLeidoEnCache(idUser: string, conversationId: string, ids: string[], leido: boolean): void {
  const e = cache.get(clave(idUser, conversationId));
  if (!e?.valor) return;
  const set = new Set(ids);
  e.valor = e.valor.map((m) => (set.has(m.id) ? { ...m, leido } : m));
}

/** Invalida un hilo de la persona, o todos sus hilos si no se indica cuál (marcados masivos). */
export function invalidarHilo(idUser: string, conversationId?: string | null): void {
  if (conversationId) {
    cache.delete(clave(idUser, conversationId));
    return;
  }
  const prefijo = `${idUser}\u0000`;
  for (const k of [...cache.keys()]) if (k.startsWith(prefijo)) cache.delete(k);
}

function podar(ahora: number): void {
  if (cache.size <= MAX_ENTRADAS) return;
  for (const [k, v] of cache) if (!v.pendiente && v.expira <= ahora) cache.delete(k);
  // Si aún sobra, se descartan los más antiguos (orden de inserción del Map).
  for (const k of cache.keys()) {
    if (cache.size <= MAX_ENTRADAS) break;
    if (!cache.get(k)?.pendiente) cache.delete(k);
  }
}
