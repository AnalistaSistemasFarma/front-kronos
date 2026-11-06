/**
 * PORTAL TH — FORMULARIOS SST — catálogo: los del código y los que crea el administrador (Cristian Baldión, 2026-10-20).
 *
 * Los dos formularios que ya existen (B1 y B2) vienen EN EL CÓDIGO y siempre están disponibles: los botones de la página principal
 * dependen de ellos. Lo que el administrador crea o edita desde el constructor visual se guarda como archivos JSON en SharePoint:
 *
 *   FORMULARIOS SST/DEFINICIONES/<código>/<AAAAMMDDhhmmss>.json      (una versión por archivo; la más reciente es la vigente)
 *
 * No se borra nada: cada guardado es una versión nueva y «retirar» agrega una versión de retiro. Los envíos ya recibidos guardan la huella
 * de la definición con la que se respondieron (`formularios-sst-servidor.ts`), así que se sabe con qué versión contestó cada persona.
 *
 * Una definición guardada con el mismo código que una del código la REEMPLAZA (así se pueden editar B1 y B2). Si SharePoint no responde,
 * el catálogo cae a lo último que leyó o, si no hay nada, a los del código: los formularios básicos no dejan de funcionar.
 * Quién puede crear, editar y retirar lo decide la ruta (`formularios-sst-permisos.ts`), no este módulo.
 */
import { FormacionStorageError } from './formacion-storage';
import { validarDefinicion } from './formulario';
import {
  CODIGOS_RESERVADOS_SST,
  CODIGO_FORMULARIO_SST,
  FORMULARIOS_SST,
  MAX_BYTES_DEFINICION_SST,
  MAX_FORMULARIOS_SST_PERSONALIZADOS,
  cargarFormularioSst,
  type FormularioSstActual,
} from './formularios-sst';
import { contextoSst, listarHijosSst, marcaBogota, type ConfigFormulariosSst } from './formularios-sst-servidor';

export const CARPETA_DEFINICIONES_SST = 'DEFINICIONES';
export const CATALOGO_CACHE_MS = 60_000;
const VERSION_ARCHIVO = /^[0-9]{14}\.json$/;
const INTENTOS_POR_FORMULARIO = 3;
type Fetch = typeof fetch;

/** Error con lo que se le dice a la persona, el código HTTP y, si aplica, la lista de problemas del formulario. */
export class ErrorCatalogoSst extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string,
    public readonly errores: string[] = []
  ) {
    super(mensaje);
    this.name = 'ErrorCatalogoSst';
  }
}

interface Deps {
  config?: ConfigFormulariosSst;
  fetch?: Fetch;
  ahora?: Date;
}

/** Lo que dice un archivo de versión. */
interface Guardado {
  codigo: string;
  guardadoEl: string;
  retirado: boolean;
  definicion: unknown;
}

let cache: { cuando: number; lista: FormularioSstActual[] } | null = null;
export function _reiniciarCacheCatalogoSst() {
  cache = null;
}

const delCodigo = (): FormularioSstActual[] => FORMULARIOS_SST.map((f) => ({ ...f, origen: 'base' as const, guardadoEl: null, editado: false }));
const esDelCodigo = (codigo: string) => FORMULARIOS_SST.some((f) => f.codigo === codigo);

/** La versión más reciente VÁLIDA de cada formulario guardado (si la última está dañada, se usa la anterior). */
async function leerGuardados(deps: Deps): Promise<Guardado[]> {
  const c = await contextoSst(deps);
  const carpetas = (await listarHijosSst(c, CARPETA_DEFINICIONES_SST)).filter((x) => x.folder && CODIGO_FORMULARIO_SST.test(x.name));
  const porCodigo = await Promise.all(
    carpetas.map(async (carpeta): Promise<Guardado | null> => {
      const versiones = (await listarHijosSst(c, `${CARPETA_DEFINICIONES_SST}/${carpeta.name}`))
        .map((x) => x.name)
        .filter((n) => VERSION_ARCHIVO.test(n))
        .sort()
        .reverse()
        .slice(0, INTENTOS_POR_FORMULARIO);
      for (const v of versiones) {
        const res = await c.f(`${c.base}/${CARPETA_DEFINICIONES_SST}/${encodeURIComponent(carpeta.name)}/${v}:/content`, { headers: c.cab });
        if (!res.ok) continue;
        const a = (await res.json().catch(() => null)) as { v?: unknown; guardadoEl?: unknown; retirado?: unknown; definicion?: unknown } | null;
        if (!a || a.v !== 1 || typeof a.guardadoEl !== 'string') continue;
        if (a.retirado === true) return { codigo: carpeta.name, guardadoEl: a.guardadoEl, retirado: true, definicion: null };
        try {
          const f = cargarFormularioSst(a.definicion);
          // La carpeta manda: un archivo con otro código dentro no puede suplantar a otro formulario.
          if (f.codigo !== carpeta.name) continue;
          return { codigo: carpeta.name, guardadoEl: a.guardadoEl, retirado: false, definicion: a.definicion };
        } catch {
          continue; // versión dañada: se prueba con la anterior
        }
      }
      return null;
    })
  );
  return porCodigo.filter((g): g is Guardado => g !== null);
}

function armar(guardados: Guardado[]): FormularioSstActual[] {
  const vigentes = new Map(guardados.filter((g) => !g.retirado).map((g) => [g.codigo, g]));
  const base: FormularioSstActual[] = FORMULARIOS_SST.map((b) => {
    const g = vigentes.get(b.codigo);
    return g ? { ...cargarFormularioSst(g.definicion), origen: 'base' as const, guardadoEl: g.guardadoEl, editado: true } : { ...b, origen: 'base' as const, guardadoEl: null, editado: false };
  });
  const propios = [...vigentes.values()]
    .filter((g) => !esDelCodigo(g.codigo))
    .map((g): FormularioSstActual => ({ ...cargarFormularioSst(g.definicion), origen: 'personalizado', guardadoEl: g.guardadoEl, editado: false }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  return [...base, ...propios];
}

/**
 * Los formularios disponibles, en el orden en que se muestran: primero los del código (B1 y B2), luego los creados por el administrador.
 * Se recuerdan un minuto. Si SharePoint falla, devuelve lo último que se leyó o los del código.
 */
export async function listarFormulariosSst(deps: Deps = {}): Promise<FormularioSstActual[]> {
  const ahora = deps.ahora?.getTime() ?? Date.now();
  if (cache && ahora - cache.cuando < CATALOGO_CACHE_MS) return cache.lista;
  try {
    const lista = armar(await leerGuardados(deps));
    cache = { cuando: ahora, lista };
    return lista;
  } catch (error) {
    // Solo el tipo del error: un mensaje de Graph no debe llegar a los logs con datos de nadie.
    console.error('[portal] Catálogo de formularios SST: SharePoint no disponible, se usa lo último conocido:', error instanceof FormacionStorageError ? error.message : (error as Error).name);
    return cache?.lista ?? delCodigo();
  }
}

/** El formulario con ese código, o null (también si el valor no es un texto). */
export async function formularioSstActual(codigo: unknown, deps: Deps = {}): Promise<FormularioSstActual | null> {
  if (typeof codigo !== 'string') return null;
  return (await listarFormulariosSst(deps)).find((f) => f.codigo === codigo) ?? null;
}

/**
 * Para el administrador: lee SharePoint SIN caché y SIN disfrazar un fallo (si no se pudo leer, lanza). Así quien edita nunca parte de
 * los formularios del código creyendo que son los vigentes cuando en realidad había una versión guardada que no se pudo leer.
 */
export async function catalogoParaAdministrar(deps: Deps = {}): Promise<{ formularios: FormularioSstActual[]; guardados: string[] }> {
  const guardados = await leerGuardados(deps);
  const formularios = armar(guardados);
  cache = { cuando: deps.ahora?.getTime() ?? Date.now(), lista: formularios };
  return { formularios, guardados: guardados.map((g) => g.codigo) };
}

export interface GuardarDefinicionSst {
  /** La definición tal como la arma el constructor. */
  definicion: unknown;
  /** `true`: formulario NUEVO (no puede existir el código); `false`: edición (tiene que existir). */
  nuevo: boolean;
  /** Correo de la SESIÓN del administrador. */
  correo: string;
}

/** Guarda un formulario (nuevo o una versión nueva). Lanza `ErrorCatalogoSst`. */
export async function guardarDefinicionSst(p: GuardarDefinicionSst, deps: Deps = {}): Promise<FormularioSstActual> {
  if (typeof p.definicion !== 'object' || p.definicion === null || Array.isArray(p.definicion)) throw new ErrorCatalogoSst(400, 'La definición del formulario no es válida.');
  if (Buffer.byteLength(JSON.stringify(p.definicion), 'utf8') > MAX_BYTES_DEFINICION_SST) throw new ErrorCatalogoSst(413, 'El formulario es demasiado grande.');
  const validacion = validarDefinicion(p.definicion);
  if (!validacion.ok) throw new ErrorCatalogoSst(422, 'Revise el formulario.', validacion.errores);
  const def = validacion.definicion;
  if (def.tipo === 'evaluacion') throw new ErrorCatalogoSst(422, 'Los formularios SST son encuestas, no evaluaciones.', ['Los formularios SST son encuestas, no evaluaciones.']);
  if (!CODIGO_FORMULARIO_SST.test(def.codigo) || (CODIGOS_RESERVADOS_SST as readonly string[]).includes(def.codigo.toLowerCase())) {
    const m = 'El código solo puede llevar letras, números, guion y guion bajo (de 3 a 60 caracteres) y no puede ser «DEFINICIONES».';
    throw new ErrorCatalogoSst(422, m, [m]);
  }

  const { formularios, guardados } = await catalogoParaAdministrar(deps);
  const existe = esDelCodigo(def.codigo) || guardados.includes(def.codigo);
  if (p.nuevo) {
    if (existe) throw new ErrorCatalogoSst(409, 'Ya existe un formulario con ese código (puede estar retirado). Cambie el código.');
    if (formularios.filter((f) => f.origen === 'personalizado').length >= MAX_FORMULARIOS_SST_PERSONALIZADOS) {
      throw new ErrorCatalogoSst(422, `Ya hay ${MAX_FORMULARIOS_SST_PERSONALIZADOS} formularios propios. Retire alguno antes de crear otro.`);
    }
  } else if (!formularios.some((f) => f.codigo === def.codigo)) {
    throw new ErrorCatalogoSst(404, 'Ese formulario no existe o fue retirado.');
  }

  const ahora = deps.ahora ?? new Date();
  const c = await contextoSst(deps);
  const archivo = `${marcaBogota(ahora).marca}.json`;
  const res = await c.f(`${c.base}/${CARPETA_DEFINICIONES_SST}/${encodeURIComponent(def.codigo)}/${archivo}:/content?@microsoft.graph.conflictBehavior=fail`, {
    method: 'PUT',
    headers: { ...c.cab, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, guardadoPor: p.correo.trim().toLowerCase(), guardadoEl: ahora.toISOString(), definicion: def }),
  });
  if (res.status === 409) throw new ErrorCatalogoSst(409, 'Se guardó otra versión de este formulario al mismo tiempo. Ábralo de nuevo e inténtelo otra vez.');
  if (!res.ok) throw new FormacionStorageError(`Graph rechazó guardar la definición (${res.status}).`, res.status);
  _reiniciarCacheCatalogoSst();
  return { ...cargarFormularioSst(def), origen: esDelCodigo(def.codigo) ? 'base' : 'personalizado', guardadoEl: ahora.toISOString(), editado: esDelCodigo(def.codigo) };
}

/** Retira un formulario creado por el administrador (deja de mostrarse y de recibir envíos; sus respuestas y versiones se conservan). */
export async function retirarFormularioSst(p: { codigo: unknown; correo: string }, deps: Deps = {}): Promise<void> {
  if (typeof p.codigo !== 'string' || !CODIGO_FORMULARIO_SST.test(p.codigo)) throw new ErrorCatalogoSst(400, 'El código no es válido.');
  if (esDelCodigo(p.codigo)) throw new ErrorCatalogoSst(400, 'Los formularios del sistema (B1 y B2) no se pueden retirar; sí se pueden editar.');
  const { formularios } = await catalogoParaAdministrar(deps);
  if (!formularios.some((f) => f.codigo === p.codigo)) throw new ErrorCatalogoSst(404, 'Ese formulario no existe o ya fue retirado.');
  const ahora = deps.ahora ?? new Date();
  const c = await contextoSst(deps);
  const res = await c.f(`${c.base}/${CARPETA_DEFINICIONES_SST}/${encodeURIComponent(p.codigo)}/${marcaBogota(ahora).marca}.json:/content?@microsoft.graph.conflictBehavior=fail`, {
    method: 'PUT',
    headers: { ...c.cab, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, guardadoPor: p.correo.trim().toLowerCase(), guardadoEl: ahora.toISOString(), retirado: true }),
  });
  if (res.status === 409) throw new ErrorCatalogoSst(409, 'Se guardó otra versión de este formulario al mismo tiempo. Inténtelo otra vez.');
  if (!res.ok) throw new FormacionStorageError(`Graph rechazó retirar el formulario (${res.status}).`, res.status);
  _reiniciarCacheCatalogoSst();
}
