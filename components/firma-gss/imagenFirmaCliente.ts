'use client';

import { clearLightBackground, fitScale, inkBoundsRgba } from '../../lib/sgc/signature/ownSignature';
import { FIRMA_ARCHIVO_MAX_BYTES, tipoPorBytes } from '../../lib/firma-gss/sniff';

/**
 * Preparación EN EL NAVEGADOR de la imagen de una firma manuscrita subida
 * (foto o escaneo): tamaño máximo, tipo REAL por sus bytes (PNG o JPG), y
 * RECODIFICACIÓN con un canvas recortada a la tinta y con el fondo claro
 * transparente. Recodificar quita el EXIF (ubicación, cámara, fecha) y
 * cualquier metadato del archivo original. El servidor vuelve a validar y
 * recodificar (lib/firma-gss/png.ts): esto es comodidad, no la barrera.
 *
 * Las funciones de recorte son las puras del SGC (solo se importan; el SGC no
 * cambia).
 */

export class FirmaArchivoError extends Error {}

/** Valida el archivo elegido (tamaño y tipo por bytes) antes de abrirlo. */
export async function validarArchivoFirma(file: File): Promise<'png' | 'jpeg'> {
  if (file.size === 0) throw new FirmaArchivoError('El archivo está vacío.');
  if (file.size > FIRMA_ARCHIVO_MAX_BYTES) {
    throw new FirmaArchivoError(`La imagen pesa más de ${Math.round(FIRMA_ARCHIVO_MAX_BYTES / (1024 * 1024))} MB. Use una foto más liviana.`);
  }
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const tipo = tipoPorBytes(head);
  if (!tipo) throw new FirmaArchivoError('El archivo no es una imagen PNG ni JPG.');
  return tipo;
}

/** Carga una imagen en un canvas, la recorta a la tinta y devuelve un PNG nuevo (null si no tiene trazo). */
export async function recortarATinta(src: string, maxAncho = 600): Promise<string | null> {
  const img = new window.Image();
  img.src = src;
  await img.decode();
  const scale = fitScale(img.naturalWidth, img.naturalHeight, 1600);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const ctx = full.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  const box = inkBoundsRgba(pixels.data, w, h);
  if (!box) return null;
  clearLightBackground(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  const s = fitScale(box.width, box.height, maxAncho);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * s));
  out.height = Math.max(1, Math.round(box.height * s));
  out.getContext('2d')?.drawImage(full, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Archivo elegido → PNG recodificado y recortado, listo para enviar. */
export async function prepararImagenFirma(file: File): Promise<string> {
  await validarArchivoFirma(file);
  const url = URL.createObjectURL(file);
  try {
    let png: string | null;
    try {
      png = await recortarATinta(url);
    } catch {
      throw new FirmaArchivoError('No se pudo leer la imagen. Use un PNG o JPG.');
    }
    if (!png) throw new FirmaArchivoError('La imagen no tiene trazo: suba una foto clara de su firma sobre fondo blanco.');
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}
