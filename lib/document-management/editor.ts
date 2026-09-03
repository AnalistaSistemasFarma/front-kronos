import { prisma } from '../prisma';
import { sanitizeOneDriveName } from '../onedriveName';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
import { buildDocumentVersionFolderSegments } from './storagePath';
import { createDocumentVersionAndStartWorkflow } from './workflowEngine';
import { INITIAL_STATE } from './workflowStates';
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
 * DECISIÓN DE PRODUCTO (2026-09-03, Nicolás): "Guardar" desde el editor ya
 * NO se comporta igual para todos los documentos — depende de si el
 * documento tiene o no un proceso/categoría asociado (`Document.id_process`).
 *
 *   - Caso A (`id_process IS NULL`, carga histórica sin flujo): el PDF se
 *     genera y se entrega como DESCARGA directa al navegador del usuario.
 *     No se toca OneDrive ni la base de datos en absoluto — ni
 *     `onedrive_item_id`/`onedrive_path` de la versión vigente, ni se crea
 *     ningún registro nuevo. Ver `generatePdfForDownload`.
 *
 *   - Caso B (`id_process IS NOT NULL`, ya pasó por el flujo de 14 estados
 *     al menos una vez): "Guardar" crea una VERSIÓN NUEVA de `DocumentVersion`
 *     (nunca sobrescribe el archivo/versión vigente actual) y esa versión
 *     nueva vuelve a entrar al flujo de aprobación de 14 estados, igual que
 *     cualquier otra versión nueva de un documento existente — ver
 *     `createNewVersionFromEditorAndStartWorkflow`, que reutiliza
 *     `createDocumentVersionAndStartWorkflow` (lib/document-management/
 *     workflowEngine.ts), el MISMO mecanismo atómico que ya usa
 *     lib/document-management/newVersion.ts para "cargar una versión nueva"
 *     por archivo. El documento sigue mostrando como vigente la versión
 *     ANTERIOR: `current_version_id` no se toca aquí — solo lo actualiza
 *     `transitionDocumentVersion` cuando la nueva versión llegue a "Vigente"
 *     (acción `publicar_vigente`), exactamente igual que cualquier otra
 *     versión nueva del módulo.
 *
 * Reemplaza la decisión de alcance anterior de este mismo archivo (Sprint 8
 * inicial, 2026-09-02), que hacía que "Guardar" SIEMPRE sobrescribiera en
 * sitio el contenido/PDF de la versión vigente sin distinguir `id_process`.
 * Ese comportamiento único ya no existe.
 *
 * Fuera de alcance (sigue igual que antes): NO convierte DOCX/PDF ya
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

export interface GeneratePdfForDownloadInput {
  idDocument: number;
  idDocumentVersion: number;
  contentHtml: string;
}

export interface GeneratePdfForDownloadResult {
  pdfBuffer: Buffer;
  fileName: string;
}

/**
 * Caso A (`document.id_process IS NULL`): genera el PDF a partir del HTML
 * editado y lo devuelve en memoria para que el llamador (la ruta API) lo
 * entregue como descarga al navegador. NO escribe nada en OneDrive ni en la
 * base de datos — ni `content_html`, ni `onedrive_item_id`/`onedrive_path`,
 * ni ningún registro nuevo. El documento y su versión vigente quedan
 * exactamente igual que antes de presionar "Guardar".
 */
export async function generatePdfForDownload(
  input: GeneratePdfForDownloadInput
): Promise<GeneratePdfForDownloadResult> {
  const version = await prisma.documentVersion.findUnique({
    where: { id_document_version: input.idDocumentVersion },
    include: { document: true },
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
  const fileName = sanitizeOneDriveName(`${document.code}-v${version.version_number}.pdf`);

  return { pdfBuffer, fileName };
}

export interface CreateVersionFromEditorInput {
  idDocument: number;
  contentHtml: string;
  actorUserId: string;
}

export interface CreateVersionFromEditorResult {
  version: {
    id_document_version: number;
    version_number: number;
    status: string;
    content_html: string | null;
    id_request_general: number;
  };
  pdfBytes: number;
}

/**
 * Caso B (`document.id_process IS NOT NULL`): genera el PDF a partir del
 * HTML editado, lo sube a OneDrive como archivo NUEVO (carpeta de la nueva
 * versión, nunca la de la versión vigente actual) y crea la nueva
 * `DocumentVersion` + arranca su flujo de aprobación de 14 estados en una
 * sola transacción atómica — reutilizando `createDocumentVersionAndStartWorkflow`
 * (lib/document-management/workflowEngine.ts), el MISMO mecanismo que usa
 * lib/document-management/newVersion.ts para cargar una versión nueva por
 * archivo. `current_version_id` del documento NO se toca aquí: sigue
 * apuntando a la versión anterior (la vigente) hasta que esta versión nueva
 * complete el flujo y llegue a "Vigente" (acción `publicar_vigente` en
 * `transitionDocumentVersion`, que sí actualiza `current_version_id` — ver
 * workflowEngine.ts).
 */
export async function createNewVersionFromEditorAndStartWorkflow(
  input: CreateVersionFromEditorInput
): Promise<CreateVersionFromEditorResult> {
  const document = await prisma.document.findUnique({
    where: { id_document: input.idDocument },
    include: { company: true, documentType: true },
  });
  if (!document) throw new EditorError('Documento no encontrado', 404);

  const lastVersion = await prisma.documentVersion.findFirst({
    where: { id_document: input.idDocument },
    orderBy: { version_number: 'desc' },
  });
  const versionNumber = (lastVersion?.version_number ?? 0) + 1;

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
    versionNumber,
  });
  const fileName = sanitizeOneDriveName(`${document.code}-v${versionNumber}.pdf`);
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

  const { idDocumentVersion, idRequestGeneral } = await createDocumentVersionAndStartWorkflow({
    idDocument: input.idDocument,
    versionNumber,
    onedriveItemId: uploaded.id,
    onedrivePath: fullPath,
    createdBy: input.actorUserId,
    comments: null,
    idCompany: document.id_company,
    ownerUserId: document.owner_user_id,
    subject: `${document.code} v${versionNumber} — ${document.title}`,
    contentHtml: input.contentHtml,
  });

  return {
    version: {
      id_document_version: idDocumentVersion,
      version_number: versionNumber,
      status: INITIAL_STATE,
      content_html: input.contentHtml,
      id_request_general: idRequestGeneral,
    },
    pdfBytes: pdfBuffer.length,
  };
}
