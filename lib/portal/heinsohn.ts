/**
 * PORTAL DE TALENTO HUMANO — HEINSOHN NÓMINA — lectura del Excel «PORTAL NOMINA» (Cristian Baldión, 2026-10-15).
 *
 * El botón «HEINSOHN NÓMINA» del panel abre una ventana con un botón por empresa; cada uno lleva a su acceso al portal de nómina
 * de Heinsohn. La lista sale del Excel `HEINSOHN NOMINA/PORTAL NOMINA.xlsx` (SharePoint TalentoHumano) con dos columnas,
 * «EMPRESA» y «LINK DE ACCESO», para que Talento Humano agregue o cambie empresas sin pedir un cambio de código.
 *
 * SOLO LECTURA, con la misma app de Entra de Formación y Políticas (`PORTAL_TH_SP_*`), por la API de Excel de Graph.
 *
 *   PORTAL_TH_SP_HEINSOHN   ruta del archivo (por defecto `HEINSOHN NOMINA/PORTAL NOMINA.xlsx`)
 *
 * El enlace de cada fila debe ser una dirección `https://` escrita como TEXTO en la celda. Cualquier otra cosa (`http://`,
 * `javascript:`, sin dirección, con usuario y clave dentro) se omite y se avisa: el enlace va a un `<a>` que abre otro sitio.
 */
import { FormacionStorageError, FormacionStorageNoConfigurado, esSegmentoValido, obtenerToken } from './formacion-storage';
import { leerConfigPoliticas, type ConfigPoliticas } from './politicas-storage';

export const RUTA_HEINSOHN_POR_DEFECTO = 'HEINSOHN NOMINA/PORTAL NOMINA.xlsx';
/** Corto: Talento Humano agrega empresas cuando quiere y espera verlas pronto. */
export const HEINSOHN_CACHE_MS = 2 * 60_000;
export const MAX_EMPRESAS = 60;
const GRAPH = 'https://graph.microsoft.com/v1.0';
type Fetch = typeof fetch;

export interface ConfigHeinsohn extends Omit<ConfigPoliticas, 'carpeta'> {
  /** Ruta del archivo, por segmentos. */
  ruta: string[];
}

export interface EmpresaHeinsohn {
  nombre: string;
  url: string;
}

export interface ListadoHeinsohn {
  empresas: EmpresaHeinsohn[];
  /** Filas con nombre pero con un enlace que no sirve (se avisa quiénes son; no se muestran como botón). */
  omitidas: string[];
}

export function leerConfigHeinsohn(env: NodeJS.ProcessEnv = process.env): ConfigHeinsohn {
  const base = leerConfigPoliticas({ ...env, PORTAL_TH_SP_POLICIES_FOLDER: undefined } as NodeJS.ProcessEnv);
  const ruta = ((env.PORTAL_TH_SP_HEINSOHN ?? '').trim() || RUTA_HEINSOHN_POR_DEFECTO).split('/');
  if (ruta.length > 4 || !ruta.every(esSegmentoValido)) {
    throw new FormacionStorageNoConfigurado('PORTAL_TH_SP_HEINSOHN no es una ruta de archivo válida.');
  }
  const { carpeta: _carpeta, ...resto } = base;
  return { ...resto, ruta };
}

const normalizar = (t: unknown) =>
  String(t ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Una dirección https sin usuario ni clave; devuelve la dirección normalizada o null. */
export function enlaceValido(valor: unknown): string | null {
  const t = texto(valor);
  if (!t || t.length > 2000) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Ubica las columnas por su encabezado (sin tildes ni mayúsculas). */
export function ubicarColumnasHeinsohn(encabezados: unknown[]): { empresa: number; enlace: number } {
  const h = encabezados.map(normalizar);
  const empresa = h.findIndex((x) => x === 'EMPRESA' || x.startsWith('EMPRESA '));
  const enlace = h.findIndex((x) => x.startsWith('LINK') || x.startsWith('ENLACE') || x === 'URL');
  if (empresa < 0) throw new FormacionStorageError('El Excel de nómina no tiene la columna «EMPRESA».');
  if (enlace < 0) throw new FormacionStorageError('El Excel de nómina no tiene la columna «LINK DE ACCESO».');
  return { empresa, enlace };
}

/** De la matriz de la hoja a la lista de empresas (en el mismo orden del Excel, sin repetidas). */
export function empresasDesdeHoja(valores: unknown[][]): ListadoHeinsohn {
  if (valores.length < 2) return { empresas: [], omitidas: [] };
  const col = ubicarColumnasHeinsohn(valores[0]);
  const empresas: EmpresaHeinsohn[] = [];
  const omitidas: string[] = [];
  const vistas = new Set<string>();
  for (const fila of valores.slice(1)) {
    const nombre = texto(fila[col.empresa]);
    const crudo = texto(fila[col.enlace]);
    if (!nombre && !crudo) continue; // fila vacía
    if (!nombre) continue;
    const url = enlaceValido(crudo);
    if (!url) {
      omitidas.push(nombre);
      continue;
    }
    const clave = `${normalizar(nombre)}|${url}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    if (empresas.length < MAX_EMPRESAS) empresas.push({ nombre, url });
  }
  return { empresas, omitidas };
}

let cache: { clave: string; cuando: number; listado: ListadoHeinsohn } | null = null;
export function _reiniciarCacheHeinsohn() {
  cache = null;
}

export async function leerEmpresasHeinsohn(deps: { config?: ConfigHeinsohn; fetch?: Fetch; ahora?: () => number } = {}): Promise<ListadoHeinsohn> {
  const cfg = deps.config ?? leerConfigHeinsohn();
  const f = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const clave = `${cfg.siteId}|${cfg.ruta.join('/')}`;
  if (cache && cache.clave === clave && ahora() - cache.cuando < HEINSOHN_CACHE_MS) return cache.listado;

  const token = await obtenerToken(cfg as unknown as Parameters<typeof obtenerToken>[0], f);
  const cabecera = { Authorization: `Bearer ${token}` };
  const sitio = `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}`;

  const meta = await f(`${sitio}/drive/root:/${cfg.ruta.map(encodeURIComponent).join('/')}:?$select=id`, { headers: cabecera });
  if (!meta.ok) throw new FormacionStorageError(`Graph no encontró el Excel de nómina (${meta.status}).`, meta.status);
  const id = ((await meta.json().catch(() => null)) as { id?: string } | null)?.id;
  if (!id) throw new FormacionStorageError('Graph no devolvió el Excel de nómina.');

  const libro = `${sitio}/drive/items/${encodeURIComponent(id)}/workbook`;
  const hojas = await f(`${libro}/worksheets?$select=name&$top=1`, { headers: cabecera });
  if (!hojas.ok) throw new FormacionStorageError(`Graph no abrió el libro de nómina (${hojas.status}).`, hojas.status);
  const nombreHoja = ((await hojas.json().catch(() => null)) as { value?: { name?: string }[] } | null)?.value?.[0]?.name;
  if (!nombreHoja) throw new FormacionStorageError('El Excel de nómina no tiene hojas.');

  const rango = await f(`${libro}/worksheets/${encodeURIComponent(nombreHoja)}/usedRange?$select=values`, { headers: cabecera });
  if (!rango.ok) throw new FormacionStorageError(`Graph no leyó la hoja de nómina (${rango.status}).`, rango.status);
  const valores = ((await rango.json().catch(() => null)) as { values?: unknown[][] } | null)?.values;
  if (!Array.isArray(valores)) throw new FormacionStorageError('Graph devolvió la hoja de nómina sin datos.');

  const listado = empresasDesdeHoja(valores);
  cache = { clave, cuando: ahora(), listado };
  return listado;
}
