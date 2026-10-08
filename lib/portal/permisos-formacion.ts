/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — quién puede MARCAR A MANO.
 *
 * Pedido de Cristian Baldión (2026-10-08): la casilla de "completado" de cada
 * material queda bloqueada para los estudiantes y se marca SOLA cuando la
 * persona revisa el material (ver `revision-material.ts`). Únicamente quienes
 * estén en el Excel "ADMINISTRADORES - FORMADORES" del sitio TalentoHumano
 * —hojas ADMINISTRADORES y FORMADORES— pueden marcarla o desmarcarla a mano.
 *
 * El archivo lo mantiene Talento Humano. Se lee con la MISMA app de Entra de
 * Formación (`SynerLink-PortalTH-Formacion`, `Sites.Selected` sobre
 * TalentoHumano): el archivo vive en ese sitio (carpeta FORMACION), así que no
 * hace falta ninguna credencial nueva.
 *
 *   PORTAL_TH_PERMISOS_FORMACION_URL  enlace compartido del Excel (el que se
 *                                     copia con "Compartir → Copiar vínculo").
 *                                     Por defecto, el que envió Cristian.
 *
 * Lectura: `GET /shares/{u!base64url}/driveItem` y luego la API de workbook
 * (`/workbook/worksheets('<HOJA>')/usedRange`) de cada hoja. Se toma la
 * columna cuyo encabezado diga "correo"/"mail"; si no hay encabezado, cualquier
 * celda que parezca un correo.
 *
 * Caché de 5 minutos. Si SharePoint falla se conserva la ÚLTIMA LISTA BUENA
 * (no se le quita el permiso a nadie por un tropiezo de red). Si nunca se
 * pudo leer, nadie tiene permiso manual (falla cerrado): marcar a mano es la
 * excepción, no la regla, y la marca automática sigue funcionando.
 */
import 'server-only';
import { leerConfigFormacion, obtenerToken, type ConfigFormacionSharePoint } from './formacion-storage';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Enlace del Excel que envió Cristian Baldión el 2026-10-08. */
export const URL_PERMISOS_POR_DEFECTO =
  'https://gsslatam.sharepoint.com/:x:/s/TalentoHumano/IQALgrXl9fZlTIjT0ADTSrKUAY9Cyk7m83EpoK389Cm9dvI?e=14hLNK';

/** Hojas que dan permiso de marcado manual. */
export const HOJAS_CON_PERMISO = ['ADMINISTRADORES', 'FORMADORES'] as const;

/** Respuesta cuando alguien sin permiso intenta marcar o desmarcar a mano. */
export const MENSAJE_SIN_PERMISO_MANUAL =
  'La casilla se marca automáticamente al revisar el material. Solo los administradores y formadores de Formación pueden marcarla o desmarcarla a mano.';

/** Cuánto se recuerda la lista antes de volver a leerla. */
export const PERMISOS_CACHE_MS = 5 * 60_000;

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Fetch = typeof fetch;

export function urlPermisosFormacion(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PORTAL_TH_PERMISOS_FORMACION_URL ?? '').trim() || URL_PERMISOS_POR_DEFECTO;
}

/** `u!` + base64url del enlace, como lo pide `GET /shares/{id}`. */
export function idDeEnlaceCompartido(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

/**
 * Correos de los valores de una hoja (`usedRange.values`).
 * Tolerante igual que el lector de excepciones del portal: el archivo se
 * mantiene a mano y le pueden agregar columnas.
 */
export function correosDeValores(valores: unknown[][]): string[] {
  if (!Array.isArray(valores) || valores.length === 0) return [];
  const texto = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const cabecera = (valores[0] ?? []).map(texto);
  const columna = cabecera.findIndex((t) => !CORREO.test(t) && (t.includes('correo') || t.includes('mail')));

  const salida: string[] = [];
  valores.forEach((fila, i) => {
    if (!Array.isArray(fila)) return;
    if (columna >= 0) {
      if (i === 0) return;
      const v = texto(fila[columna]);
      if (CORREO.test(v)) salida.push(v);
      return;
    }
    for (const celda of fila) {
      const v = texto(celda);
      if (CORREO.test(v)) salida.push(v);
    }
  });
  return salida;
}

export class PermisosFormacionError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'PermisosFormacionError';
  }
}

/** Lee las hojas ADMINISTRADORES y FORMADORES y devuelve los correos. */
export async function leerPermisosDesdeSharePoint(
  deps: { config?: ConfigFormacionSharePoint; fetch?: Fetch; url?: string } = {}
): Promise<Set<string>> {
  const cfg = deps.config ?? leerConfigFormacion();
  const f = deps.fetch ?? fetch;
  const token = await obtenerToken(cfg, f);
  const auth = { Authorization: `Bearer ${token}` };

  const resItem = await f(
    `${GRAPH}/shares/${idDeEnlaceCompartido(deps.url ?? urlPermisosFormacion())}/driveItem?$select=id,parentReference`,
    { headers: auth }
  );
  if (!resItem.ok) throw new PermisosFormacionError(`Graph no resolvió el enlace del Excel (${resItem.status}).`, resItem.status);
  const item = (await resItem.json()) as { id?: string; parentReference?: { driveId?: string } };
  if (!item.id || !item.parentReference?.driveId) throw new PermisosFormacionError('Graph no devolvió el archivo de permisos.');

  const base = `${GRAPH}/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}`;
  const correos = new Set<string>();
  for (const hoja of HOJAS_CON_PERMISO) {
    const res = await f(`${base}/workbook/worksheets('${hoja}')/usedRange?$select=values`, { headers: auth });
    if (!res.ok) throw new PermisosFormacionError(`No se pudo leer la hoja ${hoja} (${res.status}).`, res.status);
    const data = (await res.json()) as { values?: unknown[][] };
    for (const c of correosDeValores(data.values ?? [])) correos.add(c);
  }
  return correos;
}

let cache: { cuando: number; correos: Set<string> } | null = null;
let ultimaBuena: Set<string> | null = null;

/** Solo para pruebas. */
export function _reiniciarCachePermisos() {
  cache = null;
  ultimaBuena = null;
}

/**
 * Correos con permiso de marcado manual (caché de 5 min, última lista buena
 * si SharePoint falla, vacío si nunca se pudo leer).
 */
export async function correosConMarcadoManual(
  deps: { leer?: () => Promise<Set<string>>; ahora?: () => number } = {}
): Promise<Set<string>> {
  const ahora = deps.ahora ?? Date.now;
  if (cache && ahora() - cache.cuando < PERMISOS_CACHE_MS) return cache.correos;
  try {
    const correos = await (deps.leer ?? leerPermisosDesdeSharePoint)();
    cache = { cuando: ahora(), correos };
    ultimaBuena = correos;
    return correos;
  } catch (error) {
    console.warn('[portal] No se pudo leer el Excel de permisos de Formación:', (error as Error).message);
    // No se cachea el fallo: el siguiente pedido vuelve a intentar.
    return ultimaBuena ?? new Set();
  }
}

/** ¿Esta persona puede marcar y desmarcar a mano? */
export async function puedeMarcarManual(correo: string): Promise<boolean> {
  return (await correosConMarcadoManual()).has(correo.trim().toLowerCase());
}
