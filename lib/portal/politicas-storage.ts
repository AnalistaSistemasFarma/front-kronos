/**
 * PORTAL DE TALENTO HUMANO — POLÍTICAS Y REGLAMENTOS — lectura por Graph.
 *
 * Pedido de Cristian Baldión (2026-10-08): un botón "VISUALIZAR" en la
 * sección "Políticas y reglamentos" que abra una ventana con TODOS los
 * archivos de la carpeta `POLITICAS Y REGLAMENTOS` de la biblioteca
 * "Documentos compartidos" del sitio TalentoHumano, con vista previa embebida.
 *
 * Usa la MISMA app de Entra que Formación (SynerLink-PortalTH-Formacion,
 * `Sites.Selected` sobre el sitio TalentoHumano) y sus variables
 * `PORTAL_TH_SP_*`. Este módulo es de SOLO LECTURA: lista la carpeta y pide a
 * Graph la URL de vista previa (`driveItem/preview`). No sube, no mueve, no
 * borra. El token y el secreto nunca salen del servidor.
 *
 * Variable propia:
 *   PORTAL_TH_SP_POLICIES_FOLDER  carpeta (un solo segmento) dentro de la
 *                                 biblioteca. Por defecto "POLITICAS Y REGLAMENTOS".
 *
 * SUBCARPETAS: se APLANAN. Se recorren hasta `PROFUNDIDAD_MAX` niveles y cada
 * archivo lleva `carpeta` (ruta relativa, "" si está en la raíz) para que la
 * ventana los agrupe por subcarpeta. Para una carpeta de políticas, con pocos
 * archivos, una sola lista agrupada es más fácil en el celular que navegar
 * carpeta por carpeta.
 */
import 'server-only';
import {
  FormacionStorageNoConfigurado,
  VARIABLES_OBLIGATORIAS,
  esSegmentoValido,
  obtenerToken,
} from './formacion-storage';

export const CARPETA_POLITICAS_POR_DEFECTO = 'POLITICAS Y REGLAMENTOS';
/** Cuánto se recuerda el listado. Corto: Talento Humano publica cuando quiere. */
export const POLITICAS_CACHE_MS = 2 * 60_000;
/** Niveles de subcarpetas que se recorren (la raíz es el 0). */
export const PROFUNDIDAD_MAX = 3;
/** Tope de archivos: una carpeta de políticas no debería tener más. */
export const MAX_ARCHIVOS = 300;

const GRAPH = 'https://graph.microsoft.com/v1.0';
type Fetch = typeof fetch;

export interface ConfigPoliticas {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  carpeta: string;
}

export interface ArchivoPolitica {
  id: string;
  nombre: string;
  /** Extensión en minúsculas, sin punto ("pdf", "docx"…), o "" si no tiene. */
  tipo: string;
  mime: string | null;
  tamano: number;
  modificado: string | null;
  /** Subcarpeta relativa a la carpeta de políticas; "" = raíz. */
  carpeta: string;
}

export interface ListadoPoliticas {
  carpeta: string;
  archivos: ArchivoPolitica[];
  /** true si se cortó por `MAX_ARCHIVOS` o `PROFUNDIDAD_MAX`. */
  truncado: boolean;
}

/** Graph respondió con error. `status` es el de Graph. */
export class PoliticasError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'PoliticasError';
  }
}

/** Lee la configuración. Lanza `FormacionStorageNoConfigurado` si falta algo. */
export function leerConfigPoliticas(env: NodeJS.ProcessEnv = process.env): ConfigPoliticas {
  const faltantes = VARIABLES_OBLIGATORIAS.filter((v) => !(env[v] ?? '').trim());
  if (faltantes.length) {
    throw new FormacionStorageNoConfigurado(`Faltan variables de entorno: ${faltantes.join(', ')}`);
  }
  const carpeta = (env.PORTAL_TH_SP_POLICIES_FOLDER ?? '').trim() || CARPETA_POLITICAS_POR_DEFECTO;
  if (!esSegmentoValido(carpeta)) {
    throw new FormacionStorageNoConfigurado(`PORTAL_TH_SP_POLICIES_FOLDER no es un nombre de carpeta válido: "${carpeta}"`);
  }
  return {
    tenantId: env.PORTAL_TH_SP_TENANT_ID!.trim(),
    clientId: env.PORTAL_TH_SP_CLIENT_ID!.trim(),
    clientSecret: env.PORTAL_TH_SP_CLIENT_SECRET!.trim(),
    siteId: env.PORTAL_TH_SP_SITE_ID!.trim(),
    carpeta,
  };
}

/** Un driveItemId de SharePoint: letras, dígitos y `!._-`. */
export function esIdValido(id: string): boolean {
  return /^[A-Za-z0-9!._-]{1,200}$/.test(id);
}

interface ItemGraph {
  id?: string;
  name?: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
}

const extension = (nombre: string) => {
  const punto = nombre.lastIndexOf('.');
  return punto > 0 ? nombre.slice(punto + 1).toLowerCase() : '';
};

const codificarRuta = (ruta: string) => ruta.split('/').map(encodeURIComponent).join('/');

let cache: { clave: string; cuando: number; listado: ListadoPoliticas } | null = null;

/** Solo para pruebas. */
export function _reiniciarCachePoliticas() {
  cache = null;
}

/**
 * Lista (aplanado) los archivos de la carpeta de políticas, con caché de
 * `POLITICAS_CACHE_MS`. Ordena por subcarpeta y luego por nombre.
 */
export async function listarPoliticas(
  deps: { config?: ConfigPoliticas; fetch?: Fetch; ahora?: () => number } = {}
): Promise<ListadoPoliticas> {
  const cfg = deps.config ?? leerConfigPoliticas();
  const f = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const clave = `${cfg.siteId}|${cfg.carpeta}`;
  if (cache && cache.clave === clave && ahora() - cache.cuando < POLITICAS_CACHE_MS) return cache.listado;

  const token = await obtenerToken(cfg, f);
  const auth = { Authorization: `Bearer ${token}` };
  const sitio = `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive`;
  const archivos: ArchivoPolitica[] = [];
  let truncado = false;

  const recorrer = async (relativa: string, nivel: number): Promise<void> => {
    const ruta = relativa ? `${cfg.carpeta}/${relativa}` : cfg.carpeta;
    let url: string | null =
      `${sitio}/root:/${codificarRuta(ruta)}:/children` +
      '?$top=200&$select=id,name,size,lastModifiedDateTime,file,folder';
    const subcarpetas: string[] = [];
    while (url) {
      const res: Response = await f(url, { headers: auth });
      if (!res.ok) {
        throw new PoliticasError(`Graph no listó la carpeta "${ruta}" (${res.status}).`, res.status);
      }
      const data = (await res.json()) as { value?: ItemGraph[]; '@odata.nextLink'?: string };
      for (const item of data.value ?? []) {
        if (!item.id || !item.name) continue;
        if (item.folder) {
          subcarpetas.push(item.name);
          continue;
        }
        if (!item.file) continue;
        if (archivos.length >= MAX_ARCHIVOS) {
          truncado = true;
          continue;
        }
        archivos.push({
          id: item.id,
          nombre: item.name,
          tipo: extension(item.name),
          mime: item.file.mimeType ?? null,
          tamano: item.size ?? 0,
          modificado: item.lastModifiedDateTime ?? null,
          carpeta: relativa,
        });
      }
      // Solo se siguen enlaces de Graph: nunca una URL arbitraria.
      const siguiente = data['@odata.nextLink'];
      url = siguiente && siguiente.startsWith(`${GRAPH}/`) ? siguiente : null;
    }
    for (const sub of subcarpetas) {
      if (nivel + 1 > PROFUNDIDAD_MAX) {
        truncado = true;
        continue;
      }
      await recorrer(relativa ? `${relativa}/${sub}` : sub, nivel + 1);
    }
  };

  await recorrer('', 0);

  archivos.sort(
    (a, b) => a.carpeta.localeCompare(b.carpeta, 'es') || a.nombre.localeCompare(b.nombre, 'es', { numeric: true })
  );
  const listado = { carpeta: cfg.carpeta, archivos, truncado };
  cache = { clave, cuando: ahora(), listado };
  return listado;
}

/**
 * URL de vista previa embebible (`POST driveItem/preview` → `getUrl`) de un
 * archivo de la carpeta de políticas.
 *
 * El id llega del navegador: se exige que esté en el listado de la carpeta
 * (si no está en la caché, se relista una vez). Así este endpoint no sirve
 * para previsualizar ningún otro archivo del sitio, aunque la app pueda verlo.
 * Devuelve null si el archivo no pertenece a la carpeta.
 */
export async function urlVistaPreviaPolitica(
  id: string,
  deps: { config?: ConfigPoliticas; fetch?: Fetch; ahora?: () => number } = {}
): Promise<string | null> {
  if (!esIdValido(id)) return null;
  const cfg = deps.config ?? leerConfigPoliticas();
  const f = deps.fetch ?? fetch;

  let listado = await listarPoliticas({ ...deps, config: cfg, fetch: f });
  if (!listado.archivos.some((a) => a.id === id)) {
    _reiniciarCachePoliticas();
    listado = await listarPoliticas({ ...deps, config: cfg, fetch: f });
    if (!listado.archivos.some((a) => a.id === id)) return null;
  }

  const token = await obtenerToken(cfg, f);
  const res = await f(
    `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/items/${encodeURIComponent(id)}/preview`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }
  );
  if (!res.ok) throw new PoliticasError(`Graph no entregó la vista previa (${res.status}).`, res.status);
  const data = (await res.json().catch(() => null)) as { getUrl?: string } | null;
  const url = data?.getUrl ?? '';
  // Solo se entrega una URL https de SharePoint: es lo que va a un <iframe>.
  let host = '';
  try {
    const u = new URL(url);
    host = u.protocol === 'https:' ? u.hostname : '';
  } catch {
    host = '';
  }
  if (!host.endsWith('.sharepoint.com')) throw new PoliticasError('Graph devolvió una URL de vista previa no válida.');
  return url;
}
