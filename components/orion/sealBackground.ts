'use client';

import { sealPixelAlpha } from '@/lib/orion/sealAlpha';

/** Lado más largo con el que se guarda el sello: de sobra para imprimirlo nítido en el PDF. */
const SEAL_MAX_SIDE = 1400;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen del sello'));
    };
    img.src = url;
  });
}

/**
 * Quita el fondo blanco del sello (y lo achica si es enorme) antes de subirlo, para que sobre
 * el documento solo quede la tinta. Devuelve un PNG con transparencia. Si el navegador no
 * puede procesarla, se sube la imagen tal cual.
 */
export async function removeSealBackground(file: File): Promise<File> {
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, SEAL_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i + 3] = sealPixelAlpha(px[i], px[i + 1], px[i + 2], px[i + 3]);
    }
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return file;
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'sello'}.png`;
    return new File([blob], name, { type: 'image/png' });
  } catch {
    return file;
  }
}
