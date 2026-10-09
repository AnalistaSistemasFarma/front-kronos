/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — almacenamiento en SharePoint.
 *
 * Pedido de Cristian Baldión (2026-09-30): "todo tipo de archivo que yo suba
 * en la sección de Formación debe quedar en la carpeta FORMACION del sitio de
 * SharePoint de Talento Humano". Hasta ahora los materiales vivían como
 * VARBINARY en `portal_course_material.contenido` y los certificados se
 * generaban al vuelo sin guardarse en ningún lado.
 *
 * ⚠️ USO EXCLUSIVO DEL PORTAL TH. Este módulo y sus
 * variables `PORTAL_TH_SP_*` NO se reutilizan desde ningún otro módulo de
 * SynerLink (SGC, solicitudes, gestión documental, chat…): la credencial es
 * una app dedicada (SynerLink-PortalTH-Formacion) con `Sites.Selected` y rol
 * `write` SOLO sobre el sitio TalentoHumano, y el código solo sabe escribir
 * DENTRO de la carpeta base (FORMACION). Hay una prueba que falla si alguien
 * lo importa por fuera de `lib/portal/` o `app/api/portal/`
 * (`__tests__/formacion-storage-aislamiento.test.ts`).
 *
 * Desde 2026-10-08 (pedido de Cristian: botón "VISUALIZAR" de Políticas y
 * reglamentos) `politicas-storage.ts` reutiliza el token y la configuración
 * de esta app para LEER la carpeta POLITICAS Y REGLAMENTOS del mismo sitio.
 * Sigue siendo el Portal TH y el mismo sitio; aquel módulo solo lista y pide
 * vistas previas, nunca escribe.
 *
 * POR QUÉ NO SE USA EL CONECTOR `mcp-sharepoint-gss` (como el resto del
 * portal): ese conector es de SOLO LECTURA a propósito y su app de Entra ya
 * tiene más permisos de los que debería. Darle escritura ampliaría todavía más
 * una credencial sobreprivilegiada; una app nueva, acotada a UN sitio, es lo
 * más seguro.
 *
 * Estructura en SharePoint (biblioteca "Documentos compartidos" del sitio):
 *
 *   FORMACION/<slug-curso>-<id>/materiales/<archivo>
 *   FORMACION/<slug-curso>-<id>/certificados/<codigo>.pdf
 *   FORMACION/ELIMINADOS/<slug-curso>-<id>/materiales/<archivo>   (quitados)
 *
 * Nada se BORRA de SharePoint: un material quitado del curso se MUEVE a
 * ELIMINADOS (pedido de Cristian, 2026-09-30). Este módulo no tiene ninguna
 * función de borrado a propósito.
 */
import 'server-only';

/* ───────────────────────────── Configuración ───────────────────────────── */

export interface ConfigFormacionSharePoint {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  /** Carpeta base dentro de la biblioteca. Un solo segmento, validado. */
  carpetaBase: string;
}

/** Variables obligatorias. La carpeta base tiene valor por defecto. */
export const VARIABLES_OBLIGATORIAS = [
  'PORTAL_TH_SP_TENANT_ID',
  'PORTAL_TH_SP_CLIENT_ID',
  'PORTAL_TH_SP_CLIENT_SECRET',
  'PORTAL_TH_SP_SITE_ID',
] as const;

export const CARPETA_BASE_POR_DEFECTO = 'FORMACION';

/** Mensaje que ve el formador cuando falta la configuración. */
export const MENSAJE_NO_CONFIGURADO =
  'No se puede guardar el archivo: la conexión del portal con SharePoint (carpeta FORMACION de Talento Humano) ' +
  'no está configurada. Avise a Tecnología.';

/**
 * Falta (o está mal) la configuración de SharePoint. Las rutas lo traducen a
 * un 503 con `MENSAJE_NO_CONFIGURADO` — NUNCA a un guardado silencioso en la
 * base de datos.
 */
export class FormacionStorageNoConfigurado extends Error {
  constructor(readonly detalle: string) {
    super(`[portal-th/formacion-storage] ${detalle}`);
    this.name = 'FormacionStorageNoConfigurado';
  }
}

/** Graph respondió con error. */
export class FormacionStorageError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FormacionStorageError';
  }
}

/** Lee y valida la configuración. Lanza `FormacionStorageNoConfigurado`. */
export function leerConfigFormacion(env: NodeJS.ProcessEnv = process.env): ConfigFormacionSharePoint {
  const faltantes = VARIABLES_OBLIGATORIAS.filter((v) => !(env[v] ?? '').trim());
  if (faltantes.length) {
    throw new FormacionStorageNoConfigurado(`Faltan variables de entorno: ${faltantes.join(', ')}`);
  }
  const carpeta = (env.PORTAL_TH_SP_FOLDER ?? '').trim() || CARPETA_BASE_POR_DEFECTO;
  // La carpeta base es UN solo segmento: nada de "FORMACION/../OTRA" ni de
  // "/" que permitan que un cambio de variable saque la escritura de ahí.
  if (!esSegmentoValido(carpeta)) {
    throw new FormacionStorageNoConfigurado(`PORTAL_TH_SP_FOLDER no es un nombre de carpeta válido: "${carpeta}"`);
  }
  return {
    tenantId: env.PORTAL_TH_SP_TENANT_ID!.trim(),
    clientId: env.PORTAL_TH_SP_CLIENT_ID!.trim(),
    clientSecret: env.PORTAL_TH_SP_CLIENT_SECRET!.trim(),
    siteId: env.PORTAL_TH_SP_SITE_ID!.trim(),
    carpetaBase: carpeta,
  };
}

/* ─────────────────────────── Rutas seguras ─────────────────────────────── */

/** Caracteres que SharePoint/OneDrive no admiten en un nombre, más controles. */
const CARACTERES_PROHIBIDOS = /["*:<>?/\\|\u0000-\u001f\u007f]/;
const CARACTERES_PROHIBIDOS_G = /["*:<>?/\\|\u0000-\u001f\u007f]/g;
const NOMBRES_RESERVADOS = /^(\.|\.\.|con|prn|aux|nul|com\d|lpt\d|desktop\.ini|_vti_.*)$/i;
const LARGO_MAX_SEGMENTO = 120;

/** Un segmento ya limpio: sin separadores, sin `..`, sin reservados. */
export function esSegmentoValido(segmento: string): boolean {
  if (!segmento || segmento.length > LARGO_MAX_SEGMENTO) return false;
  if (segmento !== segmento.trim()) return false;
  if (CARACTERES_PROHIBIDOS.test(segmento)) return false;
  if (segmento.includes('..')) return false;
  if (segmento.endsWith('.')) return false;
  if (NOMBRES_RESERVADOS.test(segmento)) return false;
  return true;
}

/**
 * Convierte el nombre que trae el navegador en un nombre de archivo seguro:
 * se queda solo con la última parte (sin rutas), quita lo que SharePoint no
 * admite y cualquier `..`, y recorta el largo conservando la extensión.
 */
export function nombreArchivoSeguro(original: string, respaldo = 'archivo'): string {
  const base = (original ?? '').normalize('NFC').split(/[\\/]/).pop() ?? '';
  let limpio = base
    .replace(CARACTERES_PROHIBIDOS_G, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s~]+/, '')
    .replace(/[.\s]+$/, '');
  if (limpio.length > LARGO_MAX_SEGMENTO) {
    const punto = limpio.lastIndexOf('.');
    const ext = punto > 0 && limpio.length - punto <= 10 ? limpio.slice(punto) : '';
    limpio = limpio.slice(0, LARGO_MAX_SEGMENTO - ext.length).trim() + ext;
  }
  if (!limpio || NOMBRES_RESERVADOS.test(limpio) || !esSegmentoValido(limpio)) return respaldo;
  return limpio;
}

/** `<slug-del-titulo>-<id>`: la carpeta de un curso. */
export function carpetaDeCurso(titulo: string, cursoId: number): string {
  if (!Number.isInteger(cursoId) || cursoId <= 0) throw new Error('Id de curso no válido.');
  const slug = (titulo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${slug || 'curso'}-${cursoId}`;
}

export type SubcarpetaFormacion = 'materiales' | 'certificados';
const SUBCARPETAS: readonly SubcarpetaFormacion[] = ['materiales', 'certificados'];

/**
 * Arma la ruta (relativa a la raíz de la biblioteca) SIEMPRE debajo de la
 * carpeta base. Cada segmento se valida por separado; si alguno no pasa, se
 * lanza — nunca se "arregla" en silencio una ruta que podría salirse.
 */
export function rutaDentroDeFormacion(
  carpetaBase: string,
  carpetaCurso: string,
  subcarpeta: SubcarpetaFormacion,
  nombreArchivo: string
): string {
  if (!SUBCARPETAS.includes(subcarpeta)) throw new Error(`Subcarpeta no permitida: ${subcarpeta}`);
  const segmentos = [carpetaBase, carpetaCurso, subcarpeta, nombreArchivo];
  for (const s of segmentos) {
    if (!esSegmentoValido(s)) throw new Error(`Segmento de ruta no válido: "${s}"`);
  }
  return segmentos.join('/');
}

/** Carpeta (dentro de la base) a donde van los materiales quitados. */
export const CARPETA_ELIMINADOS = 'ELIMINADOS';

/**
 * Segmentos de `FORMACION/ELIMINADOS/<curso>/materiales`, validados uno a
 * uno. Solo materiales: los certificados emitidos nunca se mueven.
 */
export function segmentosCarpetaEliminados(carpetaBase: string, carpetaCurso: string): string[] {
  const segmentos = [carpetaBase, CARPETA_ELIMINADOS, carpetaCurso, 'materiales'];
  for (const s of segmentos) {
    if (!esSegmentoValido(s)) throw new Error(`Segmento de ruta no válido: "${s}"`);
  }
  return segmentos;
}

/** La ruta codificada para `/drive/root:/<ruta>:`. */
function codificarRuta(ruta: string): string {
  return ruta.split('/').map(encodeURIComponent).join('/');
}

/* ─────────────────────────── Cliente Graph ─────────────────────────────── */

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Por encima de esto, Graph exige upload session (el PUT simple tope 4 MB). */
export const LIMITE_SUBIDA_SIMPLE = 4 * 1024 * 1024;
/** Trozo de la upload session: múltiplo de 320 KiB, como exige Graph. */
export const TAMANO_TROZO = 320 * 1024 * 16; // 5 MiB

type Fetch = typeof fetch;

export interface ArchivoEnSharePoint {
  driveItemId: string;
  webUrl: string | null;
  nombre: string;
  tamano: number;
  mime: string;
}

interface TokenCache {
  clave: string;
  token: string;
  vence: number;
}
let tokenCache: TokenCache | null = null;

/** Solo para pruebas. */
export function _reiniciarCacheToken() {
  tokenCache = null;
}

/**
 * Token app-only de Graph (client credentials) con caché en memoria.
 * Exportado SOLO para `politicas-storage.ts` (lectura de POLITICAS Y
 * REGLAMENTOS del mismo sitio, también parte del Portal TH). El token nunca
 * sale del servidor.
 */
export async function obtenerToken(
  cfg: Pick<ConfigFormacionSharePoint, 'tenantId' | 'clientId' | 'clientSecret'>,
  f: Fetch
): Promise<string> {
  const clave = `${cfg.tenantId}|${cfg.clientId}`;
  if (tokenCache && tokenCache.clave === clave && tokenCache.vence > Date.now() + 60_000) return tokenCache.token;

  const res = await f(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !data?.access_token) {
    throw new FormacionStorageError(`No se pudo obtener token de Graph (${res.status}).`, res.status);
  }
  tokenCache = { clave, token: data.access_token, vence: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

interface DriveItemGraph {
  id?: string;
  name?: string;
  size?: number;
  webUrl?: string;
  file?: { mimeType?: string };
}

function aReferencia(item: DriveItemGraph, mime: string, tamano: number): ArchivoEnSharePoint {
  if (!item?.id) throw new FormacionStorageError('Graph no devolvió el id del archivo subido.');
  return {
    driveItemId: item.id,
    webUrl: item.webUrl ?? null,
    nombre: item.name ?? '',
    tamano: item.size ?? tamano,
    mime: item.file?.mimeType || mime,
  };
}

export interface SubirParams {
  carpetaCurso: string;
  subcarpeta: SubcarpetaFormacion;
  nombreArchivo: string;
  contenido: Uint8Array;
  mime: string;
}

/**
 * Sube un archivo a `FORMACION/<curso>/<subcarpeta>/<nombre>`.
 * - ≤ 4 MB: PUT simple a `:/content`.
 * - > 4 MB: `createUploadSession` y trozos de 5 MiB.
 * En ambos casos `conflictBehavior=rename`: si ya existe uno con ese nombre,
 * SharePoint le agrega " 1", " 2"… en vez de pisarlo.
 */
export async function subirArchivoFormacion(
  params: SubirParams,
  deps: { config?: ConfigFormacionSharePoint; fetch?: Fetch } = {}
): Promise<ArchivoEnSharePoint> {
  const cfg = deps.config ?? leerConfigFormacion();
  const f = deps.fetch ?? fetch;
  const nombre = nombreArchivoSeguro(params.nombreArchivo);
  const ruta = rutaDentroDeFormacion(cfg.carpetaBase, params.carpetaCurso, params.subcarpeta, nombre);
  const token = await obtenerToken(cfg, f);
  const base = `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/root:/${codificarRuta(ruta)}:`;
  const total = params.contenido.byteLength;

  if (total <= LIMITE_SUBIDA_SIMPLE) {
    const res = await f(`${base}/content?@microsoft.graph.conflictBehavior=rename`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': params.mime || 'application/octet-stream' },
      body: params.contenido as BodyInit,
    });
    if (!res.ok) throw new FormacionStorageError(`Graph rechazó la subida (${res.status}).`, res.status);
    return aReferencia((await res.json()) as DriveItemGraph, params.mime, total);
  }

  const sesion = await f(`${base}/createUploadSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
  });
  const datosSesion = (await sesion.json().catch(() => null)) as { uploadUrl?: string } | null;
  if (!sesion.ok || !datosSesion?.uploadUrl) {
    throw new FormacionStorageError(`No se pudo abrir la sesión de subida (${sesion.status}).`, sesion.status);
  }
  const uploadUrl = datosSesion.uploadUrl;

  try {
    for (let inicio = 0; inicio < total; inicio += TAMANO_TROZO) {
      const fin = Math.min(inicio + TAMANO_TROZO, total);
      // La uploadUrl ya viene preautorizada: NO se manda el Bearer (Graph lo
      // rechaza si se incluye).
      const res = await f(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(fin - inicio),
          'Content-Range': `bytes ${inicio}-${fin - 1}/${total}`,
        },
        body: params.contenido.subarray(inicio, fin) as BodyInit,
      });
      if (res.status === 200 || res.status === 201) {
        return aReferencia((await res.json()) as DriveItemGraph, params.mime, total);
      }
      if (res.status !== 202) throw new FormacionStorageError(`Falló un trozo de la subida (${res.status}).`, res.status);
    }
  } catch (error) {
    // Cierra la sesión para no dejar un archivo a medias ocupando la cuota.
    await f(uploadUrl, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
  throw new FormacionStorageError('La subida terminó sin que Graph confirmara el archivo.');
}

/* ───────────── Subida DIRECTA del navegador (sin tope de tamaño) ─────────────
 * Pedido de Cristian Baldión (2026-10-08): "quita ese límite de peso en los
 * archivos, recuerda que todo queda en el sitio de Talento Humano".
 *
 * Para que un video de cientos de MB no pase por Next ni por IIS/ARR (que en
 * producción corta en ~30 MB y tiene timeouts), el servidor solo ABRE una
 * upload session de Graph en la ruta correcta y le entrega al navegador la
 * `uploadUrl`. Esa URL ya viene preautorizada por Graph, es temporal y sirve
 * SOLO para ese archivo: el token de la app nunca sale del servidor. El
 * navegador sube por trozos (`lib/portal/subida-por-trozos.ts`) y, al
 * terminar, el servidor comprueba el archivo resultante con
 * `obtenerArchivoSubidoEnCarpeta` antes de registrarlo.
 */

export interface SesionSubida {
  /** URL preautorizada de Graph para subir los trozos. Sin Bearer. */
  uploadUrl: string;
  /** Hasta cuándo vale la sesión (ISO), si Graph lo informa. */
  expiracion: string | null;
  /** Nombre (ya saneado) con el que se pidió el archivo. */
  nombre: string;
}

/**
 * Abre una upload session en `FORMACION/<curso>/<subcarpeta>/<nombre>` con
 * `conflictBehavior=rename` (si ya existe uno con ese nombre, SharePoint le
 * agrega " 1", " 2"… en vez de pisarlo). Devuelve SOLO lo que el navegador
 * necesita.
 */
export async function crearSesionSubida(
  params: { carpetaCurso: string; subcarpeta: SubcarpetaFormacion; nombreArchivo: string },
  deps: { config?: ConfigFormacionSharePoint; fetch?: Fetch } = {}
): Promise<SesionSubida> {
  const cfg = deps.config ?? leerConfigFormacion();
  const f = deps.fetch ?? fetch;
  const nombre = nombreArchivoSeguro(params.nombreArchivo);
  const ruta = rutaDentroDeFormacion(cfg.carpetaBase, params.carpetaCurso, params.subcarpeta, nombre);
  const token = await obtenerToken(cfg, f);
  const res = await f(
    `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/root:/${codificarRuta(ruta)}:/createUploadSession`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
    }
  );
  const datos = (await res.json().catch(() => null)) as { uploadUrl?: string; expirationDateTime?: string } | null;
  if (!res.ok || !datos?.uploadUrl) {
    throw new FormacionStorageError(`No se pudo abrir la sesión de subida (${res.status}).`, res.status);
  }
  // Defensa: la URL que se le entrega al navegador tiene que ser https.
  if (!/^https:\/\//i.test(datos.uploadUrl)) {
    throw new FormacionStorageError('Graph devolvió una URL de subida no válida.');
  }
  return { uploadUrl: datos.uploadUrl, expiracion: datos.expirationDateTime ?? null, nombre };
}

/** El driveItem que se quiere registrar no está en la carpeta del curso. */
export class ArchivoFueraDeCarpeta extends FormacionStorageError {
  constructor() {
    super('El archivo no está en la carpeta del curso.', 403);
    this.name = 'ArchivoFueraDeCarpeta';
  }
}

interface DriveItemConPadre extends DriveItemGraph {
  parentReference?: { path?: string };
}

/** `/drives/x/root:/FORMACION/a%20b/materiales` → `FORMACION/a b/materiales`. */
function rutaDelPadre(path: string | undefined): string | null {
  const m = /root:(.*)$/.exec(path ?? '');
  if (!m) return null;
  let ruta = m[1];
  try {
    ruta = decodeURIComponent(ruta);
  } catch {
    // Graph ya la entregó decodificada.
  }
  return ruta.replace(/^\/+|\/+$/g, '');
}

/**
 * Lee el archivo que el navegador acaba de subir y COMPRUEBA que esté justo
 * en `FORMACION/<curso>/<subcarpeta>` y sea un archivo (no una carpeta). Así
 * nadie puede registrar como material un driveItemId de otra carpeta del
 * sitio. Lanza `FormacionStorageError` si no cumple.
 */
export async function obtenerArchivoSubidoEnCarpeta(
  params: { driveItemId: string; carpetaCurso: string; subcarpeta: SubcarpetaFormacion; mime: string },
  deps: { config?: ConfigFormacionSharePoint; fetch?: Fetch } = {}
): Promise<ArchivoEnSharePoint> {
  if (!/^[A-Za-z0-9!._-]{1,200}$/.test(params.driveItemId)) throw new FormacionStorageError('Id de archivo no válido.');
  const cfg = deps.config ?? leerConfigFormacion();
  const f = deps.fetch ?? fetch;
  const esperada = [cfg.carpetaBase, params.carpetaCurso, params.subcarpeta];
  for (const s of esperada) {
    if (!esSegmentoValido(s)) throw new Error(`Segmento de ruta no válido: "${s}"`);
  }
  const token = await obtenerToken(cfg, f);
  const res = await f(
    `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/items/${encodeURIComponent(params.driveItemId)}` +
      '?$select=id,name,size,webUrl,file,parentReference',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new FormacionStorageError(`Graph no encontró el archivo subido (${res.status}).`, res.status);
  const item = (await res.json()) as DriveItemConPadre;
  if (!item.file) throw new FormacionStorageError('El elemento subido no es un archivo.');
  const padre = rutaDelPadre(item.parentReference?.path);
  if (!padre || padre.toLowerCase() !== esperada.join('/').toLowerCase()) {
    throw new ArchivoFueraDeCarpeta();
  }
  if (!item.size || item.size <= 0) throw new FormacionStorageError('El archivo subido está vacío.');
  return aReferencia(item, params.mime, item.size);
}

/**
 * Descarga un archivo por su driveItemId para servirlo por el portal (proxy):
 * el navegador nunca ve una URL de SharePoint.
 */
export async function descargarArchivoFormacion(
  driveItemId: string,
  deps: { config?: ConfigFormacionSharePoint; fetch?: Fetch } = {}
): Promise<{ cuerpo: ReadableStream<Uint8Array> | null; tamano: number | null; mime: string | null }> {
  if (!/^[A-Za-z0-9!._-]{1,200}$/.test(driveItemId)) throw new FormacionStorageError('Id de archivo no válido.');
  const cfg = deps.config ?? leerConfigFormacion();
  const f = deps.fetch ?? fetch;
  const token = await obtenerToken(cfg, f);
  const res = await f(
    `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/items/${encodeURIComponent(driveItemId)}/content`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' }
  );
  if (!res.ok) throw new FormacionStorageError(`Graph no entregó el archivo (${res.status}).`, res.status);
  const largo = Number(res.headers.get('content-length'));
  return {
    cuerpo: res.body,
    tamano: Number.isFinite(largo) && largo > 0 ? largo : null,
    mime: res.headers.get('content-type'),
  };
}

/**
 * Garantiza que exista la carpeta `segmentos.join('/')` (creando los niveles
 * que falten) y devuelve su driveItemId.
 */
async function asegurarCarpeta(cfg: ConfigFormacionSharePoint, token: string, f: Fetch, segmentos: string[]): Promise<string> {
  const drive = `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive`;
  const auth = { Authorization: `Bearer ${token}` };
  let idPadre: string | null = null;
  for (let i = 0; i < segmentos.length; i++) {
    const ruta = segmentos.slice(0, i + 1).join('/');
    const existente = await f(`${drive}/root:/${codificarRuta(ruta)}`, { headers: auth });
    if (existente.ok) {
      idPadre = ((await existente.json()) as DriveItemGraph).id ?? null;
      if (!idPadre) throw new FormacionStorageError(`Graph no devolvió el id de la carpeta ${ruta}.`);
      continue;
    }
    if (existente.status !== 404) {
      throw new FormacionStorageError(`No se pudo consultar la carpeta ${ruta} (${existente.status}).`, existente.status);
    }
    const hijos: string = idPadre ? `${drive}/items/${encodeURIComponent(idPadre)}/children` : `${drive}/root/children`;
    const creada: Response = await f(hijos, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: segmentos[i], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
    if (creada.ok) {
      idPadre = ((await creada.json()) as DriveItemGraph).id ?? null;
    } else if (creada.status === 409) {
      // Otra petición la creó al mismo tiempo: se relee.
      const releida = await f(`${drive}/root:/${codificarRuta(ruta)}`, { headers: auth });
      idPadre = releida.ok ? (((await releida.json()) as DriveItemGraph).id ?? null) : null;
    } else {
      throw new FormacionStorageError(`No se pudo crear la carpeta ${ruta} (${creada.status}).`, creada.status);
    }
    if (!idPadre) throw new FormacionStorageError(`No se pudo obtener la carpeta ${ruta}.`);
  }
  return idPadre!;
}

/**
 * Mueve un material quitado del curso a
 * `FORMACION/ELIMINADOS/<curso>/materiales/<archivo>` (PATCH del driveItem
 * con `parentReference` + `name`, `conflictBehavior=rename`). Crea la carpeta
 * si no existe. Lanza si algo falla: quien llama NO debe marcar el material
 * como quitado si el archivo no se movió.
 */
export async function moverMaterialAEliminados(
  params: { driveItemId: string; carpetaCurso: string; nombreArchivo: string },
  deps: { config?: ConfigFormacionSharePoint; fetch?: Fetch } = {}
): Promise<ArchivoEnSharePoint> {
  if (!/^[A-Za-z0-9!._-]{1,200}$/.test(params.driveItemId)) throw new FormacionStorageError('Id de archivo no válido.');
  const cfg = deps.config ?? leerConfigFormacion();
  const f = deps.fetch ?? fetch;
  const segmentos = segmentosCarpetaEliminados(cfg.carpetaBase, params.carpetaCurso);
  const nombre = nombreArchivoSeguro(params.nombreArchivo);
  const token = await obtenerToken(cfg, f);
  const idCarpeta = await asegurarCarpeta(cfg, token, f, segmentos);

  const res = await f(
    `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/items/${encodeURIComponent(params.driveItemId)}` +
      '?@microsoft.graph.conflictBehavior=rename',
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentReference: { id: idCarpeta }, name: nombre }),
    }
  );
  if (!res.ok) throw new FormacionStorageError(`Graph no movió el archivo a ELIMINADOS (${res.status}).`, res.status);
  const item = (await res.json()) as DriveItemGraph;
  return aReferencia({ ...item, id: item.id ?? params.driveItemId }, item.file?.mimeType ?? '', item.size ?? 0);
}
