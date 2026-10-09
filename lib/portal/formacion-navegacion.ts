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
 *
 * Desde 2026-10-09 (lineamiento gráfico de SynerLink), quien entra por el hub
 * ya no va a `/portal/formacion` sino a `/process/portal-th/formacion`, que
 * vive DENTRO del layout del hub (header, barra lateral y menú). La página
 * abierta queda para la sesión por código. Un enlace viejo con `?desde=hub`
 * se redirige a la ruta del hub.
 */
export type OrigenPortal = 'abierto' | 'hub';

export const RUTA_FORMACION = '/portal/formacion';
const RUTA_PORTAL_ABIERTO = '/portal';
const RUTA_PORTAL_HUB = '/process/portal-th';
export const RUTA_FORMACION_HUB = '/process/portal-th/formacion';

/** La URL del acceso "Formación" según desde qué portal se abre. */
export function urlFormacion(origen: OrigenPortal): string {
  return origen === 'hub' ? RUTA_FORMACION_HUB : RUTA_FORMACION;
}

/** Lee `?desde=` y lo reduce a uno de los dos orígenes conocidos. */
export function origenDesdeParametro(desde: string | null | undefined): OrigenPortal {
  return desde === 'hub' ? 'hub' : 'abierto';
}

/** A dónde lleva "← Volver al portal". */
export function urlVolverAlPortal(origen: OrigenPortal): string {
  return origen === 'hub' ? RUTA_PORTAL_HUB : RUTA_PORTAL_ABIERTO;
}
