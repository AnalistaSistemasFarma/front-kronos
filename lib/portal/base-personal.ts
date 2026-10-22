/**
 * PORTAL TH — lectura de BASE PERSONAL (Excel en SharePoint) para el ORGANIGRAMA (Cristian Baldión, 2026-10-15).
 *
 * SOLO LECTURA, con la misma app de Entra de Formación y Políticas (`PORTAL_TH_SP_*`). Lee la hoja con la API de Excel de Graph
 * (sin librería para abrir el .xlsx). De cada fila toma SOLO empresa, nombre, área, cargo, correo corporativo y estado:
 * la CÉDULA y el resto de columnas no se leen y jamás salen de aquí.
 *
 *   PORTAL_TH_SP_BASE_PERSONAL   ruta del archivo (por defecto `CONTACTOS/BASE PERSONAL.xlsx`)
 */
import { FormacionStorageError, FormacionStorageNoConfigurado, esSegmentoValido, obtenerToken } from './formacion-storage';
import { leerConfigPoliticas, type ConfigPoliticas } from './politicas-storage';
import { normalizarCargo, type PersonaOrganigrama } from './organigrama';

export const RUTA_BASE_PERSONAL_POR_DEFECTO = 'CONTACTOS/BASE PERSONAL.xlsx';
/** Corto: Talento Humano actualiza el archivo cuando quiere y se espera verlo pronto. */
export const BASE_PERSONAL_CACHE_MS = 5 * 60_000;
const GRAPH = 'https://graph.microsoft.com/v1.0';
type Fetch = typeof fetch;

export interface ConfigBasePersonal extends Omit<ConfigPoliticas, 'carpeta'> {
  /** Ruta del archivo, por segmentos. */
  ruta: string[];
}

export function leerConfigBasePersonal(env: NodeJS.ProcessEnv = process.env): ConfigBasePersonal {
  const base = leerConfigPoliticas({ ...env, PORTAL_TH_SP_POLICIES_FOLDER: undefined } as NodeJS.ProcessEnv);
  const ruta = ((env.PORTAL_TH_SP_BASE_PERSONAL ?? '').trim() || RUTA_BASE_PERSONAL_POR_DEFECTO).split('/');
  if (ruta.length > 4 || !ruta.every(esSegmentoValido)) {
    throw new FormacionStorageNoConfigurado('PORTAL_TH_SP_BASE_PERSONAL no es una ruta de archivo válida.');
  }
  const { carpeta: _carpeta, ...resto } = base;
  return { ...resto, ruta };
}

const COLUMNAS = {
  empresa: ['EMPRESA'],
  nombre: ['APELLIDOS Y NOMBRES', 'NOMBRES Y APELLIDOS', 'NOMBRE'],
  area: ['AREA DEPENDENCIA', 'AREA'],
  cargo: ['CARGO'],
  correo: ['CORREO CORPORATIVO', 'CORREO'],
  estado: ['ESTADO ACTIVO SI NO', 'ESTADO'],
} as const;

/** Encuentra cada columna por el nombre de su encabezado (sin tildes ni mayúsculas); lanza si falta una necesaria. */
export function ubicarColumnas(encabezados: unknown[]): Record<keyof typeof COLUMNAS, number> {
  const normalizados = encabezados.map((e) => normalizarCargo(e));
  const out = {} as Record<keyof typeof COLUMNAS, number>;
  for (const [campo, opciones] of Object.entries(COLUMNAS) as [keyof typeof COLUMNAS, readonly string[]][]) {
    const i = normalizados.findIndex((h) => opciones.some((o) => h === o || (o.length > 5 && h.startsWith(o))));
    if (i < 0 && campo !== 'estado') throw new FormacionStorageError(`BASE PERSONAL no tiene la columna «${opciones[0]}».`);
    out[campo] = i;
  }
  return out;
}

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** De la matriz de la hoja a personas. Sin cargo o con estado NO no entran; la cédula ni se mira. */
export function personasDesdeHoja(valores: unknown[][]): PersonaOrganigrama[] {
  if (valores.length < 2) return [];
  const col = ubicarColumnas(valores[0]);
  const personas: PersonaOrganigrama[] = [];
  for (const fila of valores.slice(1)) {
    const cargo = texto(fila[col.cargo]);
    const nombre = texto(fila[col.nombre]);
    if (!cargo || !nombre) continue;
    if (col.estado >= 0 && normalizarCargo(fila[col.estado]) === 'NO') continue;
    personas.push({ empresa: texto(fila[col.empresa]), nombre, area: texto(fila[col.area]), cargo, correo: texto(fila[col.correo]) });
  }
  return personas;
}

let cache: { clave: string; cuando: number; personas: PersonaOrganigrama[] } | null = null;
export function _reiniciarCacheBasePersonal() {
  cache = null;
}

export async function leerBasePersonal(deps: { config?: ConfigBasePersonal; fetch?: Fetch; ahora?: () => number } = {}): Promise<PersonaOrganigrama[]> {
  const cfg = deps.config ?? leerConfigBasePersonal();
  const f = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const clave = `${cfg.siteId}|${cfg.ruta.join('/')}`;
  if (cache && cache.clave === clave && ahora() - cache.cuando < BASE_PERSONAL_CACHE_MS) return cache.personas;

  const token = await obtenerToken(cfg as unknown as Parameters<typeof obtenerToken>[0], f);
  const cabecera = { Authorization: `Bearer ${token}` };
  const sitio = `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}`;
  const archivo = `${sitio}/drive/root:/${cfg.ruta.map(encodeURIComponent).join('/')}:`;

  const meta = await f(`${archivo}?$select=id`, { headers: cabecera });
  if (!meta.ok) throw new FormacionStorageError(`Graph no encontró BASE PERSONAL (${meta.status}).`, meta.status);
  const id = ((await meta.json().catch(() => null)) as { id?: string } | null)?.id;
  if (!id) throw new FormacionStorageError('Graph no devolvió el archivo BASE PERSONAL.');

  const libro = `${sitio}/drive/items/${encodeURIComponent(id)}/workbook`;
  const hojas = await f(`${libro}/worksheets?$select=name&$top=1`, { headers: cabecera });
  if (!hojas.ok) throw new FormacionStorageError(`Graph no abrió el libro de BASE PERSONAL (${hojas.status}).`, hojas.status);
  const nombreHoja = ((await hojas.json().catch(() => null)) as { value?: { name?: string }[] } | null)?.value?.[0]?.name;
  if (!nombreHoja) throw new FormacionStorageError('BASE PERSONAL no tiene hojas.');

  const rango = await f(`${libro}/worksheets/${encodeURIComponent(nombreHoja)}/usedRange?$select=values`, { headers: cabecera });
  if (!rango.ok) throw new FormacionStorageError(`Graph no leyó la hoja de BASE PERSONAL (${rango.status}).`, rango.status);
  const valores = ((await rango.json().catch(() => null)) as { values?: unknown[][] } | null)?.values;
  if (!Array.isArray(valores)) throw new FormacionStorageError('Graph devolvió la hoja de BASE PERSONAL sin datos.');

  const personas = personasDesdeHoja(valores);
  cache = { clave, cuando: ahora(), personas };
  return personas;
}
