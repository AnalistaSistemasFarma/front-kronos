import type { AccesoCorreo } from './db';
import { estadoConexion, proveedorDe, type CorreoDeps } from './service';

/**
 * Contador de no leídos para el icono del Correo en la cabecera (2026-10-15, pedido
 * de Nicolás Rivera). Es secundario: NUNCA lanza ni bloquea. Devuelve null cuando no
 * aplica (ambiente sin el módulo, inquilino no habilitado) o cuando Microsoft falla
 * o tarda; el icono se muestra igual, sin el número.
 *
 * Caché en memoria por persona (NO_LEIDOS_TTL_MS) para que navegar por SynerLink no
 * consulte Graph en cada página; una sola consulta en vuelo por persona.
 */

export const NO_LEIDOS_TTL_MS = 3 * 60_000;
/** Si Graph no responde en este tiempo, sin número (y se guarda en caché igual). */
export const NO_LEIDOS_TIMEOUT_MS = 4_000;

interface Entrada {
  valor: number | null;
  expira: number;
  pendiente: Promise<number | null> | null;
}

const cache: Map<string, Entrada> =
  ((globalThis as Record<string, unknown>).__correoNoLeidos as Map<string, Entrada> | undefined) ??
  ((globalThis as Record<string, unknown>).__correoNoLeidos = new Map<string, Entrada>());

/** Tras marcar leído / no leído: el próximo icono de la cabecera vuelve a consultar Graph. */
export function invalidarNoLeidos(idUser: string): void {
  const e = cache.get(idUser);
  if (e && !e.pendiente) cache.delete(idUser);
}

/** Solo pruebas. */
export function limpiarCacheNoLeidos(): void {
  cache.clear();
}

async function consultar(d: CorreoDeps, acceso: AccesoCorreo): Promise<number | null> {
  // Solo personas cuyo correo es de un inquilino habilitado (hoy GSS) o el modo simulado.
  if (!estadoConexion(d, acceso).disponible) return null;
  const prov = await proveedorDe(d, acceso);
  if (prov.noLeidosBandeja) return await prov.noLeidosBandeja();
  const carpetas = await prov.carpetas();
  const bandeja = carpetas.find((c) => /^(bandeja de entrada|inbox)$/i.test(c.nombre.trim()));
  return bandeja ? Math.max(0, bandeja.noLeidos) : null;
}

function conTiempoLimite<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

export async function noLeidosBandeja(d: CorreoDeps, acceso: AccesoCorreo): Promise<number | null> {
  const ahora = d.now ? d.now() : Date.now();
  const clave = acceso.idUser;
  const e = cache.get(clave);
  if (e?.pendiente) return e.pendiente;
  if (e && e.expira > ahora) return e.valor;
  const pendiente = conTiempoLimite(
    consultar(d, acceso).catch(() => null),
    NO_LEIDOS_TIMEOUT_MS
  );
  cache.set(clave, { valor: e?.valor ?? null, expira: 0, pendiente });
  const valor = await pendiente;
  cache.set(clave, { valor, expira: ahora + NO_LEIDOS_TTL_MS, pendiente: null });
  // Tope de memoria: si crece demasiado, se descartan las entradas vencidas.
  if (cache.size > 5_000) {
    for (const [k, v] of cache) if (!v.pendiente && v.expira <= ahora) cache.delete(k);
  }
  return valor;
}
