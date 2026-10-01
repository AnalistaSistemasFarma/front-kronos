import { SGC_SUBPROCESS_URLS } from '../constants';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { normalizeDocumentCode } from '../coding';
import type { SgcAccessSubject } from '../documentAccess';
import { SgcError, isUniqueViolation } from '../errors';
import type { SgcNotifier } from '../notifications';
import type { SgcCompanyAccess } from '../permissions';
import type { SgcActor, SgcDb } from './catalogs';
import { canViewDocument } from './documents';

/**
 * SOLICITUD DE ACCESO a un documento de otra área (Sprint 5).
 *
 * Quien tiene consulta del SGC pide acceso con justificación: eligiendo un
 * documento «por departamento» de otra área (se listan código, título y área,
 * que no son confidenciales) o escribiendo el CÓDIGO exacto de cualquiera. Si
 * el código no existe, es confidencial o ya lo puede consultar, a quien pide
 * se le responde lo mismo («solicitud registrada»): nunca se revela si un
 * documento confidencial existe. Aseguramiento de Calidad decide: al aprobar
 * se crea el acceso de CONSULTA (sgc.document_access, con vencimiento
 * opcional) y al rechazar queda el motivo. Nada se borra; todo se audita.
 */

export const SGC_ACCESS_REQUEST_STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

const ACCESS_URL = '/process/sgc-documental/accesos';

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function text(value: unknown, label: string, min: number, max: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new SgcError(`${label} es obligatorio (mínimo ${min} caracteres).`);
  return s.slice(0, max);
}

async function qualityEmails(db: SgcDb, idCompany: number): Promise<string[]> {
  const rows = await db.subprocessUserCompany.findMany({
    where: { subprocess: { subprocess_url: SGC_SUBPROCESS_URLS.calidad }, companyUser: { company: { id_company: idCompany }, user: { isActive: true } } },
    select: { companyUser: { select: { user: { select: { email: true } } } } },
  });
  return [...new Set(rows.map((r) => lower(r.companyUser.user.email)))];
}

/** Documentos «por departamento» vigentes de OTRAS áreas que la persona aún no puede consultar. */
export async function listRequestableDocuments(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject, now: Date = new Date()) {
  const docs = await db.sgcDocument.findMany({
    where: { id_company: access.idCompany, status: 'vigente', confidentiality: 'departamento' },
    include: { process: { select: { code: true, name: true } }, ownerDepartment: { select: { department: true } } },
    orderBy: { code: 'asc' },
  });
  const out: { idDocument: number; code: string; title: string; process: string; ownerDepartment: string | null }[] = [];
  for (const d of docs) {
    if (await canViewDocument(db, [access], subject, d.id_document, now)) continue;
    out.push({ idDocument: d.id_document, code: d.code, title: d.title, process: `${d.process.code} · ${d.process.name}`, ownerDepartment: d.ownerDepartment?.department ?? null });
  }
  return out;
}

/** Registra la solicitud. La respuesta es la MISMA exista o no el documento. */
export async function createAccessRequest(
  db: SgcDb,
  notifier: SgcNotifier,
  access: SgcCompanyAccess,
  subject: SgcAccessSubject,
  input: { idDocument?: unknown; code?: unknown; justification: unknown },
  actor: SgcActor,
  now: Date = new Date()
): Promise<{ idAccessRequest: number; message: string }> {
  if (!access.canRead) throw new SgcError('Sin acceso al SGC de la empresa.', 403);
  const justification = text(input.justification, 'La justificación', 10, 2000);
  let code = normalizeDocumentCode(typeof input.code === 'string' ? input.code : '');
  let doc = null as Awaited<ReturnType<SgcDb['sgcDocument']['findFirst']>>;
  if (!code && input.idDocument !== undefined && input.idDocument !== null && input.idDocument !== '') {
    const id = Number(input.idDocument);
    doc = Number.isInteger(id) ? await db.sgcDocument.findFirst({ where: { id_document: id, id_company: access.idCompany } }) : null;
    // Por id solo se piden los «por departamento» (los que se listan); otro id se trata como inexistente.
    if (doc && doc.confidentiality !== 'departamento') doc = null;
    if (!doc) throw new SgcError('Seleccione un documento de la lista o escriba su código.');
    code = doc.code;
  } else {
    if (!code || code.length < 3) throw new SgcError('Escriba el código del documento (por ejemplo OLP-GC-PR-001).');
    doc = await db.sgcDocument.findFirst({ where: { id_company: access.idCompany, code } });
  }
  // Solo se vincula un documento VIGENTE que la persona aún no puede consultar.
  const linkable = doc && doc.status === 'vigente' && !(await canViewDocument(db, [access], subject, doc.id_document, now)) ? doc : null;
  const email = lower(actor.email);
  let saved;
  try {
    saved = await db.$transaction(async (tx) => {
      const row = await tx.sgcAccessRequest.create({
        data: { id_company: access.idCompany, id_document: linkable?.id_document ?? null, requested_code: code.slice(0, 60), requester_email: email, justification },
      });
      await writeSgcAudit(tx, {
        idCompany: access.idCompany,
        actorEmail: email,
        action: SGC_AUDIT_ACTIONS.accesoSolicitado,
        entity: 'access_request',
        entityId: row.id_access_request,
        after: { code, linked: !!linkable, idDocument: linkable?.id_document ?? null },
        detail: `Solicita acceso de consulta a ${code}: ${justification}`.slice(0, 1000),
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error) || /access_request_pendiente_uq/.test(String((error as Error)?.message))) {
      throw new SgcError(`Ya tiene una solicitud pendiente para ${code}.`, 409);
    }
    throw error;
  }
  const quality = (await qualityEmails(db, access.idCompany)).filter((e) => e !== email);
  if (quality.length) {
    await notifier([{ emails: quality, payload: { title: 'Solicitud de acceso a documento · SynerLink', body: `${email} pide consultar ${code}: ${justification}`.slice(0, 300), url: `${ACCESS_URL}?empresa=${access.idCompany}`, tag: `sgc-acceso-${saved.id_access_request}` } }]).catch((e) => console.error('[sgc/notificaciones]', e));
  }
  return { idAccessRequest: saved.id_access_request, message: 'Solicitud registrada. Aseguramiento de Calidad la revisará y le notificará la decisión.' };
}

export interface SgcAccessRequestRow {
  id: number;
  code: string;
  requester: string;
  justification: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  accessExpiresAt: string | null;
  /** Solo para Calidad: el documento que se vincula (o null si el código no existe / no aplica). */
  document: { idDocument: number; title: string; confidentiality: string; status: string } | null;
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(db: SgcDb, where: NonNullable<Parameters<SgcDb['sgcAccessRequest']['findMany']>[0]>['where']) {
  return db.sgcAccessRequest.findMany({ where, include: { document: { select: { id_document: true, title: true, confidentiality: true, status: true } } }, orderBy: { id_access_request: 'desc' }, take: 300 });
}

function toRow(r: Row, forQuality: boolean): SgcAccessRequestRow {
  return {
    id: r.id_access_request,
    code: r.requested_code,
    requester: r.requester_email,
    justification: r.justification,
    status: r.status,
    statusLabel: SGC_ACCESS_REQUEST_STATUS_LABELS[r.status] ?? r.status,
    createdAt: r.created_at.toISOString(),
    decidedBy: r.decided_by,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    decisionReason: r.decision_reason,
    accessExpiresAt: r.access_expires_at ? r.access_expires_at.toISOString() : null,
    document: forQuality && r.document ? { idDocument: r.document.id_document, title: r.document.title, confidentiality: r.document.confidentiality, status: r.document.status } : null,
  };
}

/** Mis solicitudes y, para Calidad, todas las de la empresa. */
export async function listAccessRequests(db: SgcDb, access: SgcCompanyAccess, email: string) {
  const mine = (await loadRows(db, { id_company: access.idCompany, requester_email: lower(email) })).map((r) => toRow(r, false));
  const all = access.canQuality ? (await loadRows(db, { id_company: access.idCompany })).map((r) => toRow(r, true)) : null;
  return { mine, all };
}

/** Calidad aprueba (crea el acceso de consulta) o rechaza, con motivo. */
export async function decideAccessRequest(
  db: SgcDb,
  notifier: SgcNotifier,
  accessByCompany: readonly SgcCompanyAccess[],
  idAccessRequest: number,
  input: { decision: unknown; reason: unknown; expiresAt?: unknown },
  actor: SgcActor,
  now: Date = new Date()
) {
  const req = Number.isInteger(idAccessRequest) ? await db.sgcAccessRequest.findUnique({ where: { id_access_request: idAccessRequest }, include: { document: true } }) : null;
  if (!req) throw new SgcError('Solicitud no encontrada.', 404);
  const access = accessByCompany.find((a) => a.idCompany === req.id_company);
  if (!access?.canQuality) throw new SgcError('Solo Aseguramiento de Calidad decide las solicitudes de acceso.', 403);
  if (req.status !== 'pendiente') throw new SgcError('La solicitud ya fue decidida.', 409);
  if (input.decision !== 'aprobar' && input.decision !== 'rechazar') throw new SgcError('Decisión inválida: aprobar o rechazar.');
  const reason = text(input.reason, 'El motivo de la decisión', 10, 1000);
  if (lower(req.requester_email) === lower(actor.email)) throw new SgcError('Una persona no decide su propia solicitud de acceso.', 403);
  let expiresAt: Date | null = null;
  if (typeof input.expiresAt === 'string' && input.expiresAt.trim()) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) throw new SgcError('El vencimiento del acceso debe ser una fecha futura.');
  }
  const approve = input.decision === 'aprobar';
  if (approve && (!req.document || req.document.status !== 'vigente')) throw new SgcError('El código pedido no corresponde a un documento vigente de la empresa: rechace la solicitud con su motivo.', 409);
  const me = lower(actor.email);
  const result = await db.$transaction(async (tx) => {
    let idAccess: number | null = null;
    if (approve) {
      const grant = await tx.sgcDocumentAccess.create({
        data: { id_document: req.document!.id_document, user_email: lower(req.requester_email), can_view: true, can_download: false, can_print: false, expires_at: expiresAt, reason: `Solicitud de acceso #${req.id_access_request}: ${reason}`.slice(0, 1000), granted_by: me },
      });
      idAccess = grant.id_document_access;
      await writeSgcAudit(tx, { idCompany: req.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.accesoOtorgado, entity: 'document_access', entityId: grant.id_document_access, after: grant, detail: `${req.requested_code}: acceso de consulta por la solicitud #${req.id_access_request}.`, ip: actor.ip, userAgent: actor.userAgent });
    }
    const saved = await tx.sgcAccessRequest.update({
      where: { id_access_request: req.id_access_request },
      data: { status: approve ? 'aprobada' : 'rechazada', decided_by: me, decided_at: now, decision_reason: reason, access_expires_at: approve ? expiresAt : null, id_document_access: idAccess },
    });
    await writeSgcAudit(tx, {
      idCompany: req.id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.accesoSolicitudDecidida,
      entity: 'access_request',
      entityId: req.id_access_request,
      before: { status: req.status },
      after: { status: saved.status, idDocumentAccess: idAccess, expiresAt },
      detail: `${approve ? 'Aprobada' : 'Rechazada'} la solicitud de ${req.requester_email} a ${req.requested_code}: ${reason}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return saved;
  });
  await notifier([
    {
      emails: [lower(req.requester_email)],
      payload: {
        title: `Solicitud de acceso ${approve ? 'aprobada' : 'rechazada'} · SynerLink`,
        body: `${req.requested_code}: ${reason}`.slice(0, 300),
        url: approve && req.document ? `/process/sgc-documental/documentos/${req.document.id_document}?empresa=${req.id_company}` : `${ACCESS_URL}?empresa=${req.id_company}`,
        tag: `sgc-acceso-${req.id_access_request}`,
      },
    },
  ]).catch((e) => console.error('[sgc/notificaciones]', e));
  return { status: result.status, idDocumentAccess: result.id_document_access };
}

/** Quien pidió cancela su solicitud pendiente. */
export async function cancelAccessRequest(db: SgcDb, accessByCompany: readonly SgcCompanyAccess[], idAccessRequest: number, actor: SgcActor, now: Date = new Date()) {
  const req = Number.isInteger(idAccessRequest) ? await db.sgcAccessRequest.findUnique({ where: { id_access_request: idAccessRequest } }) : null;
  if (!req || !accessByCompany.some((a) => a.idCompany === req.id_company && a.canRead) || lower(req.requester_email) !== lower(actor.email)) throw new SgcError('Solicitud no encontrada.', 404);
  if (req.status !== 'pendiente') throw new SgcError('La solicitud ya fue decidida.', 409);
  return db.$transaction(async (tx) => {
    const saved = await tx.sgcAccessRequest.update({ where: { id_access_request: idAccessRequest }, data: { status: 'cancelada', decided_by: lower(actor.email), decided_at: now, decision_reason: 'Cancelada por quien la pidió.' } });
    await writeSgcAudit(tx, { idCompany: req.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.accesoSolicitudCancelada, entity: 'access_request', entityId: idAccessRequest, before: { status: req.status }, after: { status: 'cancelada' }, ip: actor.ip, userAgent: actor.userAgent });
    return { status: saved.status };
  });
}
