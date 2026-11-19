import { prisma } from '../prisma';
import { downloadSgcFile } from '../sgc/onedrive';
import { docxToHtml } from '../sgc/pdf/render';
import { sanitizeDraftHtml } from '../sgc/draft/html';
import { generatorSourceFormat } from '../sgc/generator';
import { htmlToken, resolveWordLabel, unresolvedHtmlMarkers, type DocMarker } from './fields';
import { detectDocxTags, type WordTagReport } from './fillDocx';
import { DocTemplateError } from './engine';

/**
 * Origen de la plantilla de una tarea «Plantilla de documento»: Word subido o documento
 * VIGENTE del SGC de una empresa del flujo (codificados o no, decisión de Nicolás 2026-11-18).
 */

/** Vigentes del SGC de las empresas del flujo (con su versión vigente y si tiene Word/HTML fuente). */
export async function listSgcVigentes(companies: readonly number[]) {
  if (!companies.length) return [];
  const docs = await prisma.sgcDocument.findMany({
    where: { id_company: { in: [...companies] }, status: 'vigente', current_version_id: { not: null } },
    select: { id_document: true, id_company: true, code: true, title: true, current_version_id: true, documentType: { select: { name: true } } },
    orderBy: { code: 'asc' },
  });
  const versions = docs.length
    ? await prisma.sgcDocumentVersion.findMany({
        where: { id_document_version: { in: docs.map((d) => d.current_version_id!) } },
        select: { id_document_version: true, version_number: true, source_item_id: true, source_file_name: true },
      })
    : [];
  const byId = new Map(versions.map((v) => [v.id_document_version, v]));
  return docs.map((d) => {
    const v = byId.get(d.current_version_id!);
    return {
      idDocument: d.id_document,
      idCompany: d.id_company,
      code: d.code,
      title: d.title,
      documentType: d.documentType.name,
      idVersion: d.current_version_id!,
      versionNumber: v?.version_number ?? null,
      format: v?.source_item_id ? generatorSourceFormat(v.source_file_name) : null,
    };
  });
}

/** Versión vigente de un documento del SGC de las empresas del flujo, lista para usarse como plantilla. */
export async function sgcVigenteSource(idDocument: number, companies: readonly number[]) {
  const doc = await prisma.sgcDocument.findUnique({
    where: { id_document: idDocument },
    select: { id_document: true, id_company: true, code: true, title: true, status: true, current_version_id: true },
  });
  if (!doc || !companies.includes(doc.id_company)) throw new DocTemplateError('Documento del SGC no encontrado en las empresas del flujo.', 404);
  if (doc.status !== 'vigente' || !doc.current_version_id) throw new DocTemplateError('Solo se puede usar un documento VIGENTE del SGC.', 409);
  const v = await prisma.sgcDocumentVersion.findUnique({
    where: { id_document_version: doc.current_version_id },
    select: { id_document_version: true, version_number: true, source_item_id: true, source_file_name: true },
  });
  const format = v?.source_item_id ? generatorSourceFormat(v.source_file_name) : null;
  if (!v || !format) throw new DocTemplateError(`${doc.code} solo tiene el PDF controlado: la plantilla debe partir de un Word o del editor del SGC.`, 409);
  return { doc, version: v, format };
}

/** Convierte «@{Etiqueta}» que resuelven en tokens del motor editor (las demás quedan como texto). */
export function wordTagsToTokens(html: string, catalog: readonly DocMarker[]): string {
  return html.replace(/@\{([^{}<>]{1,100})\}/g, (all, label: string) => {
    const key = resolveWordLabel(label, catalog);
    return key ? htmlToken(key) : all;
  });
}

export interface PreparedSource {
  html: string | null;
  tags: WordTagReport[] | null;
  unresolved: string[];
}

/** Prepara el origen según el motor: HTML editable (editor) o marcas detectadas (word). */
export async function prepareSource(bytes: Uint8Array, format: 'docx' | 'html', engine: 'editor' | 'word', catalog: readonly DocMarker[]): Promise<PreparedSource> {
  if (engine === 'word') {
    if (format !== 'docx') throw new DocTemplateError('El motor Word necesita un archivo .docx.');
    const tags = detectDocxTags(bytes, catalog);
    return { html: null, tags, unresolved: tags.filter((t) => !t.key).map((t) => t.tag) };
  }
  const raw = format === 'docx' ? await docxToHtml(bytes) : sanitizeDraftHtml(new TextDecoder().decode(bytes));
  const html = wordTagsToTokens(raw, catalog);
  return { html, tags: null, unresolved: unresolvedHtmlMarkers(html, catalog) };
}

export async function downloadSource(itemId: string): Promise<Uint8Array> {
  return downloadSgcFile(itemId);
}
