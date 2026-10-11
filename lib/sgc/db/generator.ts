import type { Prisma } from '../../../app/generated/prisma';
import { sanitizeOneDriveName } from '../../onedriveName';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SGC_SUBPROCESS_URLS } from '../constants';
import type { SgcAccessSubject } from '../documentAccess';
import { sanitizeDraftHtml } from '../draft/html';
import { SgcError } from '../errors';
import {
  SGC_GENERATED_STATUS_LABELS,
  SGC_TEMPLATE_STATE_LABELS,
  SGC_TEMPLATE_VERSION_STATUS_LABELS,
  canApproveTemplate,
  canGenerate,
  canProposeTemplate,
  detectTemplateFields,
  fillTemplate,
  generatedCode,
  generatedFileName,
  generatorLegend,
  generatorSourceFormat,
  normalizeGeneratorReason,
  normalizeTemplateFields,
  parseGeneratorMode,
  parseTemplateFields,
  templateState,
  templateStateMessage,
  validateGeneratorValues,
  type SgcGeneratedStatus,
  type SgcGeneratorField,
  type SgcTemplateVersionStatus,
} from '../generator';
import { SGC_NOTIFICATION_TITLES, recipients, type SgcNotifier } from '../notifications';
import { applySystemFieldTokens, buildChangeHistoryHtml, decodeLogoDataUrl, drawInstitutionalHeaders, hasChangeHistoryToken, type SgcInstitutionalHeaderData } from '../pdf/institutional';
import { wrapDraftForPdf, type SgcDocxToHtml, type SgcHtmlToPdf } from '../pdf/render';
import type { SgcCompanyAccess } from '../permissions';
import { sha256Hex } from '../storage';
import { toWinAnsiSafe } from '../watermark';
import type { SgcActor, SgcDb } from './catalogs';
import { canViewDocument, type SgcUploader } from './documents';
import { cargoOf, changeHistoryRows, personLabel } from './layout';
import { withSgcAppLock } from './lock';

/**
 * GENERADOR DE DOCUMENTOS — capa de datos (reglas en lib/sgc/generator.ts).
 * Las rutas resuelven la persona con la sesión; aquí se valida todo en el
 * servidor: permisos por empresa, que el documento de origen siga vigente y
 * se pueda consultar, que solo Calidad apruebe (nunca lo propio), que solo se
 * llenen los campos permitidos y que el registro quede numerado e inmutable.
 */

type Tx = Prisma.TransactionClient;

export interface SgcGeneratorDeps {
  download: (itemId: string) => Promise<Uint8Array>;
  docxToHtml: SgcDocxToHtml;
  htmlToPdf: SgcHtmlToPdf;
  upload: SgcUploader;
}

const GENERATOR_URL = '/process/sgc-documental/generador';

function lower(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase();
}

/** ¿La empresa tiene encendido el generador? */
export async function isGeneratorEnabled(db: Pick<SgcDb, 'sgcCompanyConfig'>, idCompany: number): Promise<boolean> {
  const c = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { generator_enabled: true, is_active: true } });
  return Boolean(c?.is_active && c.generator_enabled);
}

async function assertEnabled(db: SgcDb, idCompany: number): Promise<void> {
  if (!(await isGeneratorEnabled(db, idCompany))) throw new SgcError('El generador de documentos no está habilitado para esta empresa.', 403);
}

/** Correos con permiso de Aseguramiento de Calidad en la empresa (para la campana). */
export async function qualityEmails(db: SgcDb, idCompany: number): Promise<string[]> {
  const rows = await db.subprocessUserCompany.findMany({
    where: { subprocess: { subprocess_url: SGC_SUBPROCESS_URLS.calidad }, companyUser: { id_company: idCompany, user: { isActive: true } } },
    select: { companyUser: { select: { user: { select: { email: true } } } } },
  });
  return recipients(rows.map((r) => r.companyUser.user.email));
}

async function nameOf(db: Pick<SgcDb, 'user'>, email: string): Promise<string> {
  const u = await db.user.findFirst({ where: { email: { equals: email } }, select: { name: true } });
  return (u?.name ?? '').trim() || email;
}

const documentSelect = {
  id_document: true,
  id_company: true,
  code: true,
  title: true,
  status: true,
  current_version_id: true,
  documentType: { select: { code: true, name: true } },
  process: { select: { code: true, name: true } },
  companyConfig: { select: { storage_root: true, company: { select: { company: true } } } },
} as const;

/** Documento de la empresa que la persona puede consultar (404 si no). */
async function loadVisibleDocument(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject, idDocument: number) {
  if (!Number.isInteger(idDocument) || idDocument < 1) throw new SgcError('Documento no encontrado.', 404);
  const doc = await db.sgcDocument.findFirst({ where: { id_document: idDocument, id_company: access.idCompany }, select: documentSelect });
  if (!doc || !(await canViewDocument(db, [access], subject, doc.id_document))) throw new SgcError('Documento no encontrado.', 404);
  return doc;
}

/** Contenido VIGENTE (Word convertido o HTML del editor), limpio. RN «borrador solo Word»: un vigente con solo PDF no sirve. */
async function vigenteContent(db: SgcDb, deps: Pick<SgcGeneratorDeps, 'download' | 'docxToHtml'>, doc: { status: string; current_version_id: number | null; code: string }) {
  if (doc.status !== 'vigente' || !doc.current_version_id) throw new SgcError('La plantilla solo parte de un documento VIGENTE.', 409);
  const version = await db.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: doc.current_version_id } });
  const format = version.source_item_id ? generatorSourceFormat(version.source_file_name) : null;
  if (!format) throw new SgcError(`${doc.code} V${version.version_number} solo tiene el PDF controlado: la plantilla debe partir de un Word o del editor de la app (RN «borrador solo Word»).`, 409);
  const bytes = await deps.download(version.source_item_id!);
  const html = sanitizeDraftHtml(format === 'docx' ? await deps.docxToHtml(bytes) : new TextDecoder().decode(bytes));
  return { version, format, html };
}

// ---------------------------------------------------------------------------
// Plantillas: proponer, decidir, retirar y consultar.
// ---------------------------------------------------------------------------

/**
 * Para «Nueva plantilla»: el contenido vigente del documento y los campos
 * editables que se detectaron en él (la persona revisa la lista antes de
 * proponer). No guarda nada.
 */
export async function getTemplateSource(db: SgcDb, deps: Pick<SgcGeneratorDeps, 'download' | 'docxToHtml'>, access: SgcCompanyAccess, subject: SgcAccessSubject, idDocument: number) {
  if (!canProposeTemplate(access)) throw new SgcError('Solo gestión documental o Aseguramiento de Calidad configuran plantillas.', 403);
  await assertEnabled(db, access.idCompany);
  const doc = await loadVisibleDocument(db, access, subject, idDocument);
  const { version, format, html } = await vigenteContent(db, deps, doc);
  const template = await db.sgcGeneratorTemplate.findUnique({ where: { id_company_id_document: { id_company: access.idCompany, id_document: doc.id_document } }, select: { id_template: true, name: true, status: true } });
  return {
    document: { idDocument: doc.id_document, code: doc.code, title: doc.title, versionNumber: version.version_number, idVersion: version.id_document_version, documentType: doc.documentType.name },
    sourceFormat: format,
    fields: detectTemplateFields(html),
    template: template ? { id: template.id_template, name: template.name, status: template.status } : null,
  };
}

/**
 * Propone una configuración de plantilla (versión nueva, «pendiente de
 * Calidad»): congela el contenido vigente con sus marcas y los campos
 * editables. Una sola pendiente a la vez por plantilla. Avisa a Calidad.
 */
export async function proposeTemplateVersion(db: SgcDb, deps: Pick<SgcGeneratorDeps, 'download' | 'docxToHtml'>, notifier: SgcNotifier, access: SgcCompanyAccess, subject: SgcAccessSubject, raw: unknown, actor: SgcActor, now: Date = new Date()) {
  if (!canProposeTemplate(access)) throw new SgcError('Solo gestión documental o Aseguramiento de Calidad configuran plantillas.', 403);
  await assertEnabled(db, access.idCompany);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reason = normalizeGeneratorReason(r.reason, 'para qué sirve la plantilla o qué cambió');
  const doc = await loadVisibleDocument(db, access, subject, Number(r.idDocument));
  const content = await vigenteContent(db, deps, doc);
  const fields = normalizeTemplateFields(detectTemplateFields(content.html), r.fields);
  const name = (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : doc.title).slice(0, 300);
  const description = typeof r.description === 'string' && r.description.trim() ? r.description.trim().slice(0, 1000) : null;
  const me = lower(actor.email);

  const created = await withSgcAppLock(db, `sgc-generador-doc-${doc.id_document}`, { waitMs: 5000, busyMessage: 'Otra persona está configurando esta plantilla: intente de nuevo en un momento.' }, async (tx) => {
    let template = await tx.sgcGeneratorTemplate.findUnique({ where: { id_company_id_document: { id_company: access.idCompany, id_document: doc.id_document } } });
    if (!template) {
      template = await tx.sgcGeneratorTemplate.create({ data: { id_company: access.idCompany, id_document: doc.id_document, name, description, created_by: me, created_at: now } });
    } else {
      if (await tx.sgcGeneratorTemplateVersion.count({ where: { id_template: template.id_template, status: 'pendiente' } })) {
        throw new SgcError('La plantilla ya tiene una configuración pendiente de Calidad: espere la decisión.', 409);
      }
      template = await tx.sgcGeneratorTemplate.update({ where: { id_template: template.id_template }, data: { name, description } });
    }
    const last = await tx.sgcGeneratorTemplateVersion.findFirst({ where: { id_template: template.id_template }, orderBy: { version_number: 'desc' }, select: { version_number: true } });
    const version = await tx.sgcGeneratorTemplateVersion.create({
      data: {
        id_template: template.id_template,
        version_number: (last?.version_number ?? 0) + 1,
        id_document_version: content.version.id_document_version,
        body_html: content.html,
        body_sha256: sha256Hex(new TextEncoder().encode(content.html)),
        fields_json: JSON.stringify(fields),
        change_reason: reason,
        proposed_by: me,
        proposed_at: now,
      },
    });
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.generadorPlantillaPropuesta,
      entity: 'generator_template_version',
      entityId: version.id_template_version,
      after: { idTemplate: template.id_template, versionNumber: version.version_number, source: `${doc.code} V${content.version.version_number}`, fields: fields.map((f) => `${f.key}:${f.type}`) },
      detail: `${doc.code}: ${reason}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { idTemplate: template.id_template, idTemplateVersion: version.id_template_version, versionNumber: version.version_number };
  });

  const to = (await qualityEmails(db, access.idCompany)).filter((e) => e !== me);
  await notifier([{ emails: to, payload: { title: SGC_NOTIFICATION_TITLES.plantillaPropuesta, body: `${me} propone la plantilla «${name}» v${created.versionNumber} (${doc.code}).`.slice(0, 300), url: `${GENERATOR_URL}?empresa=${access.idCompany}&tab=plantillas`, tag: `sgc-plantilla-${created.idTemplateVersion}` } }]).catch((e: unknown) => console.error('[sgc/generador]', e));
  return { ...created, fields, notified: to.length };
}

/** Aprueba o rechaza una configuración pendiente: SOLO Aseguramiento de Calidad, con motivo y nunca la propia. */
export async function decideTemplateVersion(db: SgcDb, notifier: SgcNotifier, access: SgcCompanyAccess, idTemplateVersion: number, raw: unknown, actor: SgcActor, now: Date = new Date()) {
  if (!canApproveTemplate(access)) throw new SgcError('Solo Aseguramiento de Calidad aprueba las plantillas del generador.', 403);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.decision !== 'aprobar' && r.decision !== 'rechazar') throw new SgcError('Decisión inválida: aprobar o rechazar.');
  const reason = normalizeGeneratorReason(r.reason, 'el motivo de la decisión');
  const me = lower(actor.email);
  const version = Number.isInteger(idTemplateVersion) ? await db.sgcGeneratorTemplateVersion.findFirst({ where: { id_template_version: idTemplateVersion, template: { id_company: access.idCompany } }, include: { template: { include: { document: { select: { code: true } } } } } }) : null;
  if (!version) throw new SgcError('Configuración de plantilla no encontrada.', 404);
  if (version.proposed_by === me) throw new SgcError('Nadie aprueba su propia plantilla: la decide otra persona de Aseguramiento de Calidad.', 403);
  if (version.status !== 'pendiente') throw new SgcError('La configuración ya fue decidida.', 409);
  const approve = r.decision === 'aprobar';
  await db.$transaction(async (tx) => {
    const done = await tx.sgcGeneratorTemplateVersion.updateMany({ where: { id_template_version: version.id_template_version, status: 'pendiente' }, data: { status: approve ? 'aprobada' : 'rechazada', decided_by: me, decided_at: now, decision_reason: reason } });
    if (done.count === 0) throw new SgcError('La configuración ya fue decidida.', 409);
    if (approve) {
      await tx.sgcGeneratorTemplateVersion.updateMany({ where: { id_template: version.id_template, status: 'aprobada', id_template_version: { not: version.id_template_version } }, data: { status: 'reemplazada' } });
      await tx.sgcGeneratorTemplate.update({ where: { id_template: version.id_template }, data: { current_version_id: version.id_template_version, status: 'activa' } });
    }
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.generadorPlantillaDecidida,
      entity: 'generator_template_version',
      entityId: version.id_template_version,
      before: { status: 'pendiente' },
      after: { status: approve ? 'aprobada' : 'rechazada', idTemplate: version.id_template, versionNumber: version.version_number },
      detail: `${version.template.document.code} (plantilla v${version.version_number}): ${reason}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  await notifier([{ emails: recipients([version.proposed_by], me), payload: { title: SGC_NOTIFICATION_TITLES.plantillaDecidida, body: `La plantilla «${version.template.name}» v${version.version_number} fue ${approve ? 'APROBADA' : 'RECHAZADA'} por Calidad: ${reason}`.slice(0, 300), url: `${GENERATOR_URL}?empresa=${access.idCompany}&tab=plantillas`, tag: `sgc-plantilla-${version.id_template_version}` } }]).catch((e: unknown) => console.error('[sgc/generador]', e));
  return { status: approve ? 'aprobada' : 'rechazada' };
}

/** Retira una plantilla (ya no se genera desde ella; los registros emitidos se conservan). Solo Calidad, con motivo. */
export async function retireTemplate(db: SgcDb, access: SgcCompanyAccess, idTemplate: number, raw: unknown, actor: SgcActor, now: Date = new Date()) {
  if (!canApproveTemplate(access)) throw new SgcError('Solo Aseguramiento de Calidad retira las plantillas del generador.', 403);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reason = normalizeGeneratorReason(r.reason, 'por qué se retira la plantilla');
  const me = lower(actor.email);
  const template = Number.isInteger(idTemplate) ? await db.sgcGeneratorTemplate.findFirst({ where: { id_template: idTemplate, id_company: access.idCompany }, include: { document: { select: { code: true } } } }) : null;
  if (!template) throw new SgcError('Plantilla no encontrada.', 404);
  await db.$transaction(async (tx) => {
    const done = await tx.sgcGeneratorTemplate.updateMany({ where: { id_template: template.id_template, status: 'activa' }, data: { status: 'retirada', retired_by: me, retired_at: now, retire_reason: reason } });
    if (done.count === 0) throw new SgcError('La plantilla ya estaba retirada.', 409);
    await writeSgcAudit(tx, { idCompany: access.idCompany, actorEmail: me, action: SGC_AUDIT_ACTIONS.generadorPlantillaRetirada, entity: 'generator_template', entityId: template.id_template, before: { status: 'activa' }, after: { status: 'retirada' }, detail: `${template.document.code}: ${reason}`.slice(0, 1000), ip: actor.ip, userAgent: actor.userAgent });
  });
  return { status: 'retirada' };
}

const templateInclude = {
  document: { select: { id_document: true, code: true, title: true, status: true, current_version_id: true, documentType: { select: { code: true, name: true } } } },
  versions: { orderBy: { version_number: 'desc' as const } },
  _count: { select: { generated: true } },
} as const;

type TemplateRow = Prisma.SgcGeneratorTemplateGetPayload<{ include: typeof templateInclude }>;

function toTemplateView(t: TemplateRow, docVersions: ReadonlyMap<number, number>) {
  const approved = t.versions.find((v) => v.id_template_version === t.current_version_id && v.status === 'aprobada') ?? null;
  const state = templateState({ templateStatus: t.status, approvedVersion: approved ? { idDocumentVersion: approved.id_document_version } : null, documentStatus: t.document.status, documentCurrentVersionId: t.document.current_version_id });
  return {
    id: t.id_template,
    name: t.name,
    description: t.description,
    status: t.status,
    state,
    stateLabel: SGC_TEMPLATE_STATE_LABELS[state],
    stateMessage: templateStateMessage(state),
    document: { idDocument: t.document.id_document, code: t.document.code, title: t.document.title, documentType: t.document.documentType.name, currentVersionNumber: t.document.current_version_id ? (docVersions.get(t.document.current_version_id) ?? null) : null },
    approvedVersion: approved ? { id: approved.id_template_version, versionNumber: approved.version_number, documentVersionNumber: docVersions.get(approved.id_document_version) ?? null, decidedBy: approved.decided_by, decidedAt: approved.decided_at?.toISOString() ?? null, fields: parseTemplateFields(approved.fields_json) } : null,
    versions: t.versions.map((v) => ({
      id: v.id_template_version,
      versionNumber: v.version_number,
      status: v.status as SgcTemplateVersionStatus,
      statusLabel: SGC_TEMPLATE_VERSION_STATUS_LABELS[v.status as SgcTemplateVersionStatus] ?? v.status,
      documentVersionNumber: docVersions.get(v.id_document_version) ?? null,
      fields: parseTemplateFields(v.fields_json),
      changeReason: v.change_reason,
      proposedBy: v.proposed_by,
      proposedAt: v.proposed_at.toISOString(),
      decidedBy: v.decided_by,
      decidedAt: v.decided_at?.toISOString() ?? null,
      decisionReason: v.decision_reason,
    })),
    generatedCount: t._count.generated,
    retiredBy: t.retired_by,
    retiredAt: t.retired_at?.toISOString() ?? null,
    retireReason: t.retire_reason,
  };
}

export type SgcTemplateView = ReturnType<typeof toTemplateView>;

async function templateViews(db: SgcDb, rows: TemplateRow[]): Promise<SgcTemplateView[]> {
  const ids = [...new Set(rows.flatMap((t) => [t.document.current_version_id, ...t.versions.map((v) => v.id_document_version)]).filter((v): v is number => typeof v === 'number'))];
  const versions = ids.length ? await db.sgcDocumentVersion.findMany({ where: { id_document_version: { in: ids } }, select: { id_document_version: true, version_number: true } }) : [];
  const byId = new Map(versions.map((v) => [v.id_document_version, v.version_number]));
  return rows.map((t) => toTemplateView(t, byId));
}

async function visibleTemplates(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject) {
  const rows = await db.sgcGeneratorTemplate.findMany({ where: { id_company: access.idCompany }, include: templateInclude, orderBy: { name: 'asc' } });
  const out: TemplateRow[] = [];
  for (const t of rows) if (await canViewDocument(db, [access], subject, t.id_document)) out.push(t);
  return out;
}

/** Plantillas de la empresa para gestión documental y Calidad (todas las versiones y su estado). */
export async function listTemplatesForManagement(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject) {
  if (!canProposeTemplate(access)) throw new SgcError('Solo gestión documental o Aseguramiento de Calidad ven la configuración de las plantillas.', 403);
  return { canApprove: canApproveTemplate(access), templates: await templateViews(db, await visibleTemplates(db, access, subject)) };
}

/** Plantillas desde las que la persona puede generar HOY (aprobadas, al día y con el origen consultable). */
export async function listAvailableTemplates(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject) {
  if (!canGenerate(access)) throw new SgcError('Sin acceso al SGC de la empresa.', 403);
  const views = await templateViews(db, await visibleTemplates(db, access, subject));
  return views
    .filter((t) => t.state === 'disponible')
    .map((t) => ({ id: t.id, name: t.name, description: t.description, document: t.document, approvedVersion: t.approvedVersion }));
}

/** Una plantilla disponible con sus campos, para el formulario de generación. */
export async function getTemplateForGeneration(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject, idTemplate: number) {
  if (!canGenerate(access)) throw new SgcError('Sin acceso al SGC de la empresa.', 403);
  await assertEnabled(db, access.idCompany);
  const t = Number.isInteger(idTemplate) ? await db.sgcGeneratorTemplate.findFirst({ where: { id_template: idTemplate, id_company: access.idCompany }, include: templateInclude }) : null;
  if (!t || !(await canViewDocument(db, [access], subject, t.id_document))) throw new SgcError('Plantilla no encontrada.', 404);
  const [view] = await templateViews(db, [t]);
  return { id: view.id, name: view.name, description: view.description, state: view.state, stateLabel: view.stateLabel, stateMessage: view.stateMessage, document: view.document, approvedVersion: view.approvedVersion };
}

// ---------------------------------------------------------------------------
// Generación: vista previa (efímera) y emisión del REGISTRO.
// ---------------------------------------------------------------------------

interface ManifestLite {
  institutionalHeader?: boolean;
  signatures?: { meaning: string; signerName: string | null; signerEmail: string }[];
}

function parseManifest(raw: string | null): ManifestLite {
  try {
    return raw ? (JSON.parse(raw) as ManifestLite) : {};
  } catch {
    return {};
  }
}

async function loadForGeneration(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject, idTemplate: number) {
  if (!canGenerate(access)) throw new SgcError('Sin acceso al SGC de la empresa.', 403);
  await assertEnabled(db, access.idCompany);
  const t = Number.isInteger(idTemplate) ? await db.sgcGeneratorTemplate.findFirst({ where: { id_template: idTemplate, id_company: access.idCompany } }) : null;
  if (!t || !(await canViewDocument(db, [access], subject, t.id_document))) throw new SgcError('Plantilla no encontrada.', 404);
  const doc = await db.sgcDocument.findUniqueOrThrow({ where: { id_document: t.id_document }, select: documentSelect });
  const approved = t.current_version_id ? await db.sgcGeneratorTemplateVersion.findFirst({ where: { id_template_version: t.current_version_id, id_template: t.id_template, status: 'aprobada' } }) : null;
  const state = templateState({ templateStatus: t.status, approvedVersion: approved ? { idDocumentVersion: approved.id_document_version } : null, documentStatus: doc.status, documentCurrentVersionId: doc.current_version_id });
  if (state !== 'disponible' || !approved) throw new SgcError(templateStateMessage(state), 409);
  const docVersion = await db.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: approved.id_document_version } });
  return { template: t, doc, approved, docVersion, fields: parseTemplateFields(approved.fields_json) };
}

type Loaded = Awaited<ReturnType<typeof loadForGeneration>>;

/**
 * PDF del registro: el contenido aprobado con los valores, el encabezado
 * institucional del documento de origen (si su versión lo usa) y la leyenda
 * de trazabilidad en cada página. Los campos de sistema ({{CODIGO}}…) son los
 * del documento de origen; el historial de cambios del origen solo aparece si
 * la plantilla trae su marca (un registro no lleva historial propio).
 */
async function renderRecordPdf(db: SgcDb, deps: Pick<SgcGeneratorDeps, 'htmlToPdf'>, l: Loaded, values: Record<string, string>, legend: string): Promise<Uint8Array> {
  const manifest = parseManifest(l.docVersion.manifest_json);
  const institutional = manifest.institutionalHeader === true;
  const sigs = manifest.signatures ?? [];
  const cargos = await cargoOf(db, l.doc.id_company, sigs.map((s) => s.signerEmail));
  const namesFor = (meaning: string) => [...new Set(sigs.filter((s) => s.meaning === meaning).map((s) => personLabel(s.signerName, s.signerEmail, cargos.get(lower(s.signerEmail)))))];
  const effective = l.docVersion.effective_date ? l.docVersion.effective_date.toISOString().slice(0, 10) : '—';
  const company = l.doc.companyConfig.company.company;
  const process = `${l.doc.process.code} · ${l.doc.process.name}`;
  const elaboro = namesFor('elaboro');
  const reviso = namesFor('reviso');
  const aprobo = namesFor('aprobo');

  let body = fillTemplate(l.approved.body_html, l.fields, values);
  const history = hasChangeHistoryToken(body) ? buildChangeHistoryHtml(await changeHistoryRows(db, l.doc.id_document, { versionNumber: l.docVersion.version_number, date: effective, reason: l.docVersion.change_description ?? '' })) : null;
  body = applySystemFieldTokens(body, { CODIGO: l.doc.code, VERSION: String(l.docVersion.version_number), NOMBRE_DOCUMENTO: l.doc.title, PROCESO: process, TIPO_DOCUMENTAL: l.doc.documentType.name, EMPRESA: company, ELABORO: elaboro.join(', '), REVISO: reviso.join(', '), APROBO: aprobo.join(', ') }, history);
  const contentPdf = await deps.htmlToPdf(wrapDraftForPdf({ title: l.doc.title, code: l.doc.code, contentHtml: body, institutional }));

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(contentPdf, { ignoreEncryption: true });
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  if (institutional) {
    const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: l.doc.id_company }, select: { logo_data_url: true } });
    const header: SgcInstitutionalHeaderData = { company, title: l.doc.title, code: l.doc.code, versionLabel: String(l.docVersion.version_number), process, documentType: l.doc.documentType.name, elaboro, reviso, aprobo, emissionText: effective, logo: decodeLogoDataUrl(config?.logo_data_url ?? null) };
    await drawInstitutionalHeaders(pdf, pdf.getPages(), header, fonts);
  } else {
    // Sin encabezado institucional (vigente de la carga inicial): la misma línea superior del PDF controlado.
    const top = toWinAnsiSafe(`${l.doc.code} · Versión ${l.docVersion.version_number} · ${l.doc.title} · ${company}`);
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      let size = 7.5;
      while (size > 5 && fonts.regular.widthOfTextAtSize(top, size) > width - 40) size -= 0.5;
      page.drawText(top, { x: 20, y: height - 14, size, font: fonts.regular, color: rgb(0.42, 0.45, 0.5) });
    }
  }
  const safeLegend = toWinAnsiSafe(legend);
  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    let size = 7;
    while (size > 4.5 && fonts.regular.widthOfTextAtSize(safeLegend, size) > width - 40) size -= 0.5;
    // y = 20: por encima del pie que el visor estampa en cada consulta (y = 8, «COPIA CONTROLADA · …»).
    page.drawText(safeLegend, { x: 20, y: 20, size, font: fonts.regular, color: rgb(0.1, 0.2, 0.45) });
  }
  pdf.setTitle(`${l.doc.code} - documento generado`);
  pdf.setProducer('SynerLink · SGC · Generador de documentos');
  return pdf.save();
}

/**
 * Genera desde una plantilla APROBADA y al día:
 *   - `vista`: PDF efímero marcado «VISTA PREVIA», no se guarda ni se numera;
 *   - `emitir`: el REGISTRO con su consecutivo (bajo bloqueo por plantilla),
 *     el PDF en la carpeta propia de la empresa con su SHA-256 y la auditoría.
 * Solo se aceptan valores de los campos permitidos.
 */
export async function generateFromTemplate(db: SgcDb, deps: Pick<SgcGeneratorDeps, 'htmlToPdf' | 'upload'>, access: SgcCompanyAccess, subject: SgcAccessSubject, idTemplate: number, raw: unknown, actor: SgcActor, now: Date = new Date()) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = parseGeneratorMode(r.modo ?? 'vista');
  if (!mode) throw new SgcError('Modo inválido: vista o emitir.');
  const loaded = await loadForGeneration(db, access, subject, idTemplate);
  const values = validateGeneratorValues(loaded.fields, r.values);
  const me = lower(actor.email);
  const [user, approver] = await Promise.all([nameOf(db, me), nameOf(db, loaded.approved.decided_by!)]);
  const legendFor = (recordCode: string | null) => generatorLegend({ recordCode, documentCode: loaded.doc.code, documentVersion: loaded.docVersion.version_number, templateVersion: loaded.approved.version_number, approvedBy: approver, approvedAt: loaded.approved.decided_at!, user, at: now });

  if (mode === 'vista') {
    const bytes = await renderRecordPdf(db, deps, loaded, values, legendFor(null));
    await writeSgcAudit(db, { idCompany: access.idCompany, actorEmail: me, action: SGC_AUDIT_ACTIONS.generadorVistaPrevia, entity: 'generator_template_version', entityId: loaded.approved.id_template_version, detail: `Vista previa desde ${loaded.doc.code} (plantilla v${loaded.approved.version_number}).`, ip: actor.ip, userAgent: actor.userAgent });
    return { mode, bytes, record: null };
  }

  const record = await withSgcAppLock(db, `sgc-generador-${loaded.template.id_template}`, { waitMs: 10_000, busyMessage: 'Se está emitiendo otro documento de esta plantilla: intente de nuevo en un momento.' }, async (tx: Tx) => {
    const fresh = await tx.sgcGeneratorTemplate.findUniqueOrThrow({ where: { id_template: loaded.template.id_template } });
    if (fresh.status !== 'activa' || fresh.current_version_id !== loaded.approved.id_template_version) throw new SgcError('La plantilla cambió mientras se generaba: recargue e intente de nuevo.', 409);
    const sequence = fresh.last_sequence + 1;
    const code = generatedCode(loaded.doc.code, sequence);
    const bytes = await renderRecordPdf(db, deps, loaded, values, legendFor(code));
    const root = loaded.doc.companyConfig.storage_root.split('/').map((s) => sanitizeOneDriveName(s)).filter(Boolean);
    if (root.length === 0) throw new SgcError('La empresa no tiene carpeta raíz del SGC (storage_root).', 409);
    const segments = [...root, 'GENERADOS', sanitizeOneDriveName(loaded.doc.code)];
    const fileName = generatedFileName(code);
    const uploaded = await deps.upload(segments, fileName, bytes, 'application/pdf');
    const bumped = await tx.sgcGeneratorTemplate.updateMany({ where: { id_template: fresh.id_template, last_sequence: fresh.last_sequence }, data: { last_sequence: sequence } });
    if (bumped.count === 0) throw new SgcError('Se emitió otro documento al mismo tiempo: intente de nuevo.', 409);
    const row = await tx.sgcGeneratedDocument.create({
      data: {
        id_company: access.idCompany,
        id_template: fresh.id_template,
        id_template_version: loaded.approved.id_template_version,
        id_document: loaded.doc.id_document,
        id_document_version: loaded.docVersion.id_document_version,
        sequence_number: sequence,
        code,
        values_json: JSON.stringify(values),
        pdf_item_id: uploaded.id,
        pdf_path: `${segments.join('/')}/${fileName}`,
        pdf_sha256: sha256Hex(bytes),
        pdf_size: bytes.length,
        generated_by: me,
        generated_at: now,
        ip: actor.ip ?? null,
      },
    });
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.generadorDocumento,
      entity: 'generated_document',
      entityId: row.id_generated,
      after: { code, template: fresh.id_template, templateVersion: loaded.approved.version_number, source: `${loaded.doc.code} V${loaded.docVersion.version_number}`, sha256: row.pdf_sha256 },
      detail: `Registro ${code} generado desde ${loaded.doc.code} V${loaded.docVersion.version_number} (plantilla v${loaded.approved.version_number}).`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { id: row.id_generated, code, sha256: row.pdf_sha256 };
  });
  return { mode, bytes: null, record };
}

// ---------------------------------------------------------------------------
// Registros generados: consulta (visor) y anulación.
// ---------------------------------------------------------------------------

const generatedInclude = {
  template: { select: { name: true } },
  templateVersion: { select: { version_number: true } },
  document: { select: { code: true, title: true } },
} as const;

type GeneratedRow = Prisma.SgcGeneratedDocumentGetPayload<{ include: typeof generatedInclude }>;

function toGeneratedView(g: GeneratedRow, docVersions: ReadonlyMap<number, number>) {
  return {
    id: g.id_generated,
    code: g.code,
    templateName: g.template.name,
    templateVersion: g.templateVersion.version_number,
    document: { code: g.document.code, title: g.document.title, versionNumber: docVersions.get(g.id_document_version) ?? null },
    status: g.status as SgcGeneratedStatus,
    statusLabel: SGC_GENERATED_STATUS_LABELS[g.status as SgcGeneratedStatus] ?? g.status,
    generatedBy: g.generated_by,
    generatedAt: g.generated_at.toISOString(),
    annulledBy: g.annulled_by,
    annulledAt: g.annulled_at?.toISOString() ?? null,
    annulReason: g.annul_reason,
    pdfSha256: g.pdf_sha256,
  };
}

export type SgcGeneratedView = ReturnType<typeof toGeneratedView>;

async function generatedViews(db: SgcDb, rows: GeneratedRow[]): Promise<SgcGeneratedView[]> {
  const ids = [...new Set(rows.map((r) => r.id_document_version))];
  const versions = ids.length ? await db.sgcDocumentVersion.findMany({ where: { id_document_version: { in: ids } }, select: { id_document_version: true, version_number: true } }) : [];
  const byId = new Map(versions.map((v) => [v.id_document_version, v.version_number]));
  return rows.map((g) => toGeneratedView(g, byId));
}

/** Registros que generó la persona. */
export async function listMyGenerated(db: SgcDb, idCompany: number, email: string) {
  return generatedViews(db, await db.sgcGeneratedDocument.findMany({ where: { id_company: idCompany, generated_by: lower(email) }, include: generatedInclude, orderBy: { id_generated: 'desc' }, take: 500 }));
}

/** Registro de TODO lo generado en la empresa (solo Aseguramiento de Calidad). */
export async function listGeneratedForQuality(db: SgcDb, access: SgcCompanyAccess) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad ve el registro de documentos generados de la empresa.', 403);
  return generatedViews(db, await db.sgcGeneratedDocument.findMany({ where: { id_company: access.idCompany }, include: generatedInclude, orderBy: { id_generated: 'desc' }, take: 1000 }));
}

/** El registro para el VISOR: lo ven quien lo generó y Aseguramiento de Calidad de la empresa (404 para los demás). */
export async function getGeneratedForViewer(db: SgcDb, accessByCompany: readonly SgcCompanyAccess[], email: string, idGenerated: number) {
  const g = Number.isInteger(idGenerated) ? await db.sgcGeneratedDocument.findUnique({ where: { id_generated: idGenerated } }) : null;
  const access = g ? accessByCompany.find((a) => a.idCompany === g.id_company) : undefined;
  if (!g || !access || !(g.generated_by === lower(email) || access.canQuality)) return null;
  return { idCompany: g.id_company, code: g.code, status: g.status, pdfItemId: g.pdf_item_id, pdfSha256: g.pdf_sha256, idGenerated: g.id_generated };
}

/** Anula un registro (queda con su número, marcado «ANULADO»). Quien lo generó o Calidad, con motivo. */
export async function annulGenerated(db: SgcDb, access: SgcCompanyAccess, idGenerated: number, raw: unknown, actor: SgcActor, now: Date = new Date()) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const reason = normalizeGeneratorReason(r.reason, 'por qué se anula el documento');
  const me = lower(actor.email);
  const g = Number.isInteger(idGenerated) ? await db.sgcGeneratedDocument.findFirst({ where: { id_generated: idGenerated, id_company: access.idCompany } }) : null;
  if (!g || !(g.generated_by === me || access.canQuality)) throw new SgcError('Documento generado no encontrado.', 404);
  await db.$transaction(async (tx) => {
    const done = await tx.sgcGeneratedDocument.updateMany({ where: { id_generated: g.id_generated, status: 'emitido' }, data: { status: 'anulado', annulled_by: me, annulled_at: now, annul_reason: reason } });
    if (done.count === 0) throw new SgcError('El documento ya estaba anulado.', 409);
    await writeSgcAudit(tx, { idCompany: access.idCompany, actorEmail: me, action: SGC_AUDIT_ACTIONS.generadorDocumentoAnulado, entity: 'generated_document', entityId: g.id_generated, before: { status: 'emitido' }, after: { status: 'anulado' }, detail: `${g.code}: ${reason}`.slice(0, 1000), ip: actor.ip, userAgent: actor.userAgent });
  });
  return { status: 'anulado' };
}

export type { SgcGeneratorField };
