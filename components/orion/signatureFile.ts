'use client';

/**
 * Firma subida como archivo: cualquier imagen que el navegador sepa abrir (PNG, JPG, WEBP,
 * GIF, BMP, SVG, foto del celular…) o la primera página de un PDF. Devuelve un canvas
 * recortado a la tinta, listo para pintarse en el SignaturePad.
 */

const MAX_SOURCE_PX = 1600;
const INK_LUMINANCE = 170;
const INK_MIN_ALPHA = 40;
const INK_PAD_PX = 6;

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

async function pdfFirstPageCanvas(file: File): Promise<HTMLCanvasElement> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, MAX_SOURCE_PX / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function imageCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 600;
    const h0 = img.naturalHeight || 300;
    const scale = Math.min(1, MAX_SOURCE_PX / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    // Fondo blanco: un PNG transparente se lee igual que uno con fondo.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function inkBounds(canvas: HTMLCanvasElement): { x: number; y: number; width: number; height: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < INK_MIN_ALPHA) continue;
      if (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! > INK_LUMINANCE) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const x0 = Math.max(0, minX - INK_PAD_PX);
  const y0 = Math.max(0, minY - INK_PAD_PX);
  return {
    x: x0,
    y: y0,
    width: Math.min(width, maxX + INK_PAD_PX + 1) - x0,
    height: Math.min(height, maxY + INK_PAD_PX + 1) - y0,
  };
}

export class SignatureFileError extends Error {}

/** Canvas con la firma del archivo recortada a la tinta. Lanza SignatureFileError con un mensaje para el usuario. */
export async function signatureFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  let source: HTMLCanvasElement;
  try {
    source = isPdf(file) ? await pdfFirstPageCanvas(file) : await imageCanvas(file);
  } catch {
    throw new SignatureFileError(
      'No se pudo abrir el archivo. Use una imagen (PNG, JPG, WEBP, GIF, BMP, SVG), una foto o un PDF.'
    );
  }
  const box = inkBounds(source);
  if (!box) {
    throw new SignatureFileError(
      'No se encontró el trazo de la firma. Use una imagen clara de la firma sobre fondo blanco.'
    );
  }
  const out = document.createElement('canvas');
  out.width = box.width;
  out.height = box.height;
  out.getContext('2d')?.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return out;
}
