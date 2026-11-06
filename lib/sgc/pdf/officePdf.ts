import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SGC_INSTITUTIONAL_FIRST_TOP_CM, SGC_INSTITUTIONAL_OTHER_TOP_CM } from './institutional';
import type { SgcSheetSettings } from '../sheetSettings';

/**
 * 2026-10-22 (Calidad OLP: «los formatos en Excel aún no salen bien»): piezas
 * para usar el PDF que genera MICROSOFT (Graph, motor de Excel Online) dentro
 * del documento del SGC — funciones puras sobre pdf-lib y exceljs.
 *
 *   - Sin encabezado institucional (carga inicial, adjuntos), el PDF de
 *     Microsoft se usa tal cual.
 *   - Con encabezado institucional, cada página de Microsoft se coloca A
 *     ESCALA dentro del espacio que deja el encabezado (más alto en la primera
 *     página), en A4 de la orientación del documento: así el encabezado y los
 *     recuadros de firma nunca tapan el contenido.
 */

const CM = 28.3465;
const A4 = { portrait: [595.28, 841.89] as [number, number], landscape: [841.89, 595.28] as [number, number] };
const SIDE_CM = 2;
const BOTTOM_CM = 2.2;

/** Coloca cada página del PDF dentro del área de contenido de una página A4 con encabezado institucional. */
export async function fitPdfIntoInstitutionalPages(pdfBytes: Uint8Array, landscape: boolean): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [pw, ph] = landscape ? A4.landscape : A4.portrait;
  const pages = src.getPages();
  const embedded = await Promise.all(pages.map((p) => (p.node.Contents() ? out.embedPage(p) : null)));
  embedded.forEach((page, i) => {
    // Una página sin contenido (en blanco) no se puede incrustar: queda una página en blanco en su lugar.
    if (!page) {
      out.addPage([pw, ph]);
      return;
    }
    const target = out.addPage([pw, ph]);
    const top = (i === 0 ? SGC_INSTITUTIONAL_FIRST_TOP_CM : SGC_INSTITUTIONAL_OTHER_TOP_CM) * CM;
    const boxW = pw - 2 * SIDE_CM * CM;
    const boxH = ph - top - BOTTOM_CM * CM;
    const scale = Math.min(1, boxW / page.width, boxH / page.height);
    const w = page.width * scale;
    const h = page.height * scale;
    target.drawPage(page, { x: (pw - w) / 2, y: ph - top - h, width: w, height: h });
  });
  return out.save();
}

/** ¿Todas las páginas son A4 de esa orientación? (entonces el PDF de Microsoft ya trae el espacio del encabezado) */
export async function pdfIsA4(pdfBytes: Uint8Array, landscape: boolean): Promise<boolean> {
  const [w, h] = landscape ? A4.landscape : A4.portrait;
  const pages = (await PDFDocument.load(pdfBytes, { ignoreEncryption: true })).getPages();
  return pages.length > 0 && pages.every((p) => Math.abs(p.getWidth() - w) < 3 && Math.abs(p.getHeight() - h) < 3);
}

/** Número de páginas de un PDF (para avisar si Microsoft no devolvió nada útil). */
export async function pdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdfBytes, { ignoreEncryption: true })).getPageCount();
}

/**
 * Orientación que el Excel tiene configurada para imprimir (la de su primera
 * hoja visible): es la que usa la conversión de Microsoft. Ilegible → vertical.
 */
export async function xlsxPrintsLandscape(bytes: Uint8Array): Promise<boolean> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    const first = (wb.worksheets as (ExcelJS.Worksheet & { state?: string })[]).find((w) => w.state !== 'hidden' && w.state !== 'veryHidden');
    return first?.pageSetup?.orientation === 'landscape';
  } catch {
    return false;
  }
}

/**
 * ¿Los ajustes de presentación se pueden aplicar en la conversión de Microsoft? Sí, si solo tocan la
 * orientación y el tamaño (van en la configuración de página del Excel); el área de impresión, las filas
 * de título y las hojas o columnas que no salen usan la conversión de SynerLink.
 */
export function microsoftCanApply(settings: SgcSheetSettings | null): boolean {
  return !settings || settings.sheets.every((x) => x.include && !x.printArea && !x.titleRows && x.hiddenColumns.length === 0);
}

function setAttr(tag: string, name: string, value: string | null): string {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  const without = tag.replace(re, '');
  if (value === null) return without;
  return without.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
}

/**
 * Prepara una COPIA del Excel para la conversión de Microsoft tocando SOLO la configuración de página de
 * cada hoja (lo demás del archivo queda byte a byte igual):
 *   - sin ajustes: si la hoja no tiene «Ajustar a» ni una escala propia, «ajustar a 1 página de ancho»
 *     (así un formato ancho no se parte en varias páginas, como pasaría al imprimirlo desde Excel);
 *   - con ajustes: la orientación elegida y el tamaño (ajustar al ancho, tamaño real o la escala).
 * El original guardado (y su huella) no cambia: esto es solo para generar el PDF.
 */
export async function prepareXlsxForMicrosoft(bytes: Uint8Array, settings: SgcSheetSettings | null, opts: { institutional?: boolean } = {}): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  let changed = false;
  for (const name of sheets) {
    const xml = await zip.file(name)!.async('string');
    const setup = /<pageSetup\b[^>]*\/?>/.exec(xml)?.[0] ?? null;
    const hasFit = /<pageSetUpPr\b[^>]*\bfitToPage="(1|true)"/.test(xml);
    const ownScale = setup ? Number(/\bscale="(\d+)"/.exec(setup)?.[1] ?? '100') !== 100 : false;
    let fit: 'ancho' | 'real' | 'escala' | null = null;
    let scale: number | null = null;
    let orientation: string | null = null;
    if (settings) {
      fit = settings.fit;
      scale = settings.fit === 'escala' ? settings.scalePct : settings.fit === 'real' ? 100 : null;
      orientation = settings.orientation === 'horizontal' ? 'landscape' : settings.orientation === 'vertical' ? 'portrait' : null;
    } else if (!hasFit && !ownScale) fit = 'ancho';
    // Con encabezado institucional: hoja A4, márgenes que dejan arriba el espacio del encabezado (y 2 cm a los lados,
    // 2,2 cm abajo) y sin el encabezado o pie propios del Excel (los pone el sistema). Así el PDF de Microsoft ya
    // viene paginado por Excel con su espacio y el encabezado se dibuja encima, sin achicar el contenido.
    if (opts.institutional && !fit) fit = 'ancho';
    if (!fit && !orientation && !opts.institutional) continue;
    let out = xml;
    // <pageSetup>: va después de <pageMargins>; si la hoja no tiene ninguno de los dos, no se toca.
    let newSetup = setup ?? (/<pageMargins\b[^>]*\/>/.test(out) ? '<pageSetup/>' : null);
    if (!newSetup) continue;
    if (orientation) newSetup = setAttr(newSetup, 'orientation', orientation);
    if (opts.institutional) newSetup = setAttr(newSetup, 'paperSize', '9');
    if (fit === 'ancho') newSetup = setAttr(setAttr(setAttr(newSetup, 'fitToWidth', '1'), 'fitToHeight', '0'), 'scale', null);
    else if (fit) newSetup = setAttr(setAttr(setAttr(newSetup, 'scale', String(scale ?? 100)), 'fitToWidth', null), 'fitToHeight', null);
    out = setup ? out.replace(setup, newSetup) : out.replace(/(<pageMargins\b[^>]*\/>)/, `$1${newSetup}`);
    if (opts.institutional) {
      const inch = (cm: number) => String(Math.round((cm / 2.54) * 1000) / 1000);
      const margins = `<pageMargins left="${inch(2)}" right="${inch(2)}" top="${inch(SGC_INSTITUTIONAL_FIRST_TOP_CM)}" bottom="${inch(2.2)}" header="0" footer="0"/>`;
      out = /<pageMargins\b[^>]*\/>/.test(out) ? out.replace(/<pageMargins\b[^>]*\/>/, margins) : out.replace(newSetup, `${margins}${newSetup}`);
      out = out.replace(/<headerFooter\b[^>]*\/>/, '').replace(/<headerFooter\b[\s\S]*?<\/headerFooter>/, '');
    }
    // <sheetPr><pageSetUpPr fitToPage/>: solo con «ajustar al ancho»; sin él se quita (manda la escala).
    if (fit) {
      const want = fit === 'ancho' ? '1' : '0';
      if (/<pageSetUpPr\b[^>]*\/>/.test(out)) out = out.replace(/<pageSetUpPr\b[^>]*\/>/, (t) => setAttr(t, 'fitToPage', want));
      else if (/<sheetPr\b[^>]*\/>/.test(out)) out = out.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1><pageSetUpPr fitToPage="${want}"/></sheetPr>`);
      else if (/<sheetPr\b[^>]*>/.test(out)) out = out.replace(/<\/sheetPr>/, `<pageSetUpPr fitToPage="${want}"/></sheetPr>`);
      else out = out.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr><pageSetUpPr fitToPage="${want}"/></sheetPr>`);
    }
    if (out !== xml) {
      zip.file(name, out);
      changed = true;
    }
  }
  return changed ? new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })) : bytes;
}
