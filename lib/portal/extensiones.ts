/**
 * PORTAL DE TALENTO HUMANO — Extensiones Corporativas (ventana de Contactos).
 *
 * Pedido de Cristian Baldión (2026-10-08). La lista la mantiene Talento Humano
 * en el Excel `extensiones.xlsx` del sitio TalentoHumano (Documentos /
 * CONTACTOS), con las columnas "Nombre" y "Número de extensión". Para
 * actualizarla basta con editar ese Excel: no hay que tocar el código.
 *
 * Mismo patrón que el Excel de permisos de Formación (`permisos-formacion.ts`):
 * la app de Entra de Formación (`SynerLink-PortalTH-Formacion`,
 * `Sites.Selected` sobre TalentoHumano) resuelve el enlace con
 * `GET /shares/{u!base64url}/driveItem` y lee la hoja con la API de workbook
 * (`usedRange`). No hace falta ninguna credencial nueva.
 *
 *   PORTAL_TH_EXTENSIONES_URL   enlace del Excel (el de "Compartir → Copiar
 *                               vínculo" o el de abrirlo en el navegador). Por
 *                               defecto, el que pasó Cristian el 2026-10-08.
 *   PORTAL_TH_EXTENSIONES_HOJA  hoja a leer. Por defecto, la primera del libro
 *                               (así renombrar "Hoja1" no rompe nada).
 *
 * Caché de 5 minutos. Si SharePoint falla se devuelve la ÚLTIMA LISTA BUENA;
 * si nunca se pudo leer desde que arrancó la app, el respaldo empaquetado
 * (`extensiones-respaldo.json`, generado del Excel recibido con
 * `scripts/portal/extensiones-respaldo.mjs`).
 */
import 'server-only';
import { leerConfigFormacion, obtenerToken, type ConfigFormacionSharePoint } from './formacion-storage';
import { idDeEnlaceCompartido } from './permisos-formacion';
import { extensionesDeValores, type Extension } from './extensiones-datos';
import respaldo from './extensiones-respaldo.json';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Enlace del Excel que subió Cristian Baldión el 2026-10-08 (TalentoHumano/Documentos/CONTACTOS). */
export const URL_EXTENSIONES_POR_DEFECTO =
  'https://gsslatam.sharepoint.com/:x:/r/sites/TalentoHumano/_layouts/15/Doc.aspx?sourcedoc=%7BA18C543D-FD3B-4120-9230-085DEE41C791%7D&file=extensiones.xlsx&action=default&mobileredirect=true&wdwpf=doclib-c';

/** Cuánto se recuerda la lista antes de volver a leerla. */
export const EXTENSIONES_CACHE_MS = 5 * 60_000;

type Fetch = typeof fetch;

export type OrigenExtensiones = 'sharepoint' | 'ultima-buena' | 'respaldo';

export interface ResultadoExtensiones {
  extensiones: Extension[];
  origen: OrigenExtensiones;
}

export function urlExtensiones(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PORTAL_TH_EXTENSIONES_URL ?? '').trim() || URL_EXTENSIONES_POR_DEFECTO;
}

export function hojaExtensiones(env: NodeJS.ProcessEnv = process.env): string | null {
  return (env.PORTAL_TH_EXTENSIONES_HOJA ?? '').trim() || null;
}

/** Lista del respaldo empaquetado (el Excel recibido el 2026-10-08). */
export function extensionesDeRespaldo(): Extension[] {
  return extensionesDeValores((respaldo as { valores: unknown[][] }).valores);
}

export class ExtensionesError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ExtensionesError';
  }
}

/** Lee el Excel de SharePoint y devuelve la lista limpia y ordenada. */
export async function leerExtensionesDesdeSharePoint(
  deps: { config?: ConfigFormacionSharePoint; fetch?: Fetch; url?: string; hoja?: string | null } = {}
): Promise<Extension[]> {
  const cfg = deps.config ?? leerConfigFormacion();
  const f = deps.fetch ?? fetch;
  const token = await obtenerToken(cfg, f);
  const auth = { Authorization: `Bearer ${token}` };
  const opciones = { headers: auth, signal: AbortSignal.timeout(15_000) };

  const resItem = await f(
    `${GRAPH}/shares/${idDeEnlaceCompartido(deps.url ?? urlExtensiones())}/driveItem?$select=id,parentReference`,
    opciones
  );
  if (!resItem.ok) throw new ExtensionesError(`Graph no resolvió el enlace del Excel de extensiones (${resItem.status}).`, resItem.status);
  const item = (await resItem.json()) as { id?: string; parentReference?: { driveId?: string } };
  if (!item.id || !item.parentReference?.driveId) throw new ExtensionesError('Graph no devolvió el Excel de extensiones.');

  const base = `${GRAPH}/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}/workbook`;

  let hoja = deps.hoja === undefined ? hojaExtensiones() : deps.hoja;
  if (!hoja) {
    const resHojas = await f(`${base}/worksheets?$select=name`, opciones);
    if (!resHojas.ok) throw new ExtensionesError(`No se pudieron listar las hojas del Excel (${resHojas.status}).`, resHojas.status);
    hoja = ((await resHojas.json()) as { value?: { name?: string }[] }).value?.[0]?.name ?? null;
    if (!hoja) throw new ExtensionesError('El Excel de extensiones no tiene hojas.');
  }

  const res = await f(`${base}/worksheets('${encodeURIComponent(hoja.replace(/'/g, "''"))}')/usedRange?$select=values`, opciones);
  if (!res.ok) throw new ExtensionesError(`No se pudo leer la hoja ${hoja} (${res.status}).`, res.status);
  const data = (await res.json()) as { values?: unknown[][] };
  const lista = extensionesDeValores(data.values ?? []);
  // Una lista vacía casi siempre es un archivo a medio editar o una hoja
  // equivocada: mejor seguir mostrando la última buena que una tabla en blanco.
  if (lista.length === 0) throw new ExtensionesError(`La hoja ${hoja} no trae extensiones.`);
  return lista;
}

let cache: { cuando: number; extensiones: Extension[] } | null = null;
let ultimaBuena: Extension[] | null = null;

/** Solo para pruebas. */
export function _reiniciarCacheExtensiones() {
  cache = null;
  ultimaBuena = null;
}

/**
 * Las extensiones para la ventana de Contactos: caché de 5 min; si SharePoint
 * falla, la última lista buena; si nunca se leyó, el respaldo empaquetado.
 * Nunca lanza: siempre hay algo que mostrar.
 */
export async function leerExtensionesCorporativas(
  deps: { leer?: () => Promise<Extension[]>; ahora?: () => number } = {}
): Promise<ResultadoExtensiones> {
  const ahora = deps.ahora ?? Date.now;
  if (cache && ahora() - cache.cuando < EXTENSIONES_CACHE_MS) return { extensiones: cache.extensiones, origen: 'sharepoint' };
  try {
    const extensiones = await (deps.leer ?? leerExtensionesDesdeSharePoint)();
    cache = { cuando: ahora(), extensiones };
    ultimaBuena = extensiones;
    return { extensiones, origen: 'sharepoint' };
  } catch (error) {
    console.warn('[portal] No se pudo leer el Excel de extensiones:', (error as Error).message);
    // No se cachea el fallo: el siguiente pedido vuelve a intentar.
    if (ultimaBuena) return { extensiones: ultimaBuena, origen: 'ultima-buena' };
    return { extensiones: extensionesDeRespaldo(), origen: 'respaldo' };
  }
}
