import { getDraftHtmlError } from '../draft/html';
import { SgcError } from '../errors';
import { canUseSgcGenerator, generatorFileName, generatorLegend, generatorSourceFormat, type SgcGeneratorSourceFormat } from '../generator';
import type { SgcMasterItem } from '../masterList';
import type { SgcAccessSubject } from '../documentAccess';
import { drawInstitutionalHeaders } from '../pdf/institutional';
import type { SgcDocxToHtml, SgcHtmlToPdf } from '../pdf/render';
import type { SgcCompanyAccess } from '../permissions';
import { toWinAnsiSafe } from '../watermark';
import type { SgcDb } from './catalogs';
import { canViewDocument, listMasterDocuments } from './documents';
import { cargoOf, composeContent, personLabel } from './layout';

/**
 * GENERADOR DE DOCUMENTOS — capa de datos (ver lib/sgc/generator.ts).
 *
 * Solo LEE el documento controlado: nada de lo que se hace aquí crea versión,
 * solicitud, revisión ni archivo. El PDF generado se arma en memoria y se
 * entrega en la misma respuesta.
 */

export interface SgcGeneratorItem extends SgcMasterItem {
  /** Formato del contenido vigente que se abre en el editor, o null si la versión solo tiene PDF. */
  sourceFormat: SgcGeneratorSourceFormat | null;
}

export interface SgcGeneratorDeps {
  download: (itemId: string) => Promise<Uint8Array>;
  docxToHtml: SgcDocxToHtml;
  htmlToPdf: SgcHtmlToPdf;
}

/** Vigentes que la persona puede consultar, con el formato de su contenido editable. */
export async function listGeneratorDocuments(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject): Promise<SgcGeneratorItem[]> {
  const docs = await listMasterDocuments(db, access, subject, { status: 'vigente' });
  const ids = docs.map((d) => d.idVersion).filter((v): v is number => v !== null);
  const versions = ids.length ? await db.sgcDocumentVersion.findMany({ where: { id_document_version: { in: ids } }, select: { id_document_version: true, source_file_name: true, source_item_id: true } }) : [];
  const byId = new Map(versions.map((v) => [v.id_document_version, v]));
  return docs
    .filter((d) => d.status === 'vigente' && d.idVersion !== null)
    .map((d) => {
      const v = byId.get(d.idVersion!);
      return { ...d, sourceFormat: v?.source_item_id ? generatorSourceFormat(v.source_file_name) : null };
    });
}

/** Documento vigente + versión vigente, validando que la persona lo pueda consultar. */
async function loadVigente(db: SgcDb, accessByCompany: readonly SgcCompanyAccess[], subject: SgcAccessSubject, idDocument: number) {
  if (!Number.isInteger(idDocument) || idDocument < 1) throw new SgcError('Documento no encontrado', 404);
  if (!(await canViewDocument(db, accessByCompany, subject, idDocument))) throw new SgcError('Documento no encontrado', 404);
  const doc = await db.sgcDocument.findUnique({
    where: { id_document: idDocument },
    include: { documentType: true, process: true, companyConfig: { include: { company: { select: { company: true } } } } },
  });
  if (!doc) throw new SgcError('Documento no encontrado', 404);
  if (!canUseSgcGenerator(accessByCompany.find((a) => a.idCompany === doc.id_company))) throw new SgcError('El generador de documentos es para gestión documental o Aseguramiento de Calidad.', 403);
  if (doc.status !== 'vigente' || !doc.current_version_id) throw new SgcError('Solo se generan documentos a partir de un documento vigente.', 409);
  const version = await db.sgcDocumentVersion.findUnique({ where: { id_document_version: doc.current_version_id } });
  if (!version || version.status !== 'vigente') throw new SgcError('El documento no tiene una versión vigente.', 409);
  return { doc, version };
}

/**
 * Contenido VIGENTE como HTML para el editor (copia de trabajo): el Word fuente
 * convertido o el HTML del editor con el que se aprobó la versión.
 */
export async function getGeneratorBase(db: SgcDb, deps: Pick<SgcGeneratorDeps, 'download' | 'docxToHtml'>, accessByCompany: readonly SgcCompanyAccess[], subject: SgcAccessSubject, idDocument: number) {
  const { doc, version } = await loadVigente(db, accessByCompany, subject, idDocument);
  const format = version.source_item_id ? generatorSourceFormat(version.source_file_name) : null;
  if (!format) throw new SgcError('La versión vigente solo tiene el PDF controlado (sin Word ni contenido del editor): no se puede abrir como copia de trabajo.', 409);
  const bytes = await deps.download(version.source_item_id!);
  const html = format === 'docx' ? await deps.docxToHtml(bytes) : new TextDecoder().decode(bytes);
  return {
    document: { id: doc.id_document, idCompany: doc.id_company, code: doc.code, title: doc.title, versionNumber: version.version_number, idVersion: version.id_document_version },
    sourceFormat: format,
    html,
  };
}

interface ManifestLite {
  institutionalHeader?: boolean;
  signatures?: { meaning: string; signerName: string | null; signerEmail: string }[];
}

function parseManifest(raw: string | null): ManifestLite {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ManifestLite;
  } catch {
    return {};
  }
}

/**
 * Genera el PDF de la copia de trabajo con el encabezado del documento de
 * origen (código, versión, título, empresa; el institucional si la versión lo
 * usa) y la leyenda «Documento generado a partir de …» al pie de cada página.
 * No guarda nada: devuelve los bytes.
 */
export async function generateFromVigente(
  db: SgcDb,
  deps: Pick<SgcGeneratorDeps, 'docxToHtml' | 'htmlToPdf'>,
  accessByCompany: readonly SgcCompanyAccess[],
  subject: SgcAccessSubject,
  idDocument: number,
  input: { html: unknown },
  now: Date = new Date()
) {
  const htmlError = getDraftHtmlError(input.html);
  if (htmlError) throw new SgcError(htmlError.replace('El borrador', 'El documento').replace('el borrador', 'el documento'));
  const { doc, version } = await loadVigente(db, accessByCompany, subject, idDocument);
  const manifest = parseManifest(version.manifest_json);
  const institutional = manifest.institutionalHeader === true;
  const sigs = manifest.signatures ?? [];
  const cargos = await cargoOf(db, doc.id_company, sigs.map((s) => s.signerEmail));
  const namesFor = (meaning: string) => [...new Set(sigs.filter((s) => s.meaning === meaning).map((s) => personLabel(s.signerName, s.signerEmail, cargos.get(s.signerEmail.trim().toLowerCase()))))];
  const effective = version.effective_date ? version.effective_date.toISOString().slice(0, 10) : '—';
  const company = doc.companyConfig.company.company;

  const composed = await composeContent(db, deps, {
    idCompany: doc.id_company,
    idDocument: doc.id_document,
    draft: { format: 'html', bytes: null, html: String(input.html) },
    institutional,
    code: doc.code,
    title: doc.title,
    versionNumber: version.version_number,
    company,
    process: `${doc.process.code} · ${doc.process.name}`,
    documentType: doc.documentType.name,
    elaboro: namesFor('elaboro'),
    reviso: namesFor('reviso'),
    aprobo: namesFor('aprobo'),
    changeDate: effective,
    changeReason: version.change_description ?? '',
    emissionText: effective,
  });

  const user = await db.user.findFirst({ where: { email: { equals: subject.email } }, select: { name: true } });
  const legend = toWinAnsiSafe(generatorLegend({ code: doc.code, versionNumber: version.version_number, user: (user?.name ?? '').trim() || subject.email, at: now }));

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(composed.contentPdf, { ignoreEncryption: true });
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  if (composed.header) await drawInstitutionalHeaders(pdf, pdf.getPages(), composed.header, fonts);
  else {
    // Sin plantilla institucional: la misma línea superior del PDF controlado (código · versión · título · empresa).
    const top = toWinAnsiSafe(`${doc.code} · Versión ${version.version_number} · ${doc.title} · ${company}`);
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      let size = 7.5;
      while (size > 5 && fonts.regular.widthOfTextAtSize(top, size) > width - 40) size -= 0.5;
      page.drawText(top, { x: 20, y: height - 14, size, font: fonts.regular, color: rgb(0.42, 0.45, 0.5) });
    }
  }
  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    let size = 7;
    while (size > 5 && fonts.regular.widthOfTextAtSize(legend, size) > width - 40) size -= 0.5;
    page.drawText(legend, { x: 20, y: 8, size, font: fonts.regular, color: rgb(0.55, 0.1, 0.1) });
  }
  pdf.setTitle(`${doc.code} V${version.version_number} - documento generado`);
  pdf.setProducer('SynerLink · SGC · Generador de documentos');
  const bytes = await pdf.save();
  return {
    bytes,
    fileName: generatorFileName(doc.code, version.version_number, now),
    legend,
    document: { id: doc.id_document, idCompany: doc.id_company, code: doc.code, versionNumber: version.version_number, idVersion: version.id_document_version },
  };
}
