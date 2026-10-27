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
 * Documentos: se ENLAZAN documentos vigentes del SGC (sgc.document), no se copian.
 * Se muestran con el visor seguro del SGC, sin descarga ni impresión.
 */
import {
  VITRINA_DOCUMENTO_TIPOS,
  VITRINA_IMAGEN_MAX_BYTES,
  VITRINA_IMAGEN_TIPOS,
  type VitrinaDocumentoTipo,
  type VitrinaImagenTipo,
} from './constants';
import { VitrinaError } from './rules';

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
