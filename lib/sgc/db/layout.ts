import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { buildCodeRoot, buildDocumentCode, nextSequence } from '../coding';
import type { SgcCurrentDraft } from '../draft/current';
import { sanitizeDraftHtml } from '../draft/html';
import { SgcError } from '../errors';
import { SGC_SIGNATURE_LABELS } from '../flows/definition';
import {
  applySystemFieldTokens,
  buildChangeHistoryHtml,
  decodeLogoDataUrl,
  drawInstitutionalHeaders,
  hasChangeHistoryToken,
  suggestInstitutionalPlacements,
  type SgcChangeHistoryRow,
  type SgcInstitutionalHeaderData,
  type SgcSystemToken,
} from '../pdf/institutional';
import { wrapDraftForPdf, type SgcDocxToHtml, type SgcHtmlToPdf } from '../pdf/render';
import {
  missingPlacements,
  normalizeSgcFields,
  parseStoredFields,
  sgcSignerKey,
  type SgcPlacedMeaning,
  type SgcPlacementParticipant,
  type SgcStoredField,
} from '../signature/fields';
import { sha256HexOf } from '../signature/record';
import { isPdf } from '../storage';
import type { SgcActor, SgcDb } from './catalogs';
import { loadDefinition } from './flows';
import { addInteraction, assertCanView, type SgcViewer } from './requests';
import { currentDraftInTx } from './signatureRecord';

/**
 * COMPOSICIÓN DEL DOCUMENTO del SGC (correcciones de Calidad OLP, 2026-10-02):
 *
 *   - UBICACIÓN DE LAS FIRMAS: el ELABORADOR elige en el documento dónde firma
 *     cada persona (Elaboró, Revisó, Aprobó y el grupo de Calidad), con el
 *     mismo mecanismo de SynerLink (copia congelada en lib/sgc/signature y
 *     components/sgc/signature). Cada guardado es una fila NUEVA de
 *     sgc.document_layout (solo inserción; la última manda) y queda en el
 *     historial y la auditoría. Solo durante la Elaboración: después la
 *     composición queda fija para lo que se firma.
 *   - PLANTILLA INSTITUCIONAL: si el documento la usa, el sistema pone el
 *     encabezado (logo, código, versión, página x de y, elaboró/revisó/aprobó
 *     con su recuadro «Firma», fecha de emisión y proceso) y llena los campos
 *     de sistema del cuerpo y el historial de cambios al generar el PDF.
 *   - VISTA PREVIA del documento final (sin firmas) sobre la que se ubican.
 */

type Tx = Prisma.TransactionClient;
type Db = SgcDb | Tx;

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Dependencias de la composición (subconjunto de las de la firma). */
export interface SgcLayoutDeps {
  download: (itemId: string) => Promise<Uint8Array>;
  htmlToPdf: SgcHtmlToPdf;
  docxToHtml: SgcDocxToHtml;
}

/** Descarga y VERIFICA el borrador vigente (lo que se firma y lo que se compone). */
export async function loadVerifiedDraft(db: Db, deps: Pick<SgcLayoutDeps, 'download'>, idRequest: number): Promise<{ draft: SgcCurrentDraft; bytes: Uint8Array | null; html: string | null }> {
  const draft = await currentDraftInTx(db as never, idRequest);
  if (!draft) throw new SgcError('La solicitud no tiene borrador para firmar.', 409);
  if (draft.kind === 'borrador_adjunto') {
    const bytes = await deps.download(draft.itemId!);
    if (sha256HexOf(bytes) !== draft.sha256) {
      throw new SgcError('El borrador guardado no coincide con su huella registrada (SHA-256): no se puede firmar. Avise a Calidad.', 409);
    }
    return { draft, bytes, html: null };
  }
  const id = Number(draft.ref.split(':')[1]);
  const rev = await db.sgcDraftRevision.findUniqueOrThrow({ where: { id_draft_revision: id } });
  if (sha256HexOf(rev.content_html) !== draft.sha256) {
    throw new SgcError('La revisión del borrador no coincide con su huella registrada (SHA-256): no se puede firmar. Avise a Calidad.', 409);
  }
  return { draft, bytes: null, html: rev.content_html };
}

// ---------------------------------------------------------------------------
// Firmantes del documento y composición guardada
// ---------------------------------------------------------------------------

async function namesOf(db: Db, emails: Iterable<string>): Promise<Map<string, string | null>> {
  const list = [...new Set([...emails].map(lower).filter(Boolean))];
  if (!list.length) return new Map();
  const users = await db.user.findMany({ where: { email: { in: list } }, select: { email: true, name: true } });
  return new Map(users.map((u) => [lower(u.email), u.name ?? null]));
}

/**
 * Personas (o grupo) cuya firma va en el documento, en el orden del flujo:
 * el elaborador, los revisores, los aprobadores y el grupo de verificación de
 * Calidad de la aprobación.
 */
export async function layoutParticipants(db: Db, row: { id_flow_version: number; elaborator_email: string; signers: { step_key: string; user_email: string; sign_order: number; is_active: boolean }[] }): Promise<SgcPlacementParticipant[]> {
  const def = await loadDefinition(db as Tx, row.id_flow_version);
  const emails = new Set<string>([row.elaborator_email, ...row.signers.filter((s) => s.is_active).map((s) => s.user_email)]);
  const names = await namesOf(db, emails);
  const out: SgcPlacementParticipant[] = [];
  for (const t of def.tasks) {
    const meaning = t.signatureMeaning;
    if (meaning !== 'elaboro' && meaning !== 'reviso' && meaning !== 'aprobo') continue;
    const role = SGC_SIGNATURE_LABELS[meaning];
    if (t.assignment === 'elaborador') {
      const e = lower(row.elaborator_email);
      out.push({ key: sgcSignerKey(t.key, e), meaning, name: names.get(e) ?? e, email: e, role });
      continue;
    }
    if (t.assignment !== 'firmantes') continue;
    for (const s of row.signers.filter((x) => x.step_key === t.key && x.is_active).sort((a, b) => a.sign_order - b.sign_order)) {
      const e = lower(s.user_email);
      out.push({ key: sgcSignerKey(t.key, e), meaning, name: names.get(e) ?? e, email: e, role });
    }
    if (t.poolAuthorizationTypeCode) {
      out.push({ key: sgcSignerKey(t.key, null, t.poolAuthorizationTypeCode), meaning, name: 'Aseguramiento de Calidad (grupo)', email: t.poolAuthorizationTypeCode, role });
    }
  }
  return out;
}

export interface SgcLayoutState {
  institutionalHeader: boolean;
  fields: SgcStoredField[];
  contentSha256: string | null;
  savedBy: string | null;
  savedAt: string | null;
  saves: number;
}

/** Última composición guardada (o la de por defecto: sin encabezado institucional y sin cajas). */
export async function latestLayout(db: Db, idRequest: number): Promise<SgcLayoutState> {
  const [last, saves] = await Promise.all([
    db.sgcDocumentLayout.findFirst({ where: { id_request: idRequest }, orderBy: { id_document_layout: 'desc' } }),
    db.sgcDocumentLayout.count({ where: { id_request: idRequest } }),
  ]);
  if (!last) return { institutionalHeader: false, fields: [], contentSha256: null, savedBy: null, savedAt: null, saves: 0 };
  return {
    institutionalHeader: last.institutional_header,
    fields: parseStoredFields(last.fields_json),
    contentSha256: last.content_sha256?.trim() ?? null,
    savedBy: last.saved_by,
    savedAt: last.saved_at.toISOString(),
    saves,
  };
}

function inElaboration(row: { status: string; tasks: { status: string; taskDef: { assignment: string } }[] }): boolean {
  return row.status === 'abierta' && row.tasks.some((t) => t.status === 'abierta' && t.taskDef.assignment === 'elaborador');
}

/** Composición del documento para la vista (participantes, cajas, sugerencias y si la persona puede editarla). */
export async function getDocumentLayout(db: SgcDb, idRequest: number, viewer: SgcViewer) {
  const { row } = await assertCanView(db, idRequest, viewer);
  const [participants, layout, draft] = await Promise.all([layoutParticipants(db, row), latestLayout(db, idRequest), currentDraftInTx(db as never, idRequest)]);
  const keys = new Set(participants.map((p) => p.key));
  const fields = layout.fields.filter((f) => keys.has(f.signerKey));
  const canEdit = inElaboration(row) && lower(row.elaborator_email) === lower(viewer.email);
  return {
    idRequest,
    institutionalHeader: layout.institutionalHeader,
    fields,
    participants,
    missing: missingPlacements(participants, fields).map((p) => p.key),
    suggested: layout.institutionalHeader ? suggestInstitutionalPlacements(participants, fields) : [],
    canEdit,
    draft: draft ? { name: draft.name, sha256: draft.sha256, format: draft.format } : null,
    // La firma se ubicó sobre otro borrador: conviene revisar que la caja siga en su sitio.
    stale: Boolean(draft && layout.contentSha256 && layout.contentSha256 !== draft.sha256 && fields.length > 0),
    savedBy: layout.savedBy,
    savedAt: layout.savedAt,
    saves: layout.saves,
  };
}

/**
 * Guarda la composición: encabezado institucional sí/no y cajas de firma.
 * Solo el ELABORADOR durante la Elaboración. Fila nueva (solo inserción).
 */
export async function saveDocumentLayout(db: SgcDb, idRequest: number, input: { institutionalHeader?: unknown; fields?: unknown; reason?: unknown; pageCount?: unknown }, viewer: SgcViewer, actor: SgcActor) {
  const { row } = await assertCanView(db, idRequest, viewer);
  if (lower(row.elaborator_email) !== lower(actor.email)) throw new SgcError('Solo el elaborador ubica las firmas en el documento.', 403);
  if (!inElaboration(row)) throw new SgcError('Las firmas se ubican durante la elaboración (antes de enviar el documento a revisión).', 409);
  const [participants, current, draft] = await Promise.all([layoutParticipants(db, row), latestLayout(db, idRequest), currentDraftInTx(db as never, idRequest)]);
  const institutional = typeof input.institutionalHeader === 'boolean' ? input.institutionalHeader : current.institutionalHeader;
  if (institutional && draft?.format === 'pdf') {
    throw new SgcError('El encabezado institucional se aplica a documentos editados en la app o en Word: un PDF ya trae su propio formato. Ubique las firmas sobre el PDF.', 409);
  }
  const pages = Number(input.pageCount);
  const pageCount = Number.isInteger(pages) && pages > 0 && pages <= 500 ? pages : null;
  const normalized = input.fields === undefined ? { fields: current.fields.filter((f) => participants.some((p) => p.key === f.signerKey)), error: null } : normalizeSgcFields(input.fields, participants, pageCount);
  if (normalized.error) throw new SgcError(normalized.error);
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) || null : null;
  const fieldsJson = JSON.stringify(normalized.fields);
  // Sin cambios (misma composición, sin contar el identificador de cada caja): no se guarda otra fila.
  const comparable = (list: readonly SgcStoredField[]) => JSON.stringify(list.map((f) => ({ ...f, id: undefined })));
  if (current.saves > 0 && institutional === current.institutionalHeader && comparable(normalized.fields) === comparable(current.fields) && (draft?.sha256 ?? null) === current.contentSha256) {
    return { saved: false, institutionalHeader: institutional, fields: normalized.fields };
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const saved = await tx.sgcDocumentLayout.create({
      data: { id_request: idRequest, institutional_header: institutional, fields_json: fieldsJson, content_sha256: draft?.sha256 ?? null, saved_by: lower(actor.email), saved_at: now, change_reason: reason },
    });
    const placed = normalized.fields.length;
    const missing = missingPlacements(participants, normalized.fields).length;
    await addInteraction(tx, idRequest, 'estado', lower(actor.email), `Ubicó las firmas en el documento: ${placed} de ${participants.length} firma(s) ubicada(s)${missing ? ` (faltan ${missing})` : ''}.${institutional !== current.institutionalHeader ? `\nEncabezado institucional: ${institutional ? 'sí' : 'no'}.` : ''}${reason ? `\nMotivo: ${reason}` : ''}`, {
      meta: { idDocumentLayout: saved.id_document_layout, institutional, placed, missing },
    });
    await writeSgcAudit(tx, {
      idCompany: row.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.firmasUbicadas,
      entity: 'document_layout',
      entityId: saved.id_document_layout,
      before: current.saves ? { institutional: current.institutionalHeader, fields: current.fields } : null,
      after: { institutional, fields: normalized.fields, contentSha256: draft?.sha256 ?? null },
      detail: reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return { saved: true, institutionalHeader: institutional, fields: normalized.fields };
}

// ---------------------------------------------------------------------------
// Composición del contenido (vista previa y PDF controlado)
// ---------------------------------------------------------------------------

/** Cargo (Personas por cargo de Calidad) de cada persona, si está registrado. */
export async function cargoOf(db: Db, idCompany: number, emails: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set([...emails].map(lower).filter((e) => e.includes('@')))];
  if (!list.length) return new Map();
  const rows = await db.sgcCargoMember.findMany({ where: { id_company: idCompany, is_active: true, user_email: { in: list } }, select: { user_email: true, id_cargo: true } });
  if (!rows.length) return new Map();
  const cargos = await db.cargo.findMany({ where: { id_cargo: { in: [...new Set(rows.map((r) => r.id_cargo))] } }, select: { id_cargo: true, nombre_normalizado: true } });
  const byId = new Map(cargos.map((c) => [c.id_cargo, c.nombre_normalizado]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const name = byId.get(r.id_cargo);
    if (name && !out.has(lower(r.user_email))) out.set(lower(r.user_email), name);
  }
  return out;
}

/** «Nombre (Cargo)» para el encabezado. */
export function personLabel(name: string | null | undefined, email: string, cargo: string | undefined): string {
  const base = (name ?? '').trim() || email;
  return cargo ? `${base} (${cargo})` : base;
}

/** Filas del historial de cambios: versiones vigentes u obsoletas anteriores + la que se está aprobando. */
export async function changeHistoryRows(db: Db, idDocument: number | null, current: { versionNumber: number; date: string; reason: string }): Promise<SgcChangeHistoryRow[]> {
  const previous = idDocument
    ? await db.sgcDocumentVersion.findMany({ where: { id_document: idDocument, status: { in: ['vigente', 'obsoleto'] }, version_number: { lt: current.versionNumber } }, orderBy: { version_number: 'asc' }, select: { version_number: true, effective_date: true, change_description: true } })
    : [];
  const rows: SgcChangeHistoryRow[] = previous.map((v, i) => ({
    versionNumber: v.version_number,
    date: v.effective_date ? v.effective_date.toISOString().slice(0, 10) : '—',
    previousVersion: i > 0 ? previous[i - 1].version_number : null,
    reason: (v.change_description ?? '').trim() || (i === 0 ? 'Emisión inicial' : '—'),
  }));
  rows.push({ versionNumber: current.versionNumber, date: current.date, previousVersion: previous.at(-1)?.version_number ?? null, reason: current.reason.trim() || (previous.length ? '—' : 'Emisión inicial') });
  return rows;
}

export interface SgcComposeInput {
  idCompany: number;
  idDocument: number | null;
  draft: { format: string; bytes: Uint8Array | null; html: string | null };
  institutional: boolean;
  code: string;
  title: string;
  versionNumber: number;
  company: string;
  process: string;
  documentType: string;
  elaboro: string[];
  reviso: string[];
  aprobo: string[];
  changeDate: string;
  changeReason: string;
  emissionText: string;
}

/**
 * Convierte el borrador en el PDF del CONTENIDO: llena los campos de sistema
 * del cuerpo (y el historial de cambios) y, con plantilla institucional, deja
 * el espacio del encabezado. Devuelve el PDF y los datos del encabezado (que
 * se dibuja después, sobre el PDF final o la vista previa).
 */
export async function composeContent(db: Db, deps: Pick<SgcLayoutDeps, 'htmlToPdf' | 'docxToHtml'>, input: SgcComposeInput): Promise<{ contentPdf: Uint8Array; header: SgcInstitutionalHeaderData | null; sourceHtml: string | null }> {
  if (input.draft.format === 'pdf') {
    if (!input.draft.bytes || !isPdf(input.draft.bytes)) throw new SgcError('El borrador PDF no es un PDF válido.', 409);
    return { contentPdf: input.draft.bytes, header: null, sourceHtml: null };
  }
  let html: string;
  if (input.draft.format === 'docx') html = await deps.docxToHtml(input.draft.bytes!);
  else if (input.draft.format === 'html') html = sanitizeDraftHtml(input.draft.html ?? '');
  else throw new SgcError('El borrador debe ser PDF, Word (.docx) o editado en la app.', 409);
  const history = buildChangeHistoryHtml(await changeHistoryRows(db, input.idDocument, { versionNumber: input.versionNumber, date: input.changeDate, reason: input.changeReason }));
  const values: Partial<Record<SgcSystemToken, string>> = {
    CODIGO: input.code,
    VERSION: String(input.versionNumber),
    NOMBRE_DOCUMENTO: input.title,
    PROCESO: input.process,
    TIPO_DOCUMENTAL: input.documentType,
    EMPRESA: input.company,
    ELABORO: input.elaboro.join(', '),
    REVISO: input.reviso.join(', '),
    APROBO: input.aprobo.join(', '),
  };
  let body = applySystemFieldTokens(html, values, history);
  if (input.institutional && !hasChangeHistoryToken(html)) body += `<h2>HISTORIAL DE CAMBIOS</h2>${history}`;
  const contentPdf = await deps.htmlToPdf(wrapDraftForPdf({ title: input.title, code: input.code, contentHtml: body, institutional: input.institutional }));
  let header: SgcInstitutionalHeaderData | null = null;
  if (input.institutional) {
    const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: input.idCompany }, select: { logo_data_url: true } });
    header = {
      company: input.company,
      title: input.title,
      code: input.code,
      versionLabel: String(input.versionNumber),
      process: input.process,
      documentType: input.documentType,
      elaboro: input.elaboro,
      reviso: input.reviso,
      aprobo: input.aprobo,
      emissionText: input.emissionText,
      logo: decodeLogoDataUrl(config?.logo_data_url ?? null),
    };
  }
  return { contentPdf, header, sourceHtml: input.draft.format === 'html' ? html : null };
}

const previewCache = new Map<string, { bytes: Uint8Array; at: number }>();
const PREVIEW_TTL_MS = 10 * 60 * 1000;

/**
 * VISTA PREVIA del documento final SIN firmas (la que se usa para ubicarlas):
 * el contenido compuesto como quedará en el PDF controlado, con el encabezado
 * institucional si aplica. Código provisional en un documento nuevo.
 */
export async function buildLayoutPreview(db: SgcDb, deps: SgcLayoutDeps, idRequest: number, viewer: SgcViewer): Promise<Uint8Array> {
  const { row } = await assertCanView(db, idRequest, viewer);
  const request = await db.sgcRequest.findUniqueOrThrow({
    where: { id_request: idRequest },
    include: { documentType: true, processMap: { include: { processType: true } }, document: true, companyConfig: { include: { company: { select: { company: true } } } }, formValues: { include: { field: true } } },
  });
  const [participants, layout] = await Promise.all([layoutParticipants(db, row), latestLayout(db, idRequest)]);
  const { draft, bytes, html } = await loadVerifiedDraft(db, deps, idRequest);
  const institutional = layout.institutionalHeader && draft.format !== 'pdf';
  const people = participants.filter((p) => p.email.includes('@'));
  const cargos = await cargoOf(db, request.id_company, people.map((p) => p.email));
  const label = (m: SgcPlacedMeaning) => participants.filter((p) => p.meaning === m).map((p) => (p.email.includes('@') ? personLabel(p.name, p.email, cargos.get(p.email)) : p.name));
  const key = [idRequest, draft.sha256, institutional ? 1 : 0, sha256HexOf(JSON.stringify([label('elaboro'), label('reviso'), label('aprobo')]))].join(':');
  const hit = previewCache.get(key);
  if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.bytes;

  let code = request.document?.code ?? '';
  let versionNumber = 1;
  if (request.document) {
    const last = await db.sgcDocumentVersion.findFirst({ where: { id_document: request.document.id_document }, orderBy: { version_number: 'desc' }, select: { version_number: true } });
    versionNumber = (last?.version_number ?? 0) + 1;
  } else {
    const guide = await db.sgcCodingGuide.findUnique({ where: { id_company: request.id_company } });
    if (guide && request.processMap && request.documentType) {
      const g = { prefix: guide.prefix, pattern: guide.pattern, sequenceDigits: guide.sequence_digits };
      const parts = { processTypeCode: request.processMap.processType.code, processCode: request.processMap.code, documentTypeCode: request.documentType.code };
      const existing = await db.sgcDocument.findMany({ where: { id_company: request.id_company, code: { startsWith: buildCodeRoot(g, parts) } }, select: { code: true } });
      code = `${buildDocumentCode(g, parts, nextSequence(g, parts, existing.map((e) => e.code)))} (provisional)`;
    } else code = 'Se asigna al aprobar';
  }
  const changeValue = request.formValues.find((v) => v.field.field_key === 'resumen_cambios')?.value_text ?? null;
  const composed = await composeContent(db, deps, {
    idCompany: request.id_company,
    idDocument: request.document?.id_document ?? null,
    draft: { format: draft.format, bytes, html },
    institutional,
    code,
    title: request.document?.title ?? request.subject,
    versionNumber,
    company: request.companyConfig.company.company,
    process: request.processMap ? `${request.processMap.code} · ${request.processMap.name}` : '—',
    documentType: request.documentType ? request.documentType.name : '—',
    elaboro: label('elaboro'),
    reviso: label('reviso'),
    aprobo: label('aprobo'),
    changeDate: 'Al aprobar',
    changeReason: (changeValue || request.description).slice(0, 2000),
    emissionText: 'Al quedar vigente',
  });
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(composed.contentPdf, { ignoreEncryption: true });
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  if (composed.header) await drawInstitutionalHeaders(pdf, pdf.getPages(), composed.header, fonts);
  for (const page of pdf.getPages()) page.drawText('Vista previa del documento final (sin firmas) · SynerLink', { x: 20, y: 8, size: 7, font: fonts.regular, color: rgb(0.55, 0.1, 0.1) });
  const out = await pdf.save();
  if (previewCache.size > 30) previewCache.delete(previewCache.keys().next().value!);
  previewCache.set(key, { bytes: out, at: Date.now() });
  return out;
}
