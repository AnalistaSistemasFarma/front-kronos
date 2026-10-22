/**
 * PORTAL TH — FORMULARIOS SST — guardado y lectura de los envíos en SharePoint (Cristian Baldión, 2026-10-20).
 *
 * Cada envío es UN archivo JSON en `FORMULARIOS SST/<código>/<AAAA-MM>/<AAAAMMDDhhmmss>-<huella del correo>-<azar>.json` del sitio de
 * Talento Humano (hora de Colombia), escrito con la misma app de Entra de Formación (`PORTAL_TH_SP_*`). La carpeta se puede cambiar con
 * `PORTAL_TH_SP_FORMULARIOS_SST`. Sin tabla ni SQL.
 *
 * DATOS SENSIBLES (Ley 1581 de 2012): el formulario de salud trae cédula, teléfono y síntomas. Aquí NUNCA se escriben respuestas en los
 * logs; el nombre del archivo lleva solo una huella (hash) del correo, no datos personales; y quién LEE los envíos lo decide
 * `formularios-sst-permisos.ts` en las rutas, no este módulo. La carpeta en SharePoint debe quedar con permisos solo para SST.
 */
import { createHash, randomBytes } from 'node:crypto';
import { FormacionStorageError, FormacionStorageNoConfigurado, esSegmentoValido, obtenerToken } from './formacion-storage';
import { columnasDeRespuestas, type Respuestas } from './formulario';
import {
  MAX_ENVIOS_POR_DIA_SST,
  type EnvioSstGuardado,
  type FilaEnvioSst,
  type FormularioSst,
  type TablaEnviosSst,
} from './formularios-sst';
import { leerConfigPoliticas, type ConfigPoliticas } from './politicas-storage';

export const CARPETA_FORMULARIOS_SST_POR_DEFECTO = 'FORMULARIOS SST';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const PAGINAS_MAX = 20;
const LECTURAS_EN_PARALELO = 8;
type Fetch = typeof fetch;

export interface ConfigFormulariosSst extends Omit<ConfigPoliticas, 'carpeta'> {
  carpeta: string;
}

export function leerConfigFormulariosSst(env: NodeJS.ProcessEnv = process.env): ConfigFormulariosSst {
  const base = leerConfigPoliticas({ ...env, PORTAL_TH_SP_POLICIES_FOLDER: undefined } as NodeJS.ProcessEnv);
  const carpeta = (env.PORTAL_TH_SP_FORMULARIOS_SST ?? '').trim() || CARPETA_FORMULARIOS_SST_POR_DEFECTO;
  if (!esSegmentoValido(carpeta)) throw new FormacionStorageNoConfigurado('PORTAL_TH_SP_FORMULARIOS_SST no es un nombre de carpeta válido.');
  return { ...base, carpeta };
}

/** Error con el mensaje que se le muestra a la persona y el código HTTP. */
export class ErrorEnvioSst extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorEnvioSst';
  }
}

/* ───────────── Nombres, huellas y hora de Colombia ───────────── */

const huella = (texto: string, largo: number) => createHash('sha256').update(texto).digest('hex').slice(0, largo);
/** Huella (8) del correo de quien envía: sirve para contar sus envíos del día sin poner el correo en el nombre del archivo. */
export const huellaCorreoSst = (correo: string) => huella(`sst:${correo.trim().toLowerCase()}`, 8);
/** Huella (12) de la definición del formulario tal como la vio la persona. */
export const huellaDefinicionSst = (f: FormularioSst) => huella(JSON.stringify(f.definicion), 12);

const PARTES_BOGOTA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Mes (`AAAA-MM`), día (`AAAAMMDD`) y marca (`AAAAMMDDhhmmss`) en hora de Colombia. */
export function marcaBogota(fecha: Date): { mes: string; dia: string; marca: string } {
  const p: Record<string, string> = {};
  for (const x of PARTES_BOGOTA.formatToParts(fecha)) p[x.type] = x.value;
  return { mes: `${p.year}-${p.month}`, dia: `${p.year}${p.month}${p.day}`, marca: `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}` };
}

const ARCHIVO = /^[0-9]{14}-[0-9a-f]{8}-[0-9a-f]{6}\.json$/;
const CARPETA_MES = /^[0-9]{4}-[0-9]{2}$/;
export const esNombreArchivoEnvio = (n: unknown): n is string => typeof n === 'string' && ARCHIVO.test(n);
export const nombreArchivoEnvio = (marca: string, huellaCorreo: string, azar: string = randomBytes(3).toString('hex')) => `${marca}-${huellaCorreo}-${azar}.json`;

/* ───────────── Graph ───────────── */

interface Ctx {
  f: Fetch;
  cab: Record<string, string>;
  /** `…/drive/root:/<carpeta>` (sin barra final). */
  base: string;
}

async function contexto(deps: { config?: ConfigFormulariosSst; fetch?: Fetch }): Promise<Ctx> {
  const cfg = deps.config ?? leerConfigFormulariosSst();
  const f = deps.fetch ?? fetch;
  const credencial = await obtenerToken(cfg as unknown as Parameters<typeof obtenerToken>[0], f);
  return {
    f,
    cab: { Authorization: ['Bearer', credencial].join(' ') },
    base: `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/root:/${encodeURIComponent(cfg.carpeta)}`,
  };
}

/** Nombres de los hijos de una ruta (con sus páginas). Una carpeta que todavía no existe es una lista vacía. */
async function listarHijos(c: Ctx, ruta: string): Promise<{ name: string; folder: boolean }[]> {
  const salida: { name: string; folder: boolean }[] = [];
  let url: string | null = `${c.base}/${ruta.split('/').map(encodeURIComponent).join('/')}:/children?$select=name,folder&$top=200`;
  for (let pagina = 0; url && pagina < PAGINAS_MAX; pagina += 1) {
    const res: Response = await c.f(url, { headers: c.cab });
    if (res.status === 404) return salida;
    if (!res.ok) throw new FormacionStorageError(`Graph no listó los envíos (${res.status}).`, res.status);
    const datos = (await res.json().catch(() => null)) as { value?: { name?: string; folder?: unknown }[]; '@odata.nextLink'?: string } | null;
    for (const x of datos?.value ?? []) if (typeof x.name === 'string') salida.push({ name: x.name, folder: x.folder !== undefined });
    url = typeof datos?.['@odata.nextLink'] === 'string' ? datos['@odata.nextLink'] : null;
  }
  return salida;
}

async function leerEnvio(c: Ctx, codigo: string, mes: string, nombre: string): Promise<EnvioSstGuardado | null> {
  const res = await c.f(`${c.base}/${encodeURIComponent(codigo)}/${mes}/${encodeURIComponent(nombre)}:/content`, { headers: c.cab });
  if (!res.ok) return null;
  const e = (await res.json().catch(() => null)) as Partial<EnvioSstGuardado> | null;
  if (!e || e.v !== 1 || typeof e.enviadoPor !== 'string' || typeof e.enviadoEl !== 'string' || !e.respuestas || typeof e.respuestas !== 'object' || Array.isArray(e.respuestas)) return null;
  return e as EnvioSstGuardado;
}

/** Para el catálogo de formularios (`formularios-sst-catalogo.ts`): misma credencial, misma carpeta y mismo listado paginado. */
export { contexto as contextoSst, listarHijos as listarHijosSst };
export type { Ctx as CtxSst };

/* ───────────── Operaciones ───────────── */

interface Deps {
  config?: ConfigFormulariosSst;
  fetch?: Fetch;
  ahora?: Date;
}

export interface NuevoEnvioSst {
  formulario: FormularioSst;
  /** Correo de la SESIÓN. */
  correo: string;
  autorizaDatos: boolean;
  /** Ya validadas por `validarRespuestas`. */
  respuestas: Respuestas;
}

/** Guarda un envío. Lanza `ErrorEnvioSst` (429) si la persona ya hizo demasiados hoy, o un error de almacenamiento si SharePoint falla. */
export async function guardarEnvioSst(p: NuevoEnvioSst, deps: Deps = {}): Promise<{ enviadoEl: string }> {
  const ahora = deps.ahora ?? new Date();
  const c = await contexto(deps);
  const t = marcaBogota(ahora);
  const hCorreo = huellaCorreoSst(p.correo);
  const ruta = `${p.formulario.codigo}/${t.mes}`;

  const hoy = (await listarHijos(c, ruta)).filter((x) => esNombreArchivoEnvio(x.name) && x.name.startsWith(t.dia) && x.name.slice(15, 23) === hCorreo).length;
  if (hoy >= MAX_ENVIOS_POR_DIA_SST) {
    throw new ErrorEnvioSst(429, `Ya envió este formulario ${MAX_ENVIOS_POR_DIA_SST} veces hoy. Si necesita reportar algo más, comuníquese con Seguridad y Salud en el Trabajo.`);
  }

  const registro: EnvioSstGuardado = {
    v: 1,
    codigo: p.formulario.codigo,
    definicion: huellaDefinicionSst(p.formulario),
    enviadoPor: p.correo.trim().toLowerCase(),
    enviadoEl: ahora.toISOString(),
    autorizacion: p.formulario.definicion.autorizacion && p.autorizaDatos ? { version: p.formulario.definicion.autorizacion.version, aceptadoEl: ahora.toISOString() } : null,
    respuestas: p.respuestas,
  };
  const archivo = nombreArchivoEnvio(t.marca, hCorreo);
  const res = await c.f(`${c.base}/${encodeURIComponent(p.formulario.codigo)}/${t.mes}/${encodeURIComponent(archivo)}:/content?@microsoft.graph.conflictBehavior=fail`, {
    method: 'PUT',
    headers: { ...c.cab, 'Content-Type': 'application/json' },
    body: JSON.stringify(registro),
  });
  if (!res.ok) throw new FormacionStorageError(`Graph rechazó guardar el envío (${res.status}).`, res.status);
  return { enviadoEl: registro.enviadoEl };
}

/**
 * Los envíos de un formulario, del más reciente al más antiguo, hasta `limite`. Lee la lista de archivos de todos los meses (barato) y
 * abre solo los más recientes. `total` dice cuántos hay; `truncado`, si quedaron fuera.
 */
export async function listarEnviosSst(formulario: FormularioSst, limite: number, deps: Deps = {}): Promise<TablaEnviosSst> {
  const c = await contexto(deps);
  const meses = (await listarHijos(c, formulario.codigo))
    .filter((x) => x.folder && CARPETA_MES.test(x.name))
    .map((x) => x.name)
    .sort()
    .reverse();

  const archivos: { mes: string; nombre: string }[] = [];
  for (const mes of meses) {
    const nombres = (await listarHijos(c, `${formulario.codigo}/${mes}`))
      .map((x) => x.name)
      .filter(esNombreArchivoEnvio)
      .sort()
      .reverse();
    for (const nombre of nombres) archivos.push({ mes, nombre });
  }

  const elegidos = archivos.slice(0, Math.max(0, limite));
  const filas: FilaEnvioSst[] = [];
  for (let i = 0; i < elegidos.length; i += LECTURAS_EN_PARALELO) {
    const lote = await Promise.all(elegidos.slice(i, i + LECTURAS_EN_PARALELO).map(async (a) => ({ a, e: await leerEnvio(c, formulario.codigo, a.mes, a.nombre) })));
    for (const { a, e } of lote) {
      if (!e) continue; // archivo dañado o ajeno: se omite sin romper la tabla
      filas.push({ id: a.nombre, correo: e.enviadoPor, enviadaEl: e.enviadoEl, autorizacionVersion: e.autorizacion?.version ?? null, respuestas: e.respuestas });
    }
  }

  return {
    formulario: { codigo: formulario.codigo, titulo: formulario.titulo },
    columnas: columnasDeRespuestas(formulario.definicion, []),
    filas,
    total: archivos.length,
    truncado: archivos.length > elegidos.length,
  };
}
