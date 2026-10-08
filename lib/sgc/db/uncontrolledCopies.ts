import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import type { SgcAccessSubject } from '../documentAccess';
import { SgcError } from '../errors';
import { SGC_NOTIFICATION_TITLES, type SgcNotifier } from '../notifications';
import type { SgcCompanyAccess } from '../permissions';
import {
  SGC_AUTH_TYPE_UNCONTROLLED_COPY,
  SGC_COPY_DESTINATION_LABELS,
  SGC_COPY_STATUS_LABELS,
  copyActions,
  copyAllowedForType,
  copyConfigOf,
  copyExpiry,
  effectiveCopyStatus,
  normalizeCopyRequest,
  type SgcCopyConfig,
  type SgcCopyDestination,
} from '../uncontrolledCopies';
import { formatBogotaDateTime } from '../watermark';
import type { SgcActor, SgcDb } from './catalogs';
import { getPoolMembers, getPoolTypeCodes } from './authorizations';
import { canViewDocument } from './documents';

/**
 * COPIAS NO CONTROLADAS (Sprint 11). Ver lib/sgc/uncontrolledCopies.ts.
 * Las rutas resuelven la persona con la sesión; aquí se valida todo.
 */

function lower(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase();
}

const COPIES_URL = '/process/sgc-documental/copias';

export async function getCopyConfig(db: SgcDb, idCompany: number): Promise<SgcCopyConfig> {
  return copyConfigOf(await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { uncontrolled_copy_types: true, uncontrolled_copy_days: true, uncontrolled_copy_max_days: true } }));
}

/** ¿La persona decide copias no controladas en la empresa? (grupo exclusivo SGC-COPIA-NC). */
export async function isCopyDecider(db: SgcDb, idCompany: number, email: string): Promise<boolean> {
  return (await getPoolTypeCodes(db, idCompany, email)).includes(SGC_AUTH_TYPE_UNCONTROLLED_COPY);
}

/** Pide una copia no controlada de un documento vigente que la persona puede consultar. */
export async function requestUncontrolledCopy(db: SgcDb, notifier: SgcNotifier, access: SgcCompanyAccess, subject: SgcAccessSubject, raw: unknown, actor: SgcActor) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cfg = await getCopyConfig(db, access.idCompany);
  const input = normalizeCopyRequest(r, cfg);
  const idDocument = Number(r.idDocument);
  const doc = Number.isInteger(idDocument) ? await db.sgcDocument.findFirst({ where: { id_document: idDocument, id_company: access.idCompany }, include: { documentType: true } }) : null;
  if (!doc || !(await canViewDocument(db, [access], subject, doc.id_document))) throw new SgcError('Documento no encontrado.', 404);
  if (doc.status !== 'vigente' || !doc.current_version_id) throw new SgcError('Solo se pide copia no controlada de un documento VIGENTE.', 409);
  if (!copyAllowedForType(cfg, doc.documentType.code)) {
    throw new SgcError(`Los ${doc.documentType.plural_name.toLowerCase()} no admiten copia no controlada (solo ${cfg.types.join(', ')}). Consulte a Calidad.`, 409);
  }
  const me = lower(actor.email);
  const now = new Date();
  const open = await db.sgcUncontrolledCopyRequest.findMany({ where: { id_document: doc.id_document, requester_email: me, status: { in: ['pendiente', 'autorizada'] } } });
  if (open.some((c) => c.status === 'pendiente' || effectiveCopyStatus(c.status, c.expires_at, now) === 'autorizada')) {
    throw new SgcError(`Ya tiene una copia no controlada de ${doc.code} pendiente o vigente.`, 409);
  }
  const created = await db.$transaction(async (tx) => {
    const row = await tx.sgcUncontrolledCopyRequest.create({
      data: {
        id_company: access.idCompany,
        id_document: doc.id_document,
        id_document_version: doc.current_version_id!,
        requester_email: me,
        justification: input.justification,
        destination: input.destination,
        destination_detail: input.destinationDetail,
        days_requested: input.days,
        created_at: now,
        ip: actor.ip ?? null,
      },
    });
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.copiaNoControladaSolicitada,
      entity: 'uncontrolled_copy',
      entityId: row.id_copy_request,
      after: { idDocument: doc.id_document, code: doc.code, destination: input.destination, days: input.days },
      detail: `${doc.code}: ${input.justification}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return row;
  });
  const deciders = (await getPoolMembers(db, access.idCompany, SGC_AUTH_TYPE_UNCONTROLLED_COPY)).filter((e) => e !== me);
  await notifier([{ emails: deciders, payload: { title: SGC_NOTIFICATION_TITLES.copiaNoControlada, body: `${me} pide una copia no controlada de ${doc.code} (${SGC_COPY_DESTINATION_LABELS[input.destination]}).`.slice(0, 300), url: `${COPIES_URL}?empresa=${access.idCompany}`, tag: `sgc-copia-${created.id_copy_request}` } }]).catch((e: unknown) => console.error('[sgc/copias]', e));
  return { idCopyRequest: created.id_copy_request, notified: deciders.length };
}

type CopyRow = Awaited<ReturnType<typeof loadCopies>>[number];

async function loadCopies(db: SgcDb, where: Record<string, unknown>) {
  return db.sgcUncontrolledCopyRequest.findMany({
    where,
    include: { document: { select: { code: true, title: true, documentType: { select: { code: true } } } }, events: { orderBy: { id_copy_event: 'asc' } } },
    orderBy: { id_copy_request: 'desc' },
    take: 500,
  });
}

function toView(c: CopyRow, now: Date) {
  return {
    id: c.id_copy_request,
    idDocument: c.id_document,
    code: c.document.code,
    title: c.document.title,
    documentTypeCode: c.document.documentType.code,
    idVersion: c.id_document_version,
    versionNumber: null as number | null,
    requester: c.requester_email,
    justification: c.justification,
    destination: c.destination as SgcCopyDestination,
    destinationLabel: SGC_COPY_DESTINATION_LABELS[c.destination as SgcCopyDestination] ?? c.destination,
    destinationDetail: c.destination_detail,
    days: c.days_requested,
    status: effectiveCopyStatus(c.status, c.expires_at, now),
    statusLabel: SGC_COPY_STATUS_LABELS[effectiveCopyStatus(c.status, c.expires_at, now)],
    decidedBy: c.decided_by,
    decidedAt: c.decided_at?.toISOString() ?? null,
    decisionReason: c.decision_reason,
    expiresAt: c.expires_at?.toISOString() ?? null,
    allowDownload: c.allow_download,
    createdAt: c.created_at.toISOString(),
    ...copyActions({ status: c.status, expiresAt: c.expires_at, allowDownload: c.allow_download }, now),
    events: c.events.map((e) => ({ event: e.event, by: e.actor_email, at: e.occurred_at.toISOString() })),
  };
}

export type SgcCopyView = ReturnType<typeof toView>;

async function withVersions(db: SgcDb, rows: SgcCopyView[]): Promise<SgcCopyView[]> {
  const ids = [...new Set(rows.map((r) => r.idVersion))];
  if (!ids.length) return rows;
  const versions = await db.sgcDocumentVersion.findMany({ where: { id_document_version: { in: ids } }, select: { id_document_version: true, version_number: true } });
  const by = new Map(versions.map((v) => [v.id_document_version, v.version_number]));
  return rows.map((r) => ({ ...r, versionNumber: by.get(r.idVersion) ?? null }));
}

/** Copias de la persona (listado maestro y «Mis copias»). */
export async function listMyCopies(db: SgcDb, idCompany: number, email: string, now: Date = new Date()) {
  return withVersions(db, (await loadCopies(db, { id_company: idCompany, requester_email: lower(email) })).map((c) => toView(c, now)));
}

/**
 * Solicitudes para el grupo que decide (pendientes) y el HISTORIAL / REPORTE
 * (todas): solo el grupo SGC-COPIA-NC; Calidad ve el reporte.
 */
export async function listCopiesForQuality(db: SgcDb, access: SgcCompanyAccess, email: string, opts: { status?: string | null } = {}, now: Date = new Date()) {
  const decider = await isCopyDecider(db, access.idCompany, email);
  if (!decider && !access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad ve las copias no controladas de la empresa.', 403);
  const where: Record<string, unknown> = { id_company: access.idCompany };
  if (opts.status === 'pendiente') where.status = 'pendiente';
  const rows = await withVersions(db, (await loadCopies(db, where)).map((c) => toView(c, now)));
  return { canDecide: decider, copies: rows };
}

/** Pendientes por decidir de la persona (para «Mis pendientes»). */
export async function countCopiesToDecide(db: SgcDb, idCompany: number, email: string): Promise<number> {
  if (!(await isCopyDecider(db, idCompany, email))) return 0;
  return db.sgcUncontrolledCopyRequest.count({ where: { id_company: idCompany, status: 'pendiente', requester_email: { not: lower(email) } } });
}

/** Autoriza o rechaza (SOLO el grupo exclusivo, con motivo; nadie decide su propia solicitud). */
export async function decideUncontrolledCopy(db: SgcDb, notifier: SgcNotifier, access: SgcCompanyAccess, idCopy: number, raw: unknown, actor: SgcActor, now: Date = new Date()) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const me = lower(actor.email);
  if (!(await isCopyDecider(db, access.idCompany, me))) throw new SgcError('Solo el grupo de Calidad que autoriza copias no controladas decide esta solicitud.', 403);
  if (r.decision !== 'autorizar' && r.decision !== 'rechazar') throw new SgcError('Decisión inválida: autorizar o rechazar.');
  const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
  if (reason.length < 10) throw new SgcError('Explique el motivo de la decisión (mínimo 10 caracteres): queda en el historial.');
  const copy = Number.isInteger(idCopy) ? await db.sgcUncontrolledCopyRequest.findFirst({ where: { id_copy_request: idCopy, id_company: access.idCompany }, include: { document: { select: { code: true } } } }) : null;
  if (!copy) throw new SgcError('Solicitud de copia no encontrada.', 404);
  if (copy.requester_email === me) throw new SgcError('Nadie decide su propia solicitud de copia: la decide otra persona del grupo.', 403);
  if (copy.status !== 'pendiente') throw new SgcError('La solicitud ya fue decidida o cancelada.', 409);
  const cfg = await getCopyConfig(db, access.idCompany);
  const days = r.days === undefined || r.days === null || r.days === '' ? copy.days_requested : Number(r.days);
  if (!Number.isInteger(days) || days < 1 || days > cfg.maxDays) throw new SgcError(`Los días de vigencia deben estar entre 1 y ${cfg.maxDays}.`);
  const authorize = r.decision === 'autorizar';
  const expiresAt = authorize ? copyExpiry(now, days) : null;
  const data = {
    status: authorize ? 'autorizada' : 'rechazada',
    decided_by: me,
    decided_at: now,
    decision_reason: reason.slice(0, 1000),
    expires_at: expiresAt,
    // Decisión D5: el PDF marcado se puede bajar solo si la copia se entrega a un tercero.
    allow_download: authorize && copy.destination === 'tercero',
  };
  await db.$transaction(async (tx) => {
    // Solo si sigue pendiente (dos personas del grupo no deciden la misma solicitud).
    const done = await tx.sgcUncontrolledCopyRequest.updateMany({ where: { id_copy_request: copy.id_copy_request, status: 'pendiente' }, data });
    if (done.count === 0) throw new SgcError('La solicitud ya fue decidida o cancelada.', 409);
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.copiaNoControladaDecidida,
      entity: 'uncontrolled_copy',
      entityId: copy.id_copy_request,
      before: { status: 'pendiente' },
      after: { status: data.status, expiresAt, allowDownload: data.allow_download },
      detail: `${copy.document.code}: ${reason}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  await notifier([{ emails: [copy.requester_email], payload: { title: SGC_NOTIFICATION_TITLES.copiaNoControladaDecidida, body: `Su copia no controlada de ${copy.document.code} fue ${expiresAt ? `AUTORIZADA hasta el ${formatBogotaDateTime(expiresAt).slice(0, 10)}` : 'RECHAZADA'}: ${reason}`.slice(0, 300), url: `${COPIES_URL}?empresa=${access.idCompany}`, tag: `sgc-copia-${copy.id_copy_request}` } }]).catch((e: unknown) => console.error('[sgc/copias]', e));
  return { status: data.status, expiresAt: expiresAt?.toISOString() ?? null };
}

/** El solicitante cancela su solicitud mientras está pendiente. */
export async function cancelUncontrolledCopy(db: SgcDb, access: SgcCompanyAccess, idCopy: number, actor: SgcActor) {
  const me = lower(actor.email);
  const copy = Number.isInteger(idCopy) ? await db.sgcUncontrolledCopyRequest.findFirst({ where: { id_copy_request: idCopy, id_company: access.idCompany, requester_email: me } }) : null;
  if (!copy) throw new SgcError('Solicitud de copia no encontrada.', 404);
  const done = await db.sgcUncontrolledCopyRequest.updateMany({ where: { id_copy_request: copy.id_copy_request, status: 'pendiente' }, data: { status: 'cancelada', decided_by: me, decided_at: new Date(), decision_reason: 'Cancelada por quien la pidió.' } });
  if (done.count === 0) throw new SgcError('Solo se cancela una solicitud pendiente.', 409);
  await writeSgcAudit(db, { idCompany: access.idCompany, actorEmail: me, action: SGC_AUDIT_ACTIONS.copiaNoControladaDecidida, entity: 'uncontrolled_copy', entityId: copy.id_copy_request, before: { status: 'pendiente' }, after: { status: 'cancelada' }, detail: 'Cancelada por quien la pidió.', ip: actor.ip, userAgent: actor.userAgent });
  return { status: 'cancelada' };
}

/**
 * Prepara la IMPRESIÓN (o la DESCARGA, solo si es para un tercero) de una
 * copia autorizada y vigente de la persona, y registra el evento (solo
 * inserción). La versión debe seguir VIGENTE: si el documento cambió de
 * versión, se pide una copia nueva.
 */
export async function consumeUncontrolledCopy(db: SgcDb, idCopy: number, mode: 'impresion' | 'descarga', actor: SgcActor, now: Date = new Date()) {
  const me = lower(actor.email);
  const copy = Number.isInteger(idCopy) ? await db.sgcUncontrolledCopyRequest.findFirst({ where: { id_copy_request: idCopy, requester_email: me }, include: { document: { select: { code: true, current_version_id: true, status: true } } } }) : null;
  if (!copy) throw new SgcError('Copia no encontrada.', 404);
  const actions = copyActions({ status: copy.status, expiresAt: copy.expires_at, allowDownload: copy.allow_download }, now);
  if (!actions.canPrint) {
    throw new SgcError(effectiveCopyStatus(copy.status, copy.expires_at, now) === 'vencida' ? 'La copia no controlada venció: pida una nueva.' : 'La copia no está autorizada.', 403);
  }
  if (mode === 'descarga' && !actions.canDownload) throw new SgcError('Esta copia solo se imprime: la descarga es para copias que se entregan a un tercero.', 403);
  if (copy.document.status !== 'vigente' || copy.document.current_version_id !== copy.id_document_version) {
    throw new SgcError('El documento cambió de versión después de autorizar la copia: pida una copia nueva de la versión vigente.', 409);
  }
  const version = await db.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: copy.id_document_version } });
  await db.$transaction(async (tx) => {
    await tx.sgcUncontrolledCopyEvent.create({ data: { id_copy_request: copy.id_copy_request, event: mode, actor_email: me, occurred_at: now, ip: actor.ip ?? null, user_agent: actor.userAgent?.slice(0, 400) ?? null } });
    await writeSgcAudit(tx, {
      idCompany: copy.id_company,
      actorEmail: me,
      action: mode === 'descarga' ? SGC_AUDIT_ACTIONS.documentoDescarga : SGC_AUDIT_ACTIONS.documentoImpresion,
      entity: 'uncontrolled_copy',
      entityId: copy.id_copy_request,
      detail: `${copy.document.code} V${version.version_number}: copia NO controlada (${mode}).`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return {
    code: copy.document.code,
    versionNumber: version.version_number,
    pdfItemId: version.pdf_item_id,
    pdfSha256: version.pdf_sha256,
    requesterEmail: copy.requester_email,
    authorizedBy: copy.decided_by!,
    authorizedAt: copy.decided_at!,
    expiresAt: copy.expires_at!,
    destination: copy.destination === 'tercero' ? copy.destination_detail : null,
  };
}
