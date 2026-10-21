import { sanitizeDraftHtml } from '../draft/html';
import { SgcError } from '../errors';
import { SGC_INSTITUTIONAL_FIRST_TOP_CM, SGC_INSTITUTIONAL_OTHER_TOP_CM } from './institutional';
import type { SgcSheetLayout } from './viewable';

/**
 * Conversión del borrador a PDF para el PDF controlado (servidor).
 *
 *   - Word (.docx) → HTML con `mammoth` (mismo patrón que el módulo documental
 *     anterior, traído del historial de git; ver plan «Qué se reutiliza»).
 *   - HTML (editor de la app o Word convertido) → PDF con Chrome headless
 *     (`puppeteer`, Chromium propio; la .230 lo tiene en su caché).
 *
 * Endurecido: el HTML se LIMPIA con lista blanca antes de imprimirse, Chrome
 * corre con JavaScript apagado y rechaza cualquier petición de red (solo
 * se permite el propio documento), así el contenido no ejecuta ni carga nada.
 */

export type SgcHtmlToPdf = (html: string) => Promise<Uint8Array>;
export type SgcDocxToHtml = (bytes: Uint8Array) => Promise<string>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * Documento imprimible A4 con el contenido limpio. Con `institutional` deja
 * arriba el espacio del encabezado institucional que el sistema dibuja después
 * (más alto en la primera página; ver lib/sgc/pdf/institutional.ts).
 */
/** Hoja de estilos de las hojas de Excel: solo reglas «.sgc-…{…}» sin «<», «@» ni «url(» (la arma lib/sgc/pdf/viewable.ts). */
function sheetCss(css: string | undefined): string {
  if (!css) return '';
  return css
    .split('\n')
    // 2026-10-21: «import» suelto descartaba «!important» (los bordes del Excel no salían); «@import» ya no pasa por la «@».
    .filter((rule) => /^[a-z.,\s-]*\.sgc-[a-z0-9-]+[^{]*\{[^{}<@]*\}$/i.test(rule.trim()) && !/url\(|expression/i.test(rule))
    .join('\n');
}

/** Ancho útil de la página en puntos (A4: 595,28 × 841,89 pt; 1 cm = 28,35 pt). */
const A4_PT = { portrait: 595.28, landscape: 841.89 };
const CM_PT = 28.3465;
/** Márgenes laterales de una hoja de Excel sin encabezado institucional (más angostos que los del texto). */
const SHEET_SIDE_CM = 1.2;

/**
 * 2026-10-21: escala de cada tabla de Excel para que quepa en el ancho útil
 * de la página (nunca la agranda; mínimo 25 % para que siga legible).
 */
export function sheetZoomCss(layout: SgcSheetLayout | undefined, usableWidthPt: number): string {
  if (!layout || layout.fit === 'real') return '';
  const tables = layout.tables.filter((t) => /^sgc-t-\d{1,3}$/.test(t.cls) && Number.isFinite(t.widthPt));
  // 2026-10-21 (ajustes de la carga inicial): escala fija elegida por quien carga (25 % a 150 %).
  if (layout.fit === 'escala') {
    const pct = Number(layout.scalePct);
    if (!Number.isInteger(pct) || pct < 25 || pct > 150) return '';
    return tables.map((t) => `table.${t.cls}{zoom:${pct / 100}}`).join('\n');
  }
  return tables
    .filter((t) => t.widthPt > usableWidthPt)
    .map((t) => `table.${t.cls}{zoom:${Math.max(0.25, Math.floor((usableWidthPt / t.widthPt) * 1000) / 1000)}}`)
    .join('\n');
}

export function wrapDraftForPdf(params: { title: string; code: string; contentHtml: string; institutional?: boolean; sheet?: boolean; extraCss?: string; sheetLayout?: SgcSheetLayout }): string {
  // El encabezado institucional y las casillas de firma están calculados para A4 vertical: ahí la hoja solo se escala.
  const orientation = params.sheetLayout?.orientation ?? 'auto';
  const landscape = Boolean(params.sheet && !params.institutional && (orientation === 'horizontal' || (orientation === 'auto' && params.sheetLayout?.landscape)));
  const page = params.institutional
    ? `@page { size: A4; margin: ${SGC_INSTITUTIONAL_OTHER_TOP_CM}cm 2cm 2.2cm 2cm; }
  @page :first { margin-top: ${SGC_INSTITUTIONAL_FIRST_TOP_CM}cm; }`
    : params.sheet
      ? `@page { size: A4${landscape ? ' landscape' : ''}; margin: 1.5cm ${SHEET_SIDE_CM}cm; }`
      : '@page { size: A4; margin: 2.2cm 2cm; }';
  const usableWidthPt = (landscape ? A4_PT.landscape : A4_PT.portrait) - 2 * (params.institutional ? 2 : SHEET_SIDE_CM) * CM_PT;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>${escapeHtml(params.title)}</title>
<style>
  ${page}
  * { box-sizing: border-box; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 6pt; } h2 { font-size: 14pt; margin: 16pt 0 6pt; } h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1px solid #999; padding: 6pt 8pt; text-align: left; font-size: 10pt; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; }
  ul, ol { margin: 0 0 8pt 18pt; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 8pt 0; padding-left: 10pt; color: #444; }
  img { max-width: 100%; height: auto; }${
    params.sheet
      ? `
  /* S16 (R32) y 2026-10-21: hojas de un formato en Excel — con los anchos y la letra del Excel, escaladas al ancho de la página. */
  table.sgc-hoja { table-layout: fixed; width: auto; font-size: 11pt; line-height: 1.2; }
  table.sgc-hoja th, table.sgc-hoja td { padding: 1pt 3pt; font-size: 11pt; overflow-wrap: break-word; }
  table.sgc-hoja tr { break-inside: avoid; }
  table.sgc-hoja thead { display: table-header-group; }
  h2.sgc-hoja-nombre { font-size: 10pt; color: #555; }
  h2.sgc-hoja-sig { break-before: page; }
  ${sheetCss(params.extraCss)}
  ${sheetZoomCss(params.sheetLayout, usableWidthPt)}`
      : ''
  }
</style></head>
<body>${sanitizeDraftHtml(params.contentHtml)}</body></html>`;
}

export const docxToHtml: SgcDocxToHtml = async (bytes) => {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return sanitizeDraftHtml(result.value ?? '');
};

type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Page = {
  setJavaScriptEnabled(v: boolean): Promise<void>;
  setRequestInterception(v: boolean): Promise<void>;
  on(event: 'request', cb: (req: { url(): string; abort(): Promise<void>; continue(): Promise<void>; isNavigationRequest(): boolean }) => void): void;
  setContent(html: string, opts: { waitUntil: 'load' }): Promise<void>;
  pdf(opts: { format: 'A4'; printBackground: boolean; preferCSSPageSize?: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
};

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = (await import('puppeteer')).default;
      const b = (await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })) as unknown as Browser;
      // Sprint 6: si Chrome se cae, el siguiente PDF lanza uno nuevo (antes quedaba roto hasta reiniciar).
      (b as unknown as { on?: (ev: string, cb: () => void) => void }).on?.('disconnected', () => {
        browserPromise = null;
      });
      return b;
    })().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

export const htmlToPdf: SgcHtmlToPdf = async (html) => {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (e) {
    console.error('[sgc/pdf] no se pudo iniciar Chrome headless', e);
    throw new SgcError('No se pudo iniciar el generador de PDF del servidor. Avise a Tecnología.', 503);
  }
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url === 'about:blank' || url.startsWith('data:')) void req.continue();
      else void req.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    // 2026-10-21: manda el «@page» del documento (todos son A4; las hojas de Excel anchas, A4 horizontal).
    return new Uint8Array(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  } finally {
    await page.close().catch(() => undefined);
  }
};
