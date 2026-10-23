import type { Prisma } from '../../../app/generated/prisma';
import { PDFDocument as PDFDocumentLib } from 'pdf-lib';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
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
  registerOnlyParticipants,
  SGC_A4_LANDSCAPE,
  SGC_A4_PORTRAIT,
  suggestInstitutionalPlacements,
  type SgcChangeHistoryRow,
  type SgcInstitutionalHeaderData,
  type SgcSystemToken,
} from '../pdf/institutional';
import { wrapDraftForPdf, type SgcDocxToHtml, type SgcHtmlToPdf } from '../pdf/render';
import { inspectXlsx, xlsxToSheet, type SgcSheetInspection, type SgcSheetLayout } from '../pdf/viewable';
import { fitPdfIntoInstitutionalPages, microsoftCanApply, pdfIsA4, pdfPageCount, prepareXlsxForMicrosoft, xlsxPrintsLandscape } from '../pdf/officePdf';
import { describeSheetSettings, isDefaultSheetSettings, normalizeSheetSettings, type SgcSheetSettings } from '../sheetSettings';
import {
  missingPlacements,
  normalizeSgcFields,
  parseStoredFields,
  sgcSignerKey,
  type SgcPlacedMeaning,
  type SgcPlacementParticipant,
  type SgcStoredField,
} from '../signature/fields';
import { isQualityVerificationPool } from '../signature/qualityVerification';
import { sha256HexOf } from '../signature/record';
import { isPdf } from '../storage';
import { toWinAnsiSafe } from '../watermark';
import type { SgcActor, SgcDb } from './catalogs';
import { resolveNewDocumentCode } from './coding';
import { isHeaderMandatory } from './companySettings';
import { loadDefinition } from './flows';
import { headerTemplateForType } from './headerTemplates';
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
  /** 2026-10-22: conversión de Microsoft para el borrador en Excel (sube una copia temporal, la convierte y la borra; sin ella, la de SynerLink). */
  officeToPdf?: (storageRoot: string, fileName: string, content: Uint8Array) => Promise<Uint8Array>;
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
 * el elaborador, los revisores y los aprobadores. S14 (R20): el grupo de
 * verificación de Calidad de la aprobación ya NO (es una lista de chequeo).
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
    // S14 (R20): la verificación de Calidad del paso «Aprobó» es una lista de chequeo: no lleva caja en el documento.
    if (t.poolAuthorizationTypeCode && !isQualityVerificationPool(meaning, t.poolAuthorizationTypeCode)) {
      out.push({ key: sgcSignerKey(t.key, null, t.poolAuthorizationTypeCode), meaning, name: 'Aseguramiento de Calidad (grupo)', email: t.poolAuthorizationTypeCode, role });
    }
  }
  return out;
}

export interface SgcLayoutState {
  institutionalHeader: boolean;
  fields: SgcStoredField[];
  /** 2026-10-22: ajustes de presentación del borrador en Excel (null = automático). */
  sheetSettings: SgcSheetSettings | null;
  contentSha256: string | null;
  savedBy: string | null;
  savedAt: string | null;
  saves: number;
}

/**
 * 2026-10-22: fields_json guarda la lista de cajas (como siempre) o, si el
 * borrador en Excel tiene ajustes de presentación, { fields, sheetSettings }.
 * Así no hace falta otra columna y las filas anteriores se leen igual.
 */
export function parseLayoutJson(raw: string | null | undefined): { fields: SgcStoredField[]; sheetSettings: SgcSheetSettings | null } {
  const text = (raw ?? '').trim();
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text) as { fields?: unknown; sheetSettings?: unknown };
      let sheetSettings: SgcSheetSettings | null = null;
      try {
        sheetSettings = o.sheetSettings ? normalizeSheetSettings(o.sheetSettings) : null;
      } catch {
        sheetSettings = null; // Unos ajustes ilegibles no impiden el documento: se usa el automático.
      }
      return { fields: parseStoredFields(JSON.stringify(Array.isArray(o.fields) ? o.fields : [])), sheetSettings: sheetSettings && !isDefaultSheetSettings(sheetSettings) ? sheetSettings : null };
    } catch {
      return { fields: [], sheetSettings: null };
    }
  }
  return { fields: parseStoredFields(raw ?? null), sheetSettings: null };
}

export function layoutJson(fields: readonly SgcStoredField[], sheetSettings: SgcSheetSettings | null): string {
  return sheetSettings && !isDefaultSheetSettings(sheetSettings) ? JSON.stringify({ fields, sheetSettings }) : JSON.stringify(fields);
}

/** ¿El documento compuesto sale en A4 horizontal? Solo un borrador en Excel cuyo elaborador la eligió (con encabezado institucional). */
export function layoutIsLandscape(draftFormat: string | null | undefined, sheetSettings: SgcSheetSettings | null): boolean {
  return draftFormat === 'xlsx' && sheetSettings?.orientation === 'horizontal';
}

/**
 * 2026-10-22: orientación REAL del documento con un borrador en Excel. Con
 * ajustes propios, la que eligió el elaborador (conversión de SynerLink); sin
 * ellos, la que el Excel tiene configurada para imprimir (la que usa la
 * conversión de Microsoft). Es la misma regla para componer el PDF y para
 * sugerir dónde van las firmas.
 */
export async function draftIsLandscape(draftFormat: string | null | undefined, sheetSettings: SgcSheetSettings | null, bytes: Uint8Array | null): Promise<boolean> {
  if (draftFormat !== 'xlsx') return false;
  if (sheetSettings && sheetSettings.orientation !== 'auto') return sheetSettings.orientation === 'horizontal';
  return bytes ? xlsxPrintsLandscape(bytes) : false;
}

/** Última composición guardada (o la de por defecto: sin encabezado institucional y sin cajas). */
export async function latestLayout(db: Db, idRequest: number): Promise<SgcLayoutState> {
  const [last, saves] = await Promise.all([
    db.sgcDocumentLayout.findFirst({ where: { id_request: idRequest }, orderBy: { id_document_layout: 'desc' } }),
    db.sgcDocumentLayout.count({ where: { id_request: idRequest } }),
  ]);
  if (!last) return { institutionalHeader: false, fields: [], sheetSettings: null, contentSha256: null, savedBy: null, savedAt: null, saves: 0 };
  const parsed = parseLayoutJson(last.fields_json);
  return {
    institutionalHeader: last.institutional_header,
    fields: parsed.fields,
    sheetSettings: parsed.sheetSettings,
    contentSha256: last.content_sha256?.trim() ?? null,
    savedBy: last.saved_by,
    savedAt: last.saved_at.toISOString(),
    saves,
  };
}

/** Encabezado que se aplica: el guardado, o siempre si es obligatorio; nunca sobre un borrador PDF. */
export function effectiveInstitutional(saved: boolean, mandatory: boolean, draftFormat: string | null | undefined): boolean {
  return (saved || mandatory) && draftFormat !== 'pdf';
}

function inElaboration(row: { status: string; tasks: { status: string; taskDef: { assignment: string } }[] }): boolean {
  return row.status === 'abierta' && row.tasks.some((t) => t.status === 'abierta' && t.taskDef.assignment === 'elaborador');
}

/** Composición del documento para la vista (participantes, cajas, sugerencias y si la persona puede editarla). */
/** Bytes del borrador en Excel (verificados) para decidir su orientación; null si no es Excel o no hay cómo bajarlo. */
async function excelBytesFor(db: Db, deps: Pick<SgcLayoutDeps, 'download'> | undefined, idRequest: number, draftFormat: string | null | undefined): Promise<Uint8Array | null> {
  if (draftFormat !== 'xlsx' || !deps) return null;
  return (await loadVerifiedDraft(db, deps, idRequest).catch(() => null))?.bytes ?? null;
}

export async function getDocumentLayout(db: SgcDb, idRequest: number, viewer: SgcViewer, deps?: Pick<SgcLayoutDeps, 'download'>) {
  const { row } = await assertCanView(db, idRequest, viewer);
  const [participants, layout, draft, headerMandatory] = await Promise.all([layoutParticipants(db, row), latestLayout(db, idRequest), currentDraftInTx(db as never, idRequest), isHeaderMandatory(db, row.id_company)]);
  const keys = new Set(participants.map((p) => p.key));
  const fields = layout.fields.filter((f) => keys.has(f.signerKey));
  const canEdit = inElaboration(row) && lower(row.elaborator_email) === lower(viewer.email);
  // Sprint 8: con el encabezado obligatorio, el documento siempre lo usa (salvo un borrador PDF anterior a la regla).
  const institutionalHeader = headerMandatory ? draft?.format !== 'pdf' : layout.institutionalHeader;
  // D6 (E2E 2026-10-10): quien va solo al registro de firmas no cuenta como «sin ubicar».
  const inRegister = new Set(registerOnlyParticipants(participants, fields).map((p) => p.key));
  // 2026-10-19: con una plantilla con grilla, las firmas sugeridas caen en sus celdas «Firma».
  const grid = institutionalHeader ? (await headerTemplateForType(db, row.id_company, row.id_document_type ?? null)).config.grid : null;
  return {
    idRequest,
    institutionalHeader,
    headerMandatory,
    fields,
    participants,
    missing: missingPlacements(participants, fields).filter((p) => !inRegister.has(p.key)).map((p) => p.key),
    inRegister: [...inRegister],
    suggested: institutionalHeader
      ? suggestInstitutionalPlacements(participants, fields, grid, (await draftIsLandscape(draft?.format, layout.sheetSettings, await excelBytesFor(db, deps, idRequest, draft?.format))) ? SGC_A4_LANDSCAPE : SGC_A4_PORTRAIT)
      : [],
    // 2026-10-22: ajustes de presentación del borrador en Excel (orientación, tamaño, área, títulos, columnas y hojas).
    sheetSettings: draft?.format === 'xlsx' ? layout.sheetSettings : null,
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
export async function saveDocumentLayout(
  db: SgcDb,
  idRequest: number,
  input: { institutionalHeader?: unknown; fields?: unknown; reason?: unknown; pageCount?: unknown; sheetSettings?: unknown },
  viewer: SgcViewer,
  actor: SgcActor,
  deps?: Pick<SgcLayoutDeps, 'download'>
) {
  const { row } = await assertCanView(db, idRequest, viewer);
  if (lower(row.elaborator_email) !== lower(actor.email)) throw new SgcError('Solo el elaborador ubica las firmas en el documento.', 403);
  if (!inElaboration(row)) throw new SgcError('Las firmas se ubican durante la elaboración (antes de enviar el documento a revisión).', 409);
  const [participants, current, draft, headerMandatory] = await Promise.all([layoutParticipants(db, row), latestLayout(db, idRequest), currentDraftInTx(db as never, idRequest), isHeaderMandatory(db, row.id_company)]);
  // Sprint 8: con el encabezado obligatorio no se ofrece apagarlo (el servidor lo rechaza).
  if (headerMandatory && input.institutionalHeader === false) {
    throw new SgcError('El encabezado institucional es obligatorio en los documentos nuevos y en las nuevas versiones: no se puede quitar.', 409);
  }
  const institutional = headerMandatory ? draft?.format !== 'pdf' : typeof input.institutionalHeader === 'boolean' ? input.institutionalHeader : current.institutionalHeader;
  if (institutional && draft?.format === 'pdf') {
    throw new SgcError('El encabezado institucional se aplica a documentos editados en la app o en Word: un PDF ya trae su propio formato. Ubique las firmas sobre el PDF.', 409);
  }
  // 2026-10-22: ajustes del borrador en Excel (undefined = se conservan; null = automático). Solo presentación.
  let sheetSettings = current.sheetSettings;
  if (input.sheetSettings !== undefined) {
    if (input.sheetSettings !== null && draft?.format !== 'xlsx') throw new SgcError('Los ajustes de presentación solo aplican a un borrador en Excel (.xlsx).', 409);
    const n = input.sheetSettings === null ? null : normalizeSheetSettings(input.sheetSettings);
    sheetSettings = n && !isDefaultSheetSettings(n) ? n : null;
  }
  // Si cambia la orientación de la hoja, las cajas ubicadas ya no caen en su sitio: se quitan y se vuelven a ubicar.
  const excelBytes = input.sheetSettings !== undefined ? await excelBytesFor(db, deps, idRequest, draft?.format) : null;
  const orientationChanged = input.sheetSettings !== undefined && (await draftIsLandscape(draft?.format, sheetSettings, excelBytes)) !== (await draftIsLandscape(draft?.format, current.sheetSettings, excelBytes));
  const pages = Number(input.pageCount);
  const pageCount = Number.isInteger(pages) && pages > 0 && pages <= 500 ? pages : null;
  const normalized =
    input.fields === undefined
      ? { fields: orientationChanged ? [] : current.fields.filter((f) => participants.some((p) => p.key === f.signerKey)), error: null }
      : normalizeSgcFields(input.fields, participants, pageCount);
  if (normalized.error) throw new SgcError(normalized.error);
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) || null : null;
  const fieldsJson = layoutJson(normalized.fields, sheetSettings);
  const sameSheet = JSON.stringify(sheetSettings) === JSON.stringify(current.sheetSettings);
  const removedByOrientation = orientationChanged && input.fields === undefined ? current.fields.length : 0;
  // Sin cambios (misma composición, sin contar el identificador de cada caja): no se guarda otra fila.
  const comparable = (list: readonly SgcStoredField[]) => JSON.stringify(list.map((f) => ({ ...f, id: undefined })));
  if (current.saves > 0 && sameSheet && institutional === current.institutionalHeader && comparable(normalized.fields) === comparable(current.fields) && (draft?.sha256 ?? null) === current.contentSha256) {
    return { saved: false, institutionalHeader: institutional, fields: normalized.fields, sheetSettings, removedSignatures: 0 };
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const saved = await tx.sgcDocumentLayout.create({
      data: { id_request: idRequest, institutional_header: institutional, fields_json: fieldsJson, content_sha256: draft?.sha256 ?? null, saved_by: lower(actor.email), saved_at: now, change_reason: reason },
    });
    const placed = normalized.fields.length;
    const register = registerOnlyParticipants(participants, normalized.fields).length;
    const missing = missingPlacements(participants, normalized.fields).length - register;
    const sheetNote = sameSheet ? '' : `\nPresentación del Excel: ${sheetSettings ? describeSheetSettings(sheetSettings) : 'ajuste automático'}.${removedByOrientation ? ` Cambió la orientación de la hoja: se quitaron ${removedByOrientation} firma(s) ubicada(s) para volver a ubicarlas.` : ''}`;
    const summary = sameSheet || input.fields !== undefined ? `Ubicó las firmas en el documento: ${placed} de ${participants.length - register} firma(s) ubicada(s)${missing ? ` (faltan ${missing})` : ''}${register ? `; ${register} van solo al registro de firmas` : ''}.` : 'Ajustó la presentación del Excel en el documento.';
    await addInteraction(tx, idRequest, 'estado', lower(actor.email), `${summary}${institutional !== current.institutionalHeader ? `\nEncabezado institucional: ${institutional ? 'sí' : 'no'}.` : ''}${sheetNote}${reason ? `\nMotivo: ${reason}` : ''}`, {
      meta: { idDocumentLayout: saved.id_document_layout, institutional, placed, missing, ...(sameSheet ? {} : { sheetSettings, removedSignatures: removedByOrientation }) },
    });
    await writeSgcAudit(tx, {
      idCompany: row.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.firmasUbicadas,
      entity: 'document_layout',
      entityId: saved.id_document_layout,
      before: current.saves ? { institutional: current.institutionalHeader, fields: current.fields, ...(current.sheetSettings ? { sheetSettings: current.sheetSettings } : {}) } : null,
      after: { institutional, fields: normalized.fields, contentSha256: draft?.sha256 ?? null, ...(sheetSettings ? { sheetSettings } : {}) },
      detail: reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return { saved: true, institutionalHeader: institutional, fields: normalized.fields, sheetSettings, removedSignatures: removedByOrientation };
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
  /** S16 (R31): tipo documental (su plantilla de encabezado; sin él, la por defecto de la empresa). */
  idDocumentType?: number | null;
  draft: { format: string; bytes: Uint8Array | null; html: string | null; itemId?: string | null };
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
  /** 2026-10-22: ajustes de presentación de un borrador en Excel (null = automático). */
  sheetSettings?: SgcSheetSettings | null;
}

/**
 * Convierte el borrador en el PDF del CONTENIDO: llena los campos de sistema
 * del cuerpo (y el historial de cambios) y, con plantilla institucional, deja
 * el espacio del encabezado. Devuelve el PDF y los datos del encabezado (que
 * se dibuja después, sobre el PDF final o la vista previa).
 */
export async function composeContent(
  db: Db,
  deps: Pick<SgcLayoutDeps, 'htmlToPdf' | 'docxToHtml' | 'officeToPdf'>,
  input: SgcComposeInput
): Promise<{ contentPdf: Uint8Array; header: SgcInstitutionalHeaderData | null; sourceHtml: string | null; headerTemplate: { id: number; code: string; version: number } | null; converter?: 'microsoft' | 'synerlink' }> {
  if (input.draft.format === 'pdf') {
    if (!input.draft.bytes || !isPdf(input.draft.bytes)) throw new SgcError('El borrador PDF no es un PDF válido.', 409);
    return { contentPdf: input.draft.bytes, header: null, sourceHtml: null, headerTemplate: null };
  }
  const history = buildChangeHistoryHtml(await changeHistoryRows(db, input.idDocument, { versionNumber: input.versionNumber, date: input.changeDate, reason: input.changeReason }));
  const custom = input.sheetSettings ?? null;
  const landscape = input.institutional ? await draftIsLandscape(input.draft.format, custom, input.draft.bytes) : false;
  // 2026-10-22: el borrador en Excel sin ajustes propios lo convierte MICROSOFT (fiel a Excel); si falla, la de SynerLink.
  let html: string;
  let sheetCss: string | undefined;
  let sheetLayout: SgcSheetLayout | undefined;
  let contentPdf: Uint8Array;
  if (input.draft.format === 'xlsx' && input.draft.bytes && microsoftCanApply(custom) && deps.officeToPdf) {
    try {
      const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: input.idCompany }, select: { storage_root: true } });
      if (!config?.storage_root) throw new Error('La empresa no tiene carpeta del SGC.');
      // Copia con «ajustar al ancho» (o la orientación y el tamaño elegidos): solo cambia la configuración de página.
      const raw = await deps.officeToPdf(config.storage_root, `${input.code || 'borrador'}.xlsx`, await prepareXlsxForMicrosoft(input.draft.bytes, custom, { institutional: input.institutional }));
      if ((await pdfPageCount(raw)) === 0) throw new Error('Microsoft devolvió un PDF sin páginas.');
      if (input.institutional) {
        // El historial de cambios va en su propia página.
        // Si Microsoft respetó la hoja A4 con el espacio del encabezado, se usa tal cual; si no, cada página a escala.
        const fitted = await PDFDocumentLib.load((await pdfIsA4(raw, landscape)) ? raw : await fitPdfIntoInstitutionalPages(raw, landscape));
        const historyPdf = await PDFDocumentLib.load(
          await deps.htmlToPdf(wrapDraftForPdf({ title: input.title, code: input.code, contentHtml: `<h2>HISTORIAL DE CAMBIOS</h2>${history}`, institutional: true, sheet: true, sheetLayout: { landscape, tables: [], orientation: landscape ? 'horizontal' : 'vertical' } }))
        );
        for (const page of await fitted.copyPages(historyPdf, historyPdf.getPageIndices())) fitted.addPage(page);
        contentPdf = await fitted.save();
      } else contentPdf = raw;
      return { contentPdf, ...(await headerFor(db, input)), sourceHtml: null, converter: 'microsoft' };
    } catch (e) {
      console.warn('[sgc/composicion] la conversión de Microsoft falló; se usa la de SynerLink', e);
    }
  }
  if (input.draft.format === 'docx') html = await deps.docxToHtml(input.draft.bytes!);
  else if (input.draft.format === 'html') html = sanitizeDraftHtml(input.draft.html ?? '');
  // S16 (R32, D17): un FORMATO en Excel se compone desde sus hojas (tablas), sin pasar por Word.
  // Respaldo de SynerLink: con encabezado, la misma orientación que el Excel (así las firmas sugeridas coinciden).
  else if (input.draft.format === 'xlsx')
    ({ html, css: sheetCss, layout: sheetLayout } = await xlsxToSheet(input.draft.bytes!, input.institutional ? { ...(custom ?? normalizeSheetSettings({})), orientation: landscape ? 'horizontal' : 'vertical' } : (custom ?? undefined)));
  else throw new SgcError('El borrador debe ser PDF, Word (.docx), Excel (.xlsx) o editado en la app.', 409);
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
  contentPdf = await deps.htmlToPdf(wrapDraftForPdf({ title: input.title, code: input.code, contentHtml: body, institutional: input.institutional, sheet: input.draft.format === 'xlsx', extraCss: sheetCss, sheetLayout }));
  return { contentPdf, ...(await headerFor(db, input)), sourceHtml: input.draft.format === 'html' ? html : null, converter: 'synerlink' };
}

/** Datos del encabezado institucional (plantilla del tipo documental y logo), o null sin encabezado. */
async function headerFor(db: Db, input: SgcComposeInput): Promise<{ header: SgcInstitutionalHeaderData | null; headerTemplate: { id: number; code: string; version: number } | null }> {
  let header: SgcInstitutionalHeaderData | null = null;
  let headerTemplate: { id: number; code: string; version: number } | null = null;
  if (input.institutional) {
    const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: input.idCompany }, select: { logo_data_url: true } });
    // S16 (R31): rótulos y fila inferior de la plantilla del tipo documental.
    const tpl = await headerTemplateForType(db, input.idCompany, input.idDocumentType ?? null);
    headerTemplate = tpl.ref;
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
      template: tpl.config,
    };
  }
  return { header, headerTemplate };
}

const previewCache = new Map<string, { bytes: Uint8Array; at: number }>();
const PREVIEW_TTL_MS = 10 * 60 * 1000;

/**
 * VISTA PREVIA del documento final SIN firmas (la que se usa para ubicarlas):
 * el contenido compuesto como quedará en el PDF controlado, con el encabezado
 * institucional si aplica. Código provisional en un documento nuevo.
 */
export async function buildLayoutPreview(
  db: SgcDb,
  deps: SgcLayoutDeps,
  idRequest: number,
  viewer: SgcViewer,
  // 2026-10-22: `sheetSettings` = ajustes del Excel AÚN SIN GUARDAR (vista previa de «Ajustar y previsualizar»); sin él, los guardados.
  options: { runningHeader?: boolean; sheetSettings?: SgcSheetSettings | null } = {}
): Promise<Uint8Array> {
  // 2026-10-05 («Ver documento» sin descarga): sin encabezado institucional, la
  // misma línea superior del PDF controlado (código · versión · título).
  const runningHeader = options.runningHeader === true;
  const { row } = await assertCanView(db, idRequest, viewer);
  const request = await db.sgcRequest.findUniqueOrThrow({
    where: { id_request: idRequest },
    include: { documentType: true, processMap: { include: { processType: true } }, document: true, companyConfig: { include: { company: { select: { company: true } } } }, formValues: { include: { field: true } } },
  });
  const [participants, layout] = await Promise.all([layoutParticipants(db, row), latestLayout(db, idRequest)]);
  const { draft, bytes, html } = await loadVerifiedDraft(db, deps, idRequest);
  const institutional = effectiveInstitutional(layout.institutionalHeader, await isHeaderMandatory(db, request.id_company), draft.format);
  const people = participants.filter((p) => p.email.includes('@'));
  const cargos = await cargoOf(db, request.id_company, people.map((p) => p.email));
  const label = (m: SgcPlacedMeaning) => participants.filter((p) => p.meaning === m).map((p) => (p.email.includes('@') ? personLabel(p.name, p.email, cargos.get(p.email)) : p.name));
  const tplRef = institutional ? (await headerTemplateForType(db, request.id_company, request.id_document_type)).ref : null;
  const sheetSettings = draft.format === 'xlsx' ? (options.sheetSettings !== undefined ? options.sheetSettings : layout.sheetSettings) : null;
  const key = [
    idRequest,
    draft.sha256,
    institutional ? 1 : 0,
    runningHeader ? 1 : 0,
    tplRef ? `${tplRef.id}.${tplRef.version}` : 'def',
    sha256HexOf(JSON.stringify([label('elaboro'), label('reviso'), label('aprobo')])),
    sheetSettings ? sha256HexOf(JSON.stringify(sheetSettings)).slice(0, 16) : 'auto',
  ].join(':');
  const hit = previewCache.get(key);
  if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.bytes;

  let code = request.document?.code ?? '';
  let versionNumber = 1;
  if (request.document) {
    const last = await db.sgcDocumentVersion.findFirst({ where: { id_document: request.document.id_document }, orderBy: { version_number: 'desc' }, select: { version_number: true } });
    versionNumber = (last?.version_number ?? 0) + 1;
  } else {
    code = 'Se asigna al aprobar';
    if (request.processMap && request.documentType) {
      // Sprint 8: misma regla que la aprobación (guía de la empresa y herencia del número del padre).
      const resolved = await resolveNewDocumentCode(db, {
        idCompany: request.id_company,
        processTypeCode: request.processMap.processType.code,
        processCode: request.processMap.code,
        documentTypeCode: request.documentType.code,
        idParentDocument: request.id_parent_document,
      }).catch(() => null);
      if (resolved) code = `${resolved.code} (provisional)`;
    }
  }
  const changeValue = request.formValues.find((v) => v.field.field_key === 'resumen_cambios')?.value_text ?? null;
  const composed = await composeContent(db, deps, {
    idCompany: request.id_company,
    idDocument: request.document?.id_document ?? null,
    idDocumentType: request.id_document_type,
    draft: { format: draft.format, bytes, html, itemId: draft.itemId ?? null },
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
    sheetSettings,
  });
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(composed.contentPdf, { ignoreEncryption: true });
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  if (composed.header) await drawInstitutionalHeaders(pdf, pdf.getPages(), composed.header, fonts);
  else if (runningHeader) {
    const top = toWinAnsiSafe(`${code} · Versión ${versionNumber} · ${request.document?.title ?? request.subject}`);
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      let size = 7.5;
      while (size > 5 && fonts.regular.widthOfTextAtSize(top, size) > width - 40) size -= 0.5;
      page.drawText(top, { x: 20, y: height - 14, size, font: fonts.regular, color: rgb(0.42, 0.45, 0.5) });
    }
  }
  for (const page of pdf.getPages()) page.drawText('Vista previa del documento final (sin firmas) · SynerLink', { x: 20, y: 8, size: 7, font: fonts.regular, color: rgb(0.55, 0.1, 0.1) });
  const out = await pdf.save();
  if (previewCache.size > 30) previewCache.delete(previewCache.keys().next().value!);
  previewCache.set(key, { bytes: out, at: Date.now() });
  return out;
}

// ---------------------------------------------------------------------------
// 2026-10-22: «Ajustar y previsualizar» un borrador en Excel (documentos nuevos
// y nuevas versiones). Solo la presentación; el texto del Excel no cambia.
// ---------------------------------------------------------------------------

/**
 * Hojas del borrador en Excel verificado (huella) de la solicitud, para quien
 * la puede ver. La carga del borrador ya rechaza un Excel ilegible; esto solo
 * protege si algo cambiara después.
 */
async function draftSheetsOf(db: SgcDb, deps: Pick<SgcLayoutDeps, 'download'>, idRequest: number, viewer: SgcViewer): Promise<SgcSheetInspection[]> {
  await assertCanView(db, idRequest, viewer);
  const { draft, bytes } = await loadVerifiedDraft(db, deps, idRequest);
  if (draft.format !== 'xlsx' || !bytes) throw new SgcError('Los ajustes de presentación aplican a un borrador en Excel (.xlsx).', 409);
  return inspectXlsx(bytes).catch(() => {
    throw new SgcError('No se pudo leer el Excel del borrador: revise que se abra sin contraseña.', 422);
  });
}

/** Hojas del borrador en Excel (rango, columnas y primeras filas) y los ajustes guardados. */
export async function inspectDraftSheets(db: SgcDb, deps: Pick<SgcLayoutDeps, 'download'>, idRequest: number, viewer: SgcViewer): Promise<{ sheets: SgcSheetInspection[]; sheetSettings: SgcSheetSettings | null }> {
  return { sheets: await draftSheetsOf(db, deps, idRequest, viewer), sheetSettings: (await latestLayout(db, idRequest)).sheetSettings };
}

/** Valida los ajustes contra las hojas reales del borrador (que existan y que salga al menos una). */
export async function validateDraftSheetSettings(db: SgcDb, deps: Pick<SgcLayoutDeps, 'download'>, idRequest: number, viewer: SgcViewer, input: unknown): Promise<SgcSheetSettings | null> {
  const names = (await draftSheetsOf(db, deps, idRequest, viewer)).map((x) => x.name);
  const settings = input === null ? null : normalizeSheetSettings(input);
  if (!settings) return null;
  const missing = settings.sheets.map((x) => x.name).filter((n) => !names.includes(n));
  if (missing.length) throw new SgcError(`Los ajustes mencionan hojas que no están en el Excel: ${missing.join(', ')}.`);
  const out = new Set(settings.sheets.filter((x) => !x.include).map((x) => x.name));
  if (names.length && names.every((n) => out.has(n))) throw new SgcError('Deje al menos una hoja en el PDF.');
  return isDefaultSheetSettings(settings) ? null : settings;
}
