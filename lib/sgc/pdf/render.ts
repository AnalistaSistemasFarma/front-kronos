import { sanitizeDraftHtml } from '../draft/html';
import { SgcError } from '../errors';

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

/** Documento imprimible A4 con el contenido limpio (no es una plantilla por tipo documental). */
export function wrapDraftForPdf(params: { title: string; code: string; contentHtml: string }): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>${escapeHtml(params.title)}</title>
<style>
  @page { size: A4; margin: 2.2cm 2cm; }
  * { box-sizing: border-box; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 6pt; } h2 { font-size: 14pt; margin: 16pt 0 6pt; } h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1px solid #999; padding: 6pt 8pt; text-align: left; font-size: 10pt; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; }
  ul, ol { margin: 0 0 8pt 18pt; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 8pt 0; padding-left: 10pt; color: #444; }
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
  pdf(opts: { format: 'A4'; printBackground: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
};

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = (await import('puppeteer')).default;
      return (await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })) as unknown as Browser;
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
    return new Uint8Array(await page.pdf({ format: 'A4', printBackground: true }));
  } finally {
    await page.close().catch(() => undefined);
  }
};
