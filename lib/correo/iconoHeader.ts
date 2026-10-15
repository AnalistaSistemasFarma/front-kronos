import { CORREO_SUBPROCESS_URL } from './constants';

/**
 * Icono del Correo en la cabecera, junto a la campana (2026-10-15, Nicolás Rivera:
 * «al ser un módulo tan recurrente el Correo, hazme un iconito para que esté en el
 * header»). Lógica PURA (sin React ni red) para probarla aparte.
 *
 * Regla de visibilidad: el icono solo aparece si /api/correo/no-leidos respondió 200,
 * es decir, el servidor confirmó sesión + permiso del módulo (subproceso
 * «/process/correo» en alguna empresa; misma regla que getCorreoAccess). Sin sesión
 * (401), sin permiso (403), con error o sin respuesta aún: NO se muestra.
 */

export const CORREO_HREF = CORREO_SUBPROCESS_URL;
/** Cuánto vale en el navegador la respuesta (permiso + contador). */
export const ICONO_CORREO_TTL_MS = 3 * 60_000;
/** Espera antes de la primera consulta: no compite con la carga de la página. */
export const ICONO_CORREO_RETRASO_MS = 1_500;
const CLAVE_STORAGE = 'synerlink:correo-icono:v1';

export interface EstadoIconoCorreo {
  /** Correo de la sesión al que pertenece (al cambiar de usuario no se reutiliza). */
  email: string;
  visible: boolean;
  noLeidos: number | null;
  /** Epoch ms de la consulta. */
  en: number;
}

/** Traduce la respuesta del API al estado del icono. */
export function estadoDesdeRespuesta(email: string, status: number, body: unknown, ahora: number): EstadoIconoCorreo {
  const visible = status === 200;
  let noLeidos: number | null = null;
  if (visible && body && typeof body === 'object') {
    const n = (body as { noLeidos?: unknown }).noLeidos;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) noLeidos = Math.floor(n);
  }
  return { email, visible, noLeidos, en: ahora };
}

/** ¿Se pinta el icono? Solo con sesión y un estado confirmado por el servidor para ESA sesión. */
export function debeMostrarIconoCorreo(sesionEmail: string | null | undefined, estado: EstadoIconoCorreo | null): boolean {
  if (!sesionEmail || !estado) return false;
  return estado.email.toLowerCase() === sesionEmail.toLowerCase() && estado.visible;
}

/** ¿Hay que volver a consultar? */
export function estadoVencido(estado: EstadoIconoCorreo | null, sesionEmail: string, ahora: number, ttl = ICONO_CORREO_TTL_MS): boolean {
  if (!estado || estado.email.toLowerCase() !== sesionEmail.toLowerCase()) return true;
  return ahora - estado.en >= ttl || ahora < estado.en;
}

/** Texto del contador: nada con 0 o sin dato; «99+» desde 100. */
export function etiquetaNoLeidos(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

/** Etiqueta accesible del botón. */
export function ariaIconoCorreo(n: number | null): string {
  if (n == null || n <= 0) return 'Correo';
  return `Correo: ${n} sin leer`;
}

/** Lee el estado guardado en la pestaña (sessionStorage); nunca lanza. */
export function leerEstadoGuardado(storage: Pick<Storage, 'getItem'> | null | undefined): EstadoIconoCorreo | null {
  try {
    const raw = storage?.getItem(CLAVE_STORAGE);
    if (!raw) return null;
    const e = JSON.parse(raw) as Partial<EstadoIconoCorreo>;
    if (typeof e.email !== 'string' || typeof e.visible !== 'boolean' || typeof e.en !== 'number') return null;
    const noLeidos = typeof e.noLeidos === 'number' && e.noLeidos >= 0 ? e.noLeidos : null;
    return { email: e.email, visible: e.visible, noLeidos, en: e.en };
  } catch {
    return null;
  }
}

export function guardarEstado(storage: Pick<Storage, 'setItem'> | null | undefined, e: EstadoIconoCorreo): void {
  try {
    storage?.setItem(CLAVE_STORAGE, JSON.stringify(e));
  } catch {
    /* almacenamiento bloqueado: solo se pierde la caché */
  }
}

export function borrarEstado(storage: Pick<Storage, 'removeItem'> | null | undefined): void {
  try {
    storage?.removeItem(CLAVE_STORAGE);
  } catch {
    /* nada */
  }
}
