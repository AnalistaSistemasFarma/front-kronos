/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — a dónde lleva cada enlace.
 *
 * Pedido de Cristian Baldión (2026-09-30): Formación deja de ser una sección
 * al final del portal y pasa a su PROPIA página (`/portal/formacion`), que se
 * abre en una pestaña nueva desde un acceso del portal principal. Arriba
 * tiene "← Volver al portal", que debe llevar al portal por el que entró la
 * persona: el abierto (`/portal`, sesión por código) o el módulo del hub
 * (`/process/portal-th`, sesión de SynerLink).
 *
 * El origen viaja como `?desde=hub`. Solo se acepta ese valor exacto y las
 * dos rutas son FIJAS: el parámetro nunca se usa como URL, así que no hay
 * forma de convertir este enlace en un redireccionamiento abierto.
 */
export type OrigenPortal = 'abierto' | 'hub';

export const RUTA_FORMACION = '/portal/formacion';
/**
 * Formación DENTRO del hub (con el encabezado y el menú de SynerLink).
 * Observación de Nicolás (2026-10-09): desde el módulo no debe salirse del hub.
 */
export const RUTA_FORMACION_HUB = '/process/portal-th/formacion';
const RUTA_PORTAL_ABIERTO = '/portal';
const RUTA_PORTAL_HUB = '/process/portal-th';

/** La URL del acceso "Formación" según desde qué portal se abre. */
export function urlFormacion(origen: OrigenPortal): string {
  return origen === 'hub' ? RUTA_FORMACION_HUB : RUTA_FORMACION;
}

/** Lee `?desde=` y lo reduce a uno de los dos orígenes conocidos. */
export function origenDesdeParametro(desde: string | null | undefined): OrigenPortal {
  return desde === 'hub' ? 'hub' : 'abierto';
}

/**
 * Invitación a un curso (Cristian, 2026-10-14): `/portal/formacion?curso=N` abre ese curso al ingresar. Solo se acepta un
 * entero positivo razonable; cualquier otra cosa se ignora.
 */
export function cursoDesdeParametro(valor: string | null | undefined): number | null {
  if (typeof valor !== 'string' || !/^\d{1,9}$/.test(valor)) return null;
  const n = Number(valor);
  return n > 0 ? n : null;
}

/** El enlace de Formación que abre un curso. */
export const urlFormacionDelCurso = (cursoId: number): string => `${RUTA_FORMACION}?curso=${cursoId}`;

/**
 * Para volver a Formación después de ingresar con el código: el portal abierto acepta `?siguiente=` pero SOLO con la ruta de
 * Formación (con o sin `?curso=N`). Nunca una URL libre: así no hay forma de convertirlo en un redireccionamiento abierto.
 */
export function rutaSiguienteValida(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  if (valor === RUTA_FORMACION) return valor;
  const prefijo = `${RUTA_FORMACION}?curso=`;
  if (!valor.startsWith(prefijo)) return null;
  const numero = valor.slice(prefijo.length);
  const curso = cursoDesdeParametro(numero);
  // Exacto: sin ceros a la izquierda ni nada más después del número.
  return curso !== null && String(curso) === numero ? valor : null;
}

/** El portal abierto con el regreso a Formación ya indicado. */
export const urlIngresoYVolverAFormacion = (cursoId: number | null): string =>
  `${RUTA_PORTAL_ABIERTO}?siguiente=${encodeURIComponent(cursoId ? urlFormacionDelCurso(cursoId) : RUTA_FORMACION)}`;

/** A dónde lleva "← Volver al portal". */
export function urlVolverAlPortal(origen: OrigenPortal): string {
  return origen === 'hub' ? RUTA_PORTAL_HUB : RUTA_PORTAL_ABIERTO;
}
