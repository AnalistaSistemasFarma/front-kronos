import { prisma } from '../prisma';
import { sanitizeOneDriveName } from '../onedriveName';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
import { buildDocumentVersionFolderSegments } from './storagePath';
import puppeteer, { type Browser } from 'puppeteer';

/**
 * Sprint 8 — Editor de documentos dentro de la plataforma (Tiptap sobre
 * plantilla HTML, exportando a PDF con Chrome headless vía Puppeteer).
 * Confirmado por Nicolás el 2026-09-02: mismo patrón "Chrome headless →
 * PDF" que ya usa el grupo GSS en otros informes (informe-gerencial-gss,
 * geo-report-pdf), aquí resuelto con la librería `puppeteer` (Chromium
 * propio, sin depender de un Chrome/Edge instalado en el servidor — se
 * verificó que pce0023 no tiene ninguno).
 *
 * DECISIÓN DE ALCANCE (documentada aquí a propósito, pedida explícita del
 * sprint): guardar desde el editor actualiza el CONTENIDO de la versión
 * VIGENTE (`content_html` + el PDF regenerado reemplaza el archivo de esa
 * misma versión en OneDrive). NO crea una versión nueva ni dispara de
 * nuevo el flujo de aprobación de 14 estados (lib/document-management/
 * workflowEngine.ts) — esto es edición de contenido de algo que ya está
 * Vigente/autorizado, no una versión formal nueva sujeta a revisión. Si en
 * el futuro se necesita que cada guardado del editor pase otra vez por
 * aprobación, ese es un cambio de producto a decidir por Nicolás, no una
 * corrección de este sprint.
 *
 * Fuera de alcance (ver instrucciones del sprint): NO convierte DOCX/PDF ya
 * subidos a HTML editable (`content_html` arranca NULL/vacío para
 * versiones que nunca se editaron aquí). NO hay plantillas por tipo de
 * documento (FR-005/029/etc.) — es un editor de texto enriquecido
 * genérico.
 */

export class EditorError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

/**
 * Envuelve el HTML producido por Tiptap en un documento imprimible mínimo
 * (A4, márgenes, tipografía legible, tablas con borde). No es una plantilla
 * por tipo de documento (eso queda fuera de alcance de este sprint) — es un
 * único "papel" genérico con el código del documento como encabezado.
 */
function wrapForPdf(params: { title: string; code: string; contentHtml: string }): string {
  const { title, code, contentHtml } = params;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 2.2cm 2cm; }
  * { box-sizing: border-box; }
  body {
    font-family: Calibri, 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    color: #1a1a1a;
    line-height: 1.5;
    margin: 0;
  }
  h1 { font-size: 18pt; margin: 0 0 6pt; }
  h2 { font-size: 14pt; margin: 16pt 0 6pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1px solid #999; padding: 6pt 8pt; text-align: left; font-size: 10pt; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; }
  ul, ol { margin: 0 0 8pt 18pt; padding: 0; }
  .doc-header { border-bottom: 2px solid #003057; padding-bottom: 8pt; margin-bottom: 16pt; }
  .doc-header .doc-code { color: #666; font-size: 9pt; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-code">${escapeHtml(code)}</div>
  </div>
  ${contentHtml}
</body>
</html>`;
}

// Chromium propio (Puppeteer) lanzado una sola vez por proceso de PM2 y
// reutilizado entre guardados — evitar el costo de arrancar Chrome en cada
// solicitud. Proceso de Next.js corre persistente bajo PM2 (no serverless),
// así que un singleton de módulo es seguro aquí.
let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export interface SaveEditorInput {
  idDocument: number;
  idDocumentVersion: number;
  contentHtml: string;
}

export interface SaveEditorResult {
  version: {
    id_document_version: number;
    content_html: string | null;
    onedrive_item_id: string | null;
    onedrive_path: string;
  };
  pdfBytes: number;
}

/**
 * Persiste el HTML editado en `document_version.content_html`, renderiza el
 * PDF con Chrome headless y lo sube a OneDrive en la misma carpeta de esa
 * versión (mismo patrón de rutas que lib/document-management/newVersion.ts:
 * `GESTION-DOCUMENTAL/<EMPRESA>/<TIPO>/<CODIGO>/v<version>/<archivo>`),
 * reemplazando el archivo existente de la versión (PUT a
 * items/{folderId}:/{fileName}:/content sobrescribe si el nombre coincide).
 * Actualiza `onedrive_item_id`/`onedrive_path` al item recién subido.
 */
export async function saveDocumentVersionContentAndGeneratePdf(
  input: SaveEditorInput
): Promise<SaveEditorResult> {
  const version = await prisma.documentVersion.findUnique({
    where: { id_document_version: input.idDocumentVersion },
    include: { document: { include: { company: true, documentType: true } } },
  });
  if (!version || version.id_document !== input.idDocument) {
    throw new EditorError('Versión no encontrada', 404);
  }
  const document = version.document;

  const html = wrapForPdf({
    title: document.title,
    code: document.code,
    contentHtml: input.contentHtml,
  });
  const pdfBuffer = await renderHtmlToPdf(html);

  const segments = buildDocumentVersionFolderSegments({
    companyName: document.company.company,
    documentTypeName: document.documentType.name,
    code: document.code,
    versionNumber: version.version_number,
  });
  const fileName = sanitizeOneDriveName(`${document.code}-v${version.version_number}.pdf`);
  const fullPath = [...segments, fileName].join('/');

  const token = await getMicrosoftToken();
  if (!token) throw new Error('No se pudo obtener el token de Microsoft Graph');

  const uploaded = await ensureFolderAndUploadFile(
    token,
    segments,
    fileName,
    new Uint8Array(pdfBuffer),
    'application/pdf'
  );

  const updated = await prisma.documentVersion.update({
    where: { id_document_version: version.id_document_version },
    data: {
      content_html: input.contentHtml,
      onedrive_item_id: uploaded.id,
      onedrive_path: fullPath,
    },
  });

  return {
    version: {
      id_document_version: updated.id_document_version,
      content_html: updated.content_html,
      onedrive_item_id: updated.onedrive_item_id,
      onedrive_path: updated.onedrive_path,
    },
    pdfBytes: pdfBuffer.length,
  };
}
