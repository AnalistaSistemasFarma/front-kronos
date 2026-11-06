/**
 * Vitrina Comercial — imágenes de empaque y documentos del SGC (sprint V3). Archivo PURO.
 *
 * Imágenes: van al almacenamiento de adjuntos que ya usa SynerLink (OneDrive por
 * Microsoft Graph, lib/onedrive/graphFolderUpload.ts), en una carpeta propia bajo la
 * raíz de adjuntos del entorno (SAPSEND en producción, la de pruebas en testing):
 *
 *   <raíz>/VITRINA/empresa-<id>/presentacion-<id>/<TIPO>-v<n>-<token>.<ext>
 *
 * vitrina_imagen.ruta_archivo guarda el id del archivo en OneDrive. Una imagen nueva
 * del mismo tipo deja la anterior como no vigente (queda en el historial).
 *
 * Modelo 3D (2026-11-04): un GLB (glTF 2.0 binario) por presentación, en la MISMA carpeta y
 * con el mismo almacenamiento que las imágenes («MODELO3D-v<n>-<token>.glb»). Se valida por
 * la cabecera del archivo; uno nuevo deja el anterior como no vigente (historial).
 *
 * Documentos: se ENLAZAN documentos vigentes del SGC (sgc.document), no se copian.
 * Se muestran con el visor seguro del SGC, sin descarga ni impresión.
 */
import {
  VITRINA_DOCUMENTO_TIPOS,
  VITRINA_IMAGEN_MAX_BYTES,
  VITRINA_MODELO3D_DIMENSION_MAX_CM,
  VITRINA_MODELO3D_MAX_BYTES,
  VITRINA_IMAGEN_TIPOS,
  type VitrinaDocumentoTipo,
  type VitrinaImagenTipo,
} from './constants';
import { companyVitrinaAccess, VitrinaError, type VitrinaCompanyAccess } from './rules';

export const VITRINA_CARPETA_ADJUNTOS = 'VITRINA';

export function esTipoImagen(v: unknown): v is VitrinaImagenTipo {
  return typeof v === 'string' && (VITRINA_IMAGEN_TIPOS as readonly string[]).includes(v);
}

export function esTipoDocumento(v: unknown): v is VitrinaDocumentoTipo {
  return typeof v === 'string' && (VITRINA_DOCUMENTO_TIPOS as readonly string[]).includes(v);
}

export interface FormatoImagen {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
}

/** Formato por la FIRMA del archivo (no por la extensión ni el MIME que manda el navegador). */
export function formatoImagen(bytes: Uint8Array): FormatoImagen | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Valida la imagen subida; devuelve su formato o lanza 400. */
export function validarImagen(bytes: Uint8Array): FormatoImagen {
  if (!bytes || bytes.length === 0) throw new VitrinaError('Adjunte la imagen.', 400);
  if (bytes.length > VITRINA_IMAGEN_MAX_BYTES) throw new VitrinaError(`La imagen supera ${Math.round(VITRINA_IMAGEN_MAX_BYTES / (1024 * 1024))} MB.`, 400);
  const f = formatoImagen(bytes);
  if (!f) throw new VitrinaError('La imagen debe ser PNG, JPG o WEBP.', 400);
  return f;
}

/** Carpeta de las imágenes de una presentación, bajo la raíz de adjuntos del entorno. */
export function carpetaImagenes(raiz: string, idCompany: number, idPresentacion: number): string[] {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(raiz)) throw new Error('Raíz de adjuntos no válida.');
  if (!Number.isInteger(idCompany) || idCompany <= 0 || !Number.isInteger(idPresentacion) || idPresentacion <= 0) throw new Error('Identificadores no válidos.');
  return [raiz, VITRINA_CARPETA_ADJUNTOS, `empresa-${idCompany}`, `presentacion-${idPresentacion}`];
}

/** «VIAL-v3-a1b2c3d4.png»: el token evita que una carga pise otra con el mismo nombre. */
export function nombreArchivoImagen(tipo: VitrinaImagenTipo, version: number, token: string, ext: FormatoImagen['ext']): string {
  const t = token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'img';
  return `${tipo}-v${version}-${t}.${ext}`;
}

/** Siguiente versión de un tipo: la mayor versión numérica cargada + 1. */
export function siguienteVersion(versiones: readonly (string | null)[]): number {
  const n = versiones.map((v) => Number.parseInt(v ?? '', 10)).filter((x) => Number.isInteger(x) && x > 0);
  return (n.length ? Math.max(...n) : 0) + 1;
}

/** Idioma del vínculo («es», «en», «pt»…); null si viene vacío. */
export function idiomaDocumento(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(s) && !/^[a-z]{2}-[a-z]{2}$/.test(s)) throw new VitrinaError('Idioma no válido: use el código de dos letras (es, en, pt).', 400);
  return s;
}

/** Un documento del SGC se puede mostrar en la Vitrina: vigente, con versión vigente y no confidencial. */
export function documentoSgcMostrable(d: { status: string; current_version_id: number | null; confidentiality: string } | null | undefined): boolean {
  return !!d && d.status === 'vigente' && d.current_version_id !== null && d.confidentiality !== 'confidencial';
}

/** URL del visor seguro del SGC (consulta, sin descarga) para la versión vigente. */
export function urlVisorSgc(idDocument: number, idVersion: number): string {
  return `/api/sgc/documents/${idDocument}/versions/${idVersion}/file`;
}

/** URL de la imagen (pasa por el servidor, que verifica el permiso; OneDrive nunca llega al navegador). */
export function urlImagen(idImagen: number): string {
  return `/api/vitrina/imagenes/${idImagen}`;
}

// ---------------------------------------------------------------------------
// Modelo 3D (GLB)
// ---------------------------------------------------------------------------

/** «glTF» en ASCII: magic de la cabecera GLB (uint32 little-endian 0x46546C67). */
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46] as const;
/** Tipo del primer chunk de un GLB: «JSON» (0x4E4F534A). */
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CABECERA_BYTES = 12;

export interface CabeceraGlb {
  version: number;
  /** Longitud total que declara la cabecera (debe ser la del archivo). */
  longitud: number;
}

const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Cabecera GLB (magic «glTF», versión y longitud), o null si el archivo no es un GLB. */
export function cabeceraGlb(bytes: Uint8Array): CabeceraGlb | null {
  if (!bytes || bytes.length < GLB_CABECERA_BYTES) return null;
  for (let i = 0; i < GLB_MAGIC.length; i += 1) if (bytes[i] !== GLB_MAGIC[i]) return null;
  return { version: u32(bytes, 4), longitud: u32(bytes, 8) };
}

/**
 * Valida el modelo subido POR CONTENIDO (no por la extensión ni el MIME del navegador):
 * cabecera «glTF», versión 2, longitud declarada igual a la del archivo (no truncado) y
 * primer chunk JSON. Lanza 400 con un mensaje para Diseño.
 */
export function validarModelo3d(bytes: Uint8Array): CabeceraGlb {
  if (!bytes || bytes.length === 0) throw new VitrinaError('Adjunte el modelo 3D (.glb).', 400);
  if (bytes.length > VITRINA_MODELO3D_MAX_BYTES) throw new VitrinaError(`El modelo 3D supera ${Math.round(VITRINA_MODELO3D_MAX_BYTES / (1024 * 1024))} MB.`, 400);
  const c = cabeceraGlb(bytes);
  if (!c) throw new VitrinaError('El archivo no es un modelo GLB (glTF binario). Expórtelo como .glb desde Adobe Dimension o Blender.', 400);
  if (c.version !== 2) throw new VitrinaError(`El GLB es glTF versión ${c.version}: se requiere glTF 2.0.`, 400);
  if (c.longitud !== bytes.length) throw new VitrinaError('El GLB está incompleto o dañado (su tamaño no coincide con la cabecera).', 400);
  if (bytes.length < GLB_CABECERA_BYTES + 8 || u32(bytes, GLB_CABECERA_BYTES + 4) !== GLB_CHUNK_JSON) throw new VitrinaError('El GLB no tiene la sección JSON de glTF 2.0.', 400);
  return c;
}

/** «MODELO3D-v2-a1b2c3d4.glb»: el token evita que una carga pise otra. */
export function nombreArchivoModelo3d(version: number, token: string): string {
  const t = token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'glb';
  return `MODELO3D-v${version}-${t}.glb`;
}

/** Nombre con el que Diseño subió el archivo (solo para mostrarlo): sin rutas ni controles, máx. 255. */
export function nombreOriginalModelo3d(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  const base = s.split(/[\\/]/).pop() ?? '';
  const limpio = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return limpio || 'modelo.glb';
}

/**
 * Dimensión opcional del empaque en cm (ancho, alto o profundo): vacío = null; acepta coma
 * decimal; mayor que 0 y hasta 1000 cm (igual a la CHECK); se redondea a 2 decimales.
 */
export function dimensionCm(v: unknown, etiqueta: string): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > VITRINA_MODELO3D_DIMENSION_MAX_CM) {
    throw new VitrinaError(`${etiqueta}: escriba un número en cm mayor que 0 y hasta ${VITRINA_MODELO3D_DIMENSION_MAX_CM}.`, 400);
  }
  return Math.round(n * 100) / 100;
}

export interface DimensionesCm {
  ancho: number | null;
  alto: number | null;
  profundo: number | null;
}

/** Las tres dimensiones opcionales desde un formulario o cuerpo JSON. */
export function dimensionesCm(body: { ancho_cm?: unknown; alto_cm?: unknown; profundo_cm?: unknown }): DimensionesCm {
  return { ancho: dimensionCm(body.ancho_cm, 'Ancho'), alto: dimensionCm(body.alto_cm, 'Alto'), profundo: dimensionCm(body.profundo_cm, 'Profundo') };
}

/** URL del modelo (pasa por el servidor, que verifica el permiso; OneDrive nunca llega al navegador). */
export function urlModelo3d(idModelo: number): string {
  return `/api/vitrina/modelos-3d/${idModelo}`;
}

/** Tamaño legible: «418 KB», «12,4 MB». */
export function tamanoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/**
 * ¿Puede el usuario ver este modelo? Mismo control que las imágenes: permiso de la Vitrina en la
 * empresa DUEÑA de la presentación (nunca la del parámetro). El vigente lo ve quien consulta
 * (comerciales, también en el modo presentación); uno reemplazado o retirado, solo Gestión.
 */
export function puedeVerModelo3d(access: readonly VitrinaCompanyAccess[], modelo: { idCompany: number; vigente: boolean } | null): boolean {
  if (!modelo) return false;
  return companyVitrinaAccess(access, modelo.idCompany, modelo.vigente ? 'canConsultar' : 'canGestionar') !== null;
}
