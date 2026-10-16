/**
 * PORTAL DE TALENTO HUMANO — CUMPLEAÑOS en el calendario (Cristian Baldión, 2026-10-15).
 *
 * El calendario del portal muestra, cada día, quiénes cumplen años: el evento «CUMPLEAÑOS» y, debajo, el nombre, la empresa
 * contratante y el área de cada persona. La fuente es el Excel BASE PERSONAL (SharePoint, `CONTACTOS/BASE PERSONAL.xlsx`):
 * la columna «Fecha de nacimiento» es la llave (día y mes); «Apellidos y Nombres», «Empresa contratante» y «Área / Dependencia»
 * son lo que se muestra.
 *
 * SOLO LECTURA, con la misma app de Entra de Formación y Políticas (`PORTAL_TH_SP_*`), por la API de Excel de Graph:
 *
 *   PORTAL_TH_SP_BASE_PERSONAL   ruta del archivo (por defecto `CONTACTOS/BASE PERSONAL.xlsx`)
 *
 * PRIVACIDAD: de la fecha de nacimiento solo se usa el DÍA y el MES, para saber en qué día del calendario va cada persona. El AÑO
 * (la edad) y la cédula NO salen de este archivo: ni se guardan ni viajan al navegador. Solo entran las personas con estado SI.
 */
import { FormacionStorageError, FormacionStorageNoConfigurado, esSegmentoValido, obtenerToken } from './formacion-storage';
import { leerConfigPoliticas, type ConfigPoliticas } from './politicas-storage';

export const RUTA_BASE_PERSONAL_POR_DEFECTO = 'CONTACTOS/BASE PERSONAL.xlsx';
/** Corto: Talento Humano actualiza el archivo cuando quiere y espera verlo pronto. */
export const CUMPLEANOS_CACHE_MS = 5 * 60_000;
const GRAPH = 'https://graph.microsoft.com/v1.0';
type Fetch = typeof fetch;

export interface ConfigCumpleanos extends Omit<ConfigPoliticas, 'carpeta'> {
  ruta: string[];
}

export function leerConfigCumpleanos(env: NodeJS.ProcessEnv = process.env): ConfigCumpleanos {
  const base = leerConfigPoliticas({ ...env, PORTAL_TH_SP_POLICIES_FOLDER: undefined } as NodeJS.ProcessEnv);
  const ruta = ((env.PORTAL_TH_SP_BASE_PERSONAL ?? '').trim() || RUTA_BASE_PERSONAL_POR_DEFECTO).split('/');
  if (ruta.length > 4 || !ruta.every(esSegmentoValido)) {
    throw new FormacionStorageNoConfigurado('PORTAL_TH_SP_BASE_PERSONAL no es una ruta de archivo válida.');
  }
  const { carpeta: _carpeta, ...resto } = base;
  return { ...resto, ruta };
}

/** Lo único que se muestra de cada persona. */
export interface PersonaCumple {
  nombre: string;
  empresa: string;
  area: string;
}

/** Una persona con su día y mes de cumpleaños (sin año). Nunca sale de este módulo hacia el navegador con estos campos. */
interface PersonaConDia extends PersonaCumple {
  mes: number;
  dia: number;
}

export interface CumplesDelDia {
  /** AAAA-MM-DD */
  fecha: string;
  personas: PersonaCumple[];
}

const normalizar = (t: unknown) =>
  String(t ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

const COLUMNAS = {
  nombre: ['APELLIDOS Y NOMBRES', 'NOMBRES Y APELLIDOS', 'NOMBRE'],
  empresa: ['EMPRESA CONTRATANTE'],
  area: ['AREA DEPENDENCIA', 'AREA'],
  nacimiento: ['FECHA DE NACIMIENTO', 'FECHA NACIMIENTO'],
  estado: ['ESTADO ACTIVO SI NO', 'ESTADO'],
} as const;

/** Ubica cada columna por su encabezado (sin tildes ni mayúsculas); lanza si falta una necesaria. */
export function ubicarColumnasCumple(encabezados: unknown[]): Record<keyof typeof COLUMNAS, number> {
  const h = encabezados.map(normalizar);
  const out = {} as Record<keyof typeof COLUMNAS, number>;
  for (const [campo, opciones] of Object.entries(COLUMNAS) as [keyof typeof COLUMNAS, readonly string[]][]) {
    const i = h.findIndex((x) => opciones.some((o) => x === o || (o.length > 5 && x.startsWith(o))));
    if (i < 0 && campo !== 'estado') throw new FormacionStorageError(`BASE PERSONAL no tiene la columna «${opciones[0]}».`);
    out[campo] = i;
  }
  return out;
}

const esBisiesto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
const diasDelMes = (a: number, m: number) => [31, esBisiesto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * Día y mes de una «Fecha de nacimiento». Acepta el número de serie de Excel (lo normal: así lo entrega la API de Excel),
 * `AAAA-MM-DD` y `D/M/AAAA` (en Colombia el día va primero). El año solo sirve para validar que la fecha existe y es de una persona
 * (1900 hasta hoy); no se devuelve. Cualquier otra cosa: null.
 */
export function diaMesDeNacimiento(valor: unknown, hoy: Date = new Date()): { mes: number; dia: number } | null {
  let a: number;
  let m: number;
  let d: number;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 1 || valor > 80000) return null;
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(valor) * 86_400_000);
    [a, m, d] = [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()];
  } else if (typeof valor === 'string') {
    const t = valor.trim().slice(0, 10);
    const trozos = t.split(/[/.-]/).map((x) => x.trim());
    const nums = trozos.map((x) => (/^[0-9]{1,4}$/.test(x) ? Number(x) : NaN));
    if (trozos.length !== 3 || nums.some((n) => Number.isNaN(n))) return null;
    // AAAA-MM-DD (el año va primero y tiene 4 cifras) o D/M/AAAA (en Colombia el día va primero).
    if (trozos[0].length === 4) [a, m, d] = [nums[0], nums[1], nums[2]];
    else if (trozos[2].length === 4) [d, m, a] = [nums[0], nums[1], nums[2]];
    else return null;
  } else return null;
  if (a < 1900 || a > hoy.getUTCFullYear() || m < 1 || m > 12 || d < 1 || d > diasDelMes(a, m)) return null;
  return { mes: m, dia: d };
}

export interface ResultadoHoja {
  personas: PersonaConDia[];
  /** Filas activas con nombre pero sin una fecha de nacimiento utilizable (no aparecen en el calendario). */
  sinFechaValida: number;
}

/** De la matriz de la hoja a las personas con su día y mes. Sin nombre, con estado NO o sin fecha válida no entran. */
export function personasDesdeHojaCumple(valores: unknown[][], hoy: Date = new Date()): ResultadoHoja {
  if (valores.length < 2) return { personas: [], sinFechaValida: 0 };
  const col = ubicarColumnasCumple(valores[0]);
  const personas: PersonaConDia[] = [];
  let sinFechaValida = 0;
  for (const fila of valores.slice(1)) {
    const nombre = texto(fila[col.nombre]);
    if (!nombre) continue;
    if (col.estado >= 0 && normalizar(fila[col.estado]) === 'NO') continue;
    const dm = diaMesDeNacimiento(fila[col.nacimiento], hoy);
    if (!dm) {
      sinFechaValida += 1;
      continue;
    }
    personas.push({ nombre, empresa: texto(fila[col.empresa]), area: texto(fila[col.area]), ...dm });
  }
  return { personas, sinFechaValida };
}

/** `AAAA-MM-DD` real entre 2000 y 2100 (mismo criterio que el calendario). */
const fechaEnRango = (t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t);

/**
 * Los cumpleaños de cada día de [desde, hasta]. Quien nació un 29 de febrero se celebra el 28 de febrero en los años que no son
 * bisiestos. Cada día trae sus personas ordenadas por nombre; los días sin cumpleaños no aparecen.
 */
export function cumpleanosEnRango(personas: PersonaConDia[], desde: string, hasta: string): CumplesDelDia[] {
  if (!fechaEnRango(desde) || !fechaEnRango(hasta) || hasta < desde) return [];
  const porClave = new Map<string, PersonaCumple[]>();
  for (const p of personas) {
    const k = `${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
    porClave.set(k, [...(porClave.get(k) ?? []), { nombre: p.nombre, empresa: p.empresa, area: p.area }]);
  }
  const salida: CumplesDelDia[] = [];
  const fin = new Date(`${hasta}T00:00:00Z`).getTime();
  for (let t = new Date(`${desde}T00:00:00Z`).getTime(); t <= fin; t += 86_400_000) {
    const f = new Date(t);
    const a = f.getUTCFullYear();
    const m = f.getUTCMonth() + 1;
    const d = f.getUTCDate();
    const clave = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let lista = porClave.get(clave) ?? [];
    if (m === 2 && d === 28 && !esBisiesto(a)) lista = [...lista, ...(porClave.get('02-29') ?? [])];
    if (lista.length > 0) {
      salida.push({
        fecha: `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        personas: [...lista].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')),
      });
    }
  }
  return salida;
}

let cache: { clave: string; cuando: number; personas: PersonaConDia[] } | null = null;
export function _reiniciarCacheCumpleanos() {
  cache = null;
}

/** Lee BASE PERSONAL y devuelve las personas con su día y mes (en memoria unos minutos). */
export async function leerPersonasConCumple(deps: { config?: ConfigCumpleanos; fetch?: Fetch; ahora?: () => number } = {}): Promise<PersonaConDia[]> {
  const cfg = deps.config ?? leerConfigCumpleanos();
  const f = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const clave = `${cfg.siteId}|${cfg.ruta.join('/')}`;
  if (cache && cache.clave === clave && ahora() - cache.cuando < CUMPLEANOS_CACHE_MS) return cache.personas;

  const token = await obtenerToken(cfg as unknown as Parameters<typeof obtenerToken>[0], f);
  const cabecera = { Authorization: ['Bearer', token].join(' ') };
  const sitio = `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}`;
  const meta = await f(`${sitio}/drive/root:/${cfg.ruta.map(encodeURIComponent).join('/')}:?$select=id`, { headers: cabecera });
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

  const { personas } = personasDesdeHojaCumple(valores);
  cache = { clave, cuando: ahora(), personas };
  return personas;
}
