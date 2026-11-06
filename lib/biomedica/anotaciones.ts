import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { toWinAnsiSafe } from '../sgc/watermark';

/**
 * Lo que el ingeniero escribe ENCIMA del formato vigente (2026-11-06): «como si
 * lo imprimiéramos y lo llenáramos a mano». El formato del SGC nunca cambia:
 * el PDF diligenciado es el PDF vigente con estas anotaciones dibujadas encima.
 *
 *   - texto: con una FUENTE FIJA (Helvetica 9; se permite negrilla, no cambiar
 *     el tipo ni el tamaño de letra). Si no cabe en la casilla, se ve desbordado.
 *   - marca: una «X» de un clic (sí/no, cumple/no cumple…).
 *
 * Posición en porcentaje de la página (x, y desde arriba a la izquierda).
 */
export const BIOMED_FONT_SIZE = 9;
export const BIOMED_MARK_SIZE = 11;
export const MAX_ANOTACIONES = 400;
export const MAX_TEXTO = 300;

export type BiomedAnotacion =
  | { id: string; tipo: 'texto'; page: number; x: number; y: number; texto: string; negrilla: boolean }
  | { id: string; tipo: 'marca'; page: number; x: number; y: number };

export class AnotacionInvalida extends Error {}

const ID = /^[A-Za-z0-9_-]{1,40}$/;

function pct(v: unknown, campo: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new AnotacionInvalida(`La posición (${campo}) debe estar dentro de la página.`);
  return Math.round(n * 100) / 100;
}

/** Valida y normaliza lo que llega del navegador. */
export function normalizarAnotaciones(raw: unknown, pages: number | null = null): BiomedAnotacion[] {
  if (!Array.isArray(raw)) throw new AnotacionInvalida('Las anotaciones no son válidas.');
  if (raw.length > MAX_ANOTACIONES) throw new AnotacionInvalida(`Máximo ${MAX_ANOTACIONES} anotaciones por formato.`);
  const vistas = new Set<string>();
  return raw.map((r) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    if (!id || vistas.has(id)) throw new AnotacionInvalida('Cada anotación necesita un identificador único.');
    vistas.add(id);
    const page = Number(o.page);
    if (!Number.isInteger(page) || page < 1 || (pages !== null && page > pages)) throw new AnotacionInvalida('La página de la anotación no existe.');
    const base = { id, page, x: pct(o.x, 'x'), y: pct(o.y, 'y') };
    if (o.tipo === 'marca') return { ...base, tipo: 'marca' as const };
    if (o.tipo !== 'texto') throw new AnotacionInvalida('Tipo de anotación no permitido (texto o marca).');
    const texto = typeof o.texto === 'string' ? o.texto.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, MAX_TEXTO) : '';
    return { ...base, tipo: 'texto' as const, texto, negrilla: o.negrilla === true };
  });
}

/** Lee las anotaciones guardadas (una fila vieja o dañada se lee vacía). */
export function leerAnotaciones(json: string | null | undefined): BiomedAnotacion[] {
  try {
    return normalizarAnotaciones(JSON.parse(json ?? '[]'));
  } catch {
    return [];
  }
}

/** Dibuja las anotaciones sobre el PDF (no cambia nada más del PDF). */
export async function dibujarAnotaciones(pdfBytes: Uint8Array, anotaciones: readonly BiomedAnotacion[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const tinta = rgb(0.05, 0.15, 0.45);
  for (const a of anotaciones) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const { width, height } = page.getSize();
    const x = (a.x / 100) * width;
    const top = (a.y / 100) * height;
    if (a.tipo === 'marca') {
      page.drawText('X', { x, y: height - top - BIOMED_MARK_SIZE * 0.8, size: BIOMED_MARK_SIZE, font: bold, color: tinta });
      continue;
    }
    const font = a.negrilla ? bold : regular;
    // toWinAnsiSafe cambia los saltos de línea por espacios: primero se parte en líneas.
    a.texto
      .split('\n')
      .forEach((linea, i) => {
        page.drawText(toWinAnsiSafe(linea), { x, y: height - top - BIOMED_FONT_SIZE * (i + 1) * 1.15, size: BIOMED_FONT_SIZE, font, color: tinta });
      });
  }
  return pdf.save();
}
