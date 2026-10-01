import { SGC_AUDIT_ACTIONS, buildAuditRow, writeSgcAudit } from '../audit';
import type { SgcCalendarItem } from '../calendar';
import { SGC_SUBPROCESS_URLS } from '../constants';
import type { SgcAccessSubject } from '../documentAccess';
import type { SgcMailer } from '../email';
import { SgcError, isUniqueViolation } from '../errors';
import { SGC_NOTIFICATION_TITLES, taskUrl, type SgcNotifier } from '../notifications';
import type { SgcCompanyAccess } from '../permissions';
import { formatCalendarDate, toCalendarDate } from '../review';
import {
  SGC_ALERT_TITLES,
  SGC_DEFAULT_OVERDUE_EVERY_DAYS,
  SGC_DEFAULT_READING_REMINDER_DAYS,
  alertBody,
  daysBetween,
  getCalendarState,
  normalizeAlertOffsets,
  normalizeExtraEmails,
  parseStoredOffsets,
  planReviewAlert,
  resolveAlertConfig,
  type SgcAlertConfigRow,
  type SgcAlertKind,
  type SgcAlertPlanItem,
} from '../reviewAlerts';
import type { SgcActor, SgcDb } from './catalogs';
import { listVisibleDocuments } from './documents';
import { colombiaToday } from './vigencia';

/**
 * VENCIMIENTOS del SGC (Sprint 5): calendario, configuración de avisos
 * anticipados, ejecución diaria de avisos (programador central de SynerLink,
 * job `sgc_review_alerts`) y recordatorios automáticos de lectura (los que el
 * S4 dejó manuales).
 *
 * Destinatarios de cada aviso (pedido de Nicolás, 2026-09-30):
 *   - dueño del proceso: SynerLink no tiene una persona «dueña» del proceso,
 *     así que se toma a quienes tienen gestión documental (o Calidad) del SGC
 *     en la empresa Y pertenecen al departamento dueño del proceso
 *     (supuesto a validar con Nicolás);
 *   - último elaborador: el elaborador de la solicitud que produjo la versión
 *     vigente (o quien la cargó, si fue una carga inicial);
 *   - Calidad: quienes tienen el permiso de Aseguramiento de Calidad del SGC
 *     en la empresa; y los destinatarios adicionales que Calidad configure.
 * Canales: campana + push de SynerLink y correo (si la empresa lo tiene
 * encendido). Cada aviso (y cada omitido) queda en sgc.review_alert (una sola
 * vez, clave única) y en sgc.audit_log: a quién, cuándo y por qué canal.
 */

const SYSTEM_ACTOR = 'sistema.sgc@synerlink';

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function reasonOf(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 10) throw new SgcError('Explique el motivo (mínimo 10 caracteres): queda en la auditoría.');
  return reason.slice(0, 1000);
}

function parseEmails(json: string | null | undefined): string[] {
  try {
    const r = normalizeExtraEmails(JSON.parse(json ?? '[]'));
    return 'emails' in r ? r.emails : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Configuración de avisos
// ---------------------------------------------------------------------------

type ConfigRow = Awaited<ReturnType<SgcDb['sgcReviewAlertConfig']['findMany']>>[number];

function toConfigRow(r: ConfigRow): SgcAlertConfigRow & { id: number; scopeKey: string; reason: string; updatedBy: string; updatedAt: string } {
  return {
    id: r.id_review_alert_config,
    scope: r.scope,
    scopeKey: r.scope_key,
    idDocumentType: r.id_document_type,
    idDocument: r.id_document,
    offsets: parseStoredOffsets(r.offsets_json),
    overdueEveryDays: r.overdue_every_days,
    readingReminderDays: r.reading_reminder_days,
    emailEnabled: r.email_enabled,
    extraEmails: parseEmails(r.extra_emails_json),
    isActive: r.is_active,
    reason: r.change_reason,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listAlertConfigs(db: SgcDb, idCompany: number) {
  const rows = await db.sgcReviewAlertConfig.findMany({ where: { id_company: idCompany }, orderBy: [{ scope: 'asc' }, { id_review_alert_config: 'asc' }] });
  return rows.map(toConfigRow);
}

/** Crea o actualiza la configuración de un alcance (empresa, tipo o documento). Solo Calidad, con motivo. */
export async function saveAlertConfig(db: SgcDb, access: SgcCompanyAccess, body: Record<string, unknown>, actor: SgcActor) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad configura los avisos de vencimiento.', 403);
  const idCompany = access.idCompany;
  const scope = body.scope;
  if (scope !== 'empresa' && scope !== 'tipo' && scope !== 'documento') throw new SgcError('Alcance inválido: empresa, tipo o documento.');
  const reason = reasonOf(body.reason);
  let idDocumentType: number | null = null;
  let idDocument: number | null = null;
  let scopeKey = 'empresa';
  if (scope === 'tipo') {
    idDocumentType = Number(body.idDocumentType);
    const t = Number.isInteger(idDocumentType) ? await db.sgcDocumentType.findFirst({ where: { id_document_type: idDocumentType, id_company: idCompany } }) : null;
    if (!t) throw new SgcError('Seleccione un tipo documental de la empresa.');
    scopeKey = `tipo:${idDocumentType}`;
  } else if (scope === 'documento') {
    idDocument = Number(body.idDocument);
    const d = Number.isInteger(idDocument) ? await db.sgcDocument.findFirst({ where: { id_document: idDocument, id_company: idCompany } }) : null;
    if (!d) throw new SgcError('Seleccione un documento de la empresa.');
    scopeKey = `documento:${idDocument}`;
  }
  const offsets = normalizeAlertOffsets(body.offsets);
  if ('error' in offsets) throw new SgcError(offsets.error);
  const every = Number(body.overdueEveryDays ?? SGC_DEFAULT_OVERDUE_EVERY_DAYS);
  if (!Number.isInteger(every) || every < 1 || every > 90) throw new SgcError('La repetición del aviso de vencido debe estar entre 1 y 90 días.');
  let reading: number | null = null;
  if (scope === 'empresa') {
    reading = Number(body.readingReminderDays ?? SGC_DEFAULT_READING_REMINDER_DAYS);
    if (!Number.isInteger(reading) || reading < 0 || reading > 60) throw new SgcError('El recordatorio de lectura debe estar entre 0 (apagado) y 60 días.');
  }
  const extras = normalizeExtraEmails(body.extraEmails);
  if ('error' in extras) throw new SgcError(extras.error);
  const data = {
    offsets_json: JSON.stringify(offsets.offsets),
    overdue_every_days: every,
    reading_reminder_days: reading,
    email_enabled: scope === 'empresa' ? body.emailEnabled !== false : true,
    extra_emails_json: JSON.stringify(extras.emails),
    is_active: body.isActive !== false,
    change_reason: reason,
    updated_by: lower(actor.email),
    updated_at: new Date(),
  };
  if (scope === 'empresa' && data.is_active === false) throw new SgcError('La configuración de la empresa no se desactiva (es la general).');
  const before = await db.sgcReviewAlertConfig.findUnique({ where: { id_company_scope_key: { id_company: idCompany, scope_key: scopeKey } } });
  return db.$transaction(async (tx) => {
    const saved = before
      ? await tx.sgcReviewAlertConfig.update({ where: { id_review_alert_config: before.id_review_alert_config }, data })
      : await tx.sgcReviewAlertConfig.create({ data: { ...data, id_company: idCompany, scope, scope_key: scopeKey, id_document_type: idDocumentType, id_document: idDocument } });
    await writeSgcAudit(tx, {
      idCompany,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.vencimientoConfigurado,
      entity: 'review_alert_config',
      entityId: saved.id_review_alert_config,
      before: before ?? null,
      after: saved,
      detail: `Avisos (${scopeKey}): ${offsets.offsets.join(', ')} días; vencido cada ${every} días. ${reason}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return toConfigRow(saved);
  });
}

// ---------------------------------------------------------------------------
// Responsables de cada documento
// ---------------------------------------------------------------------------

type DocLite = { id_document: number; id_company: number; created_by: string; current_version_id: number | null; id_owner_department: number | null; process: { id_department: number | null } };

interface Responsibles {
  owners: Map<number, string[]>;
  lastElaborator: Map<number, string | null>;
  openRequest: Map<number, number | null>;
  quality: string[];
}

async function emailsWithPermission(db: SgcDb, idCompany: number, urls: string[]): Promise<string[]> {
  const rows = await db.subprocessUserCompany.findMany({
    where: { subprocess: { subprocess_url: { in: urls } }, companyUser: { company: { id_company: idCompany }, user: { isActive: true } } },
    select: { companyUser: { select: { user: { select: { email: true } } } } },
  });
  return [...new Set(rows.map((r) => lower(r.companyUser.user.email)))].sort();
}

async function resolveResponsibles(db: SgcDb, idCompany: number, docs: readonly DocLite[]): Promise<Responsibles> {
  const ids = docs.map((d) => d.id_document);
  // El departamento dueño del DOCUMENTO (por defecto, el del proceso) es el «dueño del proceso».
  const deptOf = (d: DocLite) => d.id_owner_department ?? d.process.id_department;
  const deptIds = [...new Set(docs.map(deptOf).filter((x): x is number => x !== null))];
  const [managers, quality, deptRows, requests] = await Promise.all([
    emailsWithPermission(db, idCompany, [SGC_SUBPROCESS_URLS.gestion, SGC_SUBPROCESS_URLS.calidad]),
    emailsWithPermission(db, idCompany, [SGC_SUBPROCESS_URLS.calidad]),
    deptIds.length ? db.departmentUser.findMany({ where: { id_department: { in: deptIds } }, select: { id_department: true, user: { select: { email: true } } } }) : Promise.resolve([]),
    ids.length
      ? db.sgcRequest.findMany({ where: { id_document: { in: ids } }, select: { id_request: true, id_document: true, status: true, elaborator_email: true, id_document_version: true }, orderBy: { id_request: 'desc' } })
      : Promise.resolve([]),
  ]);
  const managerSet = new Set(managers);
  const byDept = new Map<number, string[]>();
  for (const r of deptRows) {
    const e = lower(r.user.email);
    if (!managerSet.has(e)) continue;
    byDept.set(r.id_department, [...new Set([...(byDept.get(r.id_department) ?? []), e])].sort());
  }
  const owners = new Map<number, string[]>();
  const lastElaborator = new Map<number, string | null>();
  const openRequest = new Map<number, number | null>();
  // Sprint 6: solicitudes agrupadas por documento (antes se filtraba la lista completa por cada documento).
  const requestsByDoc = new Map<number, (typeof requests)[number][]>();
  for (const r of requests) {
    if (r.id_document === null) continue;
    const list = requestsByDoc.get(r.id_document);
    if (list) list.push(r);
    else requestsByDoc.set(r.id_document, [r]);
  }
  for (const d of docs) {
    const dept = deptOf(d);
    owners.set(d.id_document, dept !== null ? (byDept.get(dept) ?? []) : []);
    const mine = requestsByDoc.get(d.id_document) ?? [];
    const producer = mine.find((r) => r.id_document_version !== null && r.id_document_version === d.current_version_id && r.status === 'completada') ?? mine.find((r) => r.status === 'completada');
    lastElaborator.set(d.id_document, producer ? lower(producer.elaborator_email) : lower(d.created_by) || null);
    openRequest.set(d.id_document, mine.find((r) => r.status === 'abierta' || r.status === 'en_espera')?.id_request ?? null);
  }
  return { owners, lastElaborator, openRequest, quality };
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

/**
 * Documentos VIGENTES que la persona puede consultar, con su próxima fecha de
 * vencimiento, estado (al día, próximo, vencido — en revisión, en revisión) y
 * responsables. «Mis vencimientos» = es dueña del proceso o fue la última en
 * elaborarlo.
 */
export async function listReviewCalendar(db: SgcDb, access: SgcCompanyAccess, subject: SgcAccessSubject, now: Date = new Date()): Promise<{ today: string; items: SgcCalendarItem[] }> {
  const visible = await listVisibleDocuments(db, access, subject, { statuses: ['vigente'] }, now);
  const docs = visible.filter((v) => v.doc.status === 'vigente');
  const [resp, configs] = await Promise.all([resolveResponsibles(db, access.idCompany, docs.map((v) => v.doc)), listAlertConfigs(db, access.idCompany)]);
  const today = colombiaToday(now);
  const me = lower(subject.email);
  const items = docs.map(({ doc, current }): SgcCalendarItem => {
    const cfg = resolveAlertConfig(configs, { idDocumentType: doc.id_document_type, idDocument: doc.id_document });
    const due = current?.review_due_date ?? doc.next_review_date ?? null;
    const owners = resp.owners.get(doc.id_document) ?? [];
    const last = resp.lastElaborator.get(doc.id_document) ?? null;
    const open = resp.openRequest.get(doc.id_document) ?? null;
    const responsibles = [...new Set([...owners, ...(last ? [last] : [])])];
    return {
      idDocument: doc.id_document,
      code: doc.code,
      title: doc.title,
      versionNumber: current?.version_number ?? null,
      idVersion: current?.id_document_version ?? null,
      dueDate: formatCalendarDate(due),
      state: getCalendarState({ dueDate: due, today, firstAlertDays: cfg.offsets[0] ?? 0, hasOpenRequest: open !== null }),
      idProcessType: doc.process.processType.id_process_type,
      processType: doc.process.processType.name,
      processTypeColor: doc.process.processType.color,
      idProcess: doc.process.id_process_map,
      process: `${doc.process.code} · ${doc.process.name}`,
      idDepartment: doc.id_owner_department ?? doc.process.id_department,
      department: doc.ownerDepartment?.department ?? doc.process.department?.department ?? null,
      idDocumentType: doc.documentType.id_document_type,
      documentType: `${doc.documentType.code} · ${doc.documentType.name}`,
      owners,
      lastElaborator: last,
      responsibles,
      openRequestId: open,
      isMine: owners.includes(me) || last === me,
      confidentiality: doc.confidentiality,
      offsets: cfg.offsets,
    };
  });
  items.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.code.localeCompare(b.code, 'es', { numeric: true }));
  return { today: formatCalendarDate(today)!, items };
}

// ---------------------------------------------------------------------------
// Ejecución de los avisos (programador)
// ---------------------------------------------------------------------------

export interface SgcAlertDeps {
  notifier: SgcNotifier;
  mailer: SgcMailer;
  /** URL pública de SynerLink (NEXTAUTH_URL) para los enlaces del correo. */
  appUrl: string;
}

export interface SgcAlertRunSummary {
  runDate: string;
  companies: number;
  documents: number;
  sent: number;
  omitted: number;
  notified: number;
  emails: number;
  emailErrors: number;
  readingReminders: number;
}

type RecipientRole = 'dueno' | 'elaborador' | 'calidad' | 'adicional';
const ROLE_LABELS: Record<RecipientRole, string> = { dueno: 'dueño del proceso', elaborador: 'último elaborador', calidad: 'Calidad', adicional: 'adicional' };
const KIND_LABELS: Record<SgcAlertKind, string> = { anticipado: 'aviso anticipado', vencimiento: 'aviso del día del vencimiento', vencido: 'vencido — escalado a Calidad' };

function fichaUrl(idDocument: number, idCompany: number): string {
  return `/process/sgc-documental/documentos/${idDocument}?empresa=${idCompany}`;
}

/** Registra un aviso como omitido (su día pasó sin correr el programador). */
async function recordOmitted(db: SgcDb, base: { idCompany: number; idDocument: number; idVersion: number; due: Date; code: string; versionNumber: number }, it: SgcAlertPlanItem, runDate: Date, source: string): Promise<boolean> {
  try {
    await db.$transaction(async (tx) => {
      const row = await tx.sgcReviewAlert.create({
        data: {
          id_company: base.idCompany,
          id_document: base.idDocument,
          id_document_version: base.idVersion,
          review_due_date: base.due,
          kind: it.kind,
          offset_days: it.offsetDays,
          alert_key: it.key,
          status: 'omitido',
          scheduled_for: toCalendarDate(it.scheduledFor),
          run_date: runDate,
          run_source: source,
        },
      });
      await writeSgcAudit(tx, {
        idCompany: base.idCompany,
        actorEmail: SYSTEM_ACTOR,
        action: SGC_AUDIT_ACTIONS.vencimientoAvisoOmitido,
        entity: 'review_alert',
        entityId: row.id_review_alert,
        after: { key: it.key, scheduledFor: it.scheduledFor },
        detail: `${base.code} V${base.versionNumber}: ${KIND_LABELS[it.kind]} de ${it.offsetDays} días del ${it.scheduledFor} no salió ese día (el programador no corrió); se envió el más urgente.`,
      });
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Corre los avisos del día (hora de Colombia) para las empresas activas (o una).
 * Idempotente: correrlo varias veces el mismo día, o en paralelo, no repite
 * avisos (clave única en sgc.review_alert).
 */
export async function runReviewAlerts(
  db: SgcDb,
  deps: SgcAlertDeps,
  opts: { now?: Date; idCompany?: number | null; source?: 'programador' | 'manual'; actorEmail?: string | null } = {}
): Promise<SgcAlertRunSummary> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? 'programador';
  const runDate = colombiaToday(now);
  const summary: SgcAlertRunSummary = { runDate: formatCalendarDate(runDate)!, companies: 0, documents: 0, sent: 0, omitted: 0, notified: 0, emails: 0, emailErrors: 0, readingReminders: 0 };
  const companies = await db.sgcCompanyConfig.findMany({ where: { is_active: true, ...(opts.idCompany ? { id_company: opts.idCompany } : {}) }, select: { id_company: true } });

  for (const { id_company: idCompany } of companies) {
    summary.companies += 1;
    const configs = await listAlertConfigs(db, idCompany);
    const docs = await db.sgcDocument.findMany({
      where: { id_company: idCompany, status: 'vigente', current_version_id: { not: null } },
      include: { process: { select: { id_department: true } }, documentType: { select: { id_document_type: true } } },
    });
    const versions = docs.length
      ? await db.sgcDocumentVersion.findMany({
          where: { id_document_version: { in: docs.map((d) => d.current_version_id!) }, status: 'vigente', review_due_date: { not: null } },
          select: { id_document_version: true, version_number: true, review_due_date: true },
        })
      : [];
    const versionById = new Map(versions.map((v) => [v.id_document_version, v]));
    const withDue = docs.filter((d) => versionById.has(d.current_version_id!));
    if (withDue.length === 0) continue;
    const existing = await db.sgcReviewAlert.findMany({ where: { id_document_version: { in: withDue.map((d) => d.current_version_id!) } }, select: { alert_key: true } });
    const already = new Set(existing.map((e) => e.alert_key));
    const resp = await resolveResponsibles(db, idCompany, withDue);

    for (const doc of withDue) {
      const version = versionById.get(doc.current_version_id!)!;
      const due = toCalendarDate(version.review_due_date!);
      const cfg = resolveAlertConfig(configs, { idDocumentType: doc.id_document_type, idDocument: doc.id_document });
      const plan = planReviewAlert({ idVersion: version.id_document_version, dueDate: due, today: runDate, offsets: cfg.offsets, overdueEveryDays: cfg.overdueEveryDays, already });
      if (!plan.send && plan.omit.length === 0) continue;
      summary.documents += 1;
      const base = { idCompany, idDocument: doc.id_document, idVersion: version.id_document_version, due, code: doc.code, versionNumber: version.version_number };
      for (const it of plan.omit) if (await recordOmitted(db, base, it, runDate, source)) summary.omitted += 1;
      if (!plan.send) continue;
      const it = plan.send;

      // Destinatarios con su papel.
      const roles = new Map<string, RecipientRole[]>();
      const add = (email: string | null | undefined, role: RecipientRole) => {
        const e = lower(email);
        if (!e) return;
        roles.set(e, [...new Set([...(roles.get(e) ?? []), role])]);
      };
      (resp.owners.get(doc.id_document) ?? []).forEach((e) => add(e, 'dueno'));
      add(resp.lastElaborator.get(doc.id_document), 'elaborador');
      resp.quality.forEach((e) => add(e, 'calidad'));
      cfg.extraEmails.forEach((e) => add(e, 'adicional'));
      const recipients = [...roles.entries()].map(([email, r]) => ({ email, roles: r }));

      // Reclamo atómico: si otra corrida ya lo registró, no se envía de nuevo.
      let row;
      try {
        row = await db.sgcReviewAlert.create({
          data: {
            id_company: idCompany,
            id_document: doc.id_document,
            id_document_version: version.id_document_version,
            review_due_date: due,
            kind: it.kind,
            offset_days: it.offsetDays,
            alert_key: it.key,
            status: 'enviado',
            scheduled_for: toCalendarDate(it.scheduledFor),
            run_date: runDate,
            run_source: source,
            recipients_json: JSON.stringify(recipients),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }

      const dueText = formatCalendarDate(due)!;
      const openId = resp.openRequest.get(doc.id_document) ?? null;
      const body = alertBody({ kind: it.kind, offsetDays: it.offsetDays, code: doc.code, versionNumber: version.version_number, title: doc.title, dueDate: dueText, openRequestId: openId });
      const url = fichaUrl(doc.id_document, idCompany);
      const emails = recipients.map((r) => r.email);
      await deps.notifier([{ emails, payload: { title: SGC_ALERT_TITLES[it.kind], body, url, tag: `sgc-vencimiento-${version.id_document_version}` } }]).catch((e) => console.error('[sgc/vencimientos]', e));
      summary.notified += emails.length;
      const mailResults = cfg.emailEnabled
        ? await deps
            .mailer(
              emails.map((to) => ({
                to,
                title: SGC_ALERT_TITLES[it.kind].replace(' · SynerLink', ''),
                rows: [
                  { label: 'Documento', value: `${doc.code} V${version.version_number}` },
                  { label: 'Título', value: doc.confidentiality === 'confidencial' ? '(confidencial)' : doc.title },
                  { label: 'Próximo vencimiento', value: dueText },
                  { label: 'Aviso', value: KIND_LABELS[it.kind] + (it.kind === 'anticipado' ? ` (${it.offsetDays} días antes)` : '') },
                  { label: 'Solicitud en curso', value: openId ? `#${openId}` : 'Ninguna' },
                ],
                outro: `Abra la ficha del documento en SynerLink: ${deps.appUrl.replace(/\/+$/, '')}${url}`,
              }))
            )
            .catch((e: unknown) => emails.map((to) => ({ to, ok: false as const, error: e instanceof Error ? e.message : 'Error de correo' })))
        : [];
      const mailBy = new Map(mailResults.map((m) => [m.to, m]));
      const channels = recipients.map((r) => {
        const m = mailBy.get(r.email);
        return { email: r.email, campana: 'enviado', correo: !cfg.emailEnabled ? 'apagado' : m?.ok ? 'enviado' : `error: ${m && !m.ok ? m.error : 'sin respuesta'}` };
      });
      summary.emails += channels.filter((c) => c.correo === 'enviado').length;
      summary.emailErrors += channels.filter((c) => c.correo.startsWith('error')).length;
      const sentAt = new Date();
      await db.$transaction(async (tx) => {
        // UPDATE directo: la tabla tiene un trigger INSTEAD OF UPDATE que solo deja completar los canales una vez.
        await tx.$executeRaw`UPDATE [sgc].[review_alert] SET channels_json = ${JSON.stringify(channels)}, sent_at = ${sentAt} WHERE id_review_alert = ${row.id_review_alert} AND sent_at IS NULL`;
        // Sprint 6 (rendimiento): una sola inserción con todas las filas de auditoría del aviso.
        if (channels.length) {
          await tx.sgcAuditLog.createMany({
            data: channels.map((c) => {
              const rr = roles.get(c.email) ?? [];
              return buildAuditRow({
                idCompany,
                actorEmail: opts.actorEmail ?? SYSTEM_ACTOR,
                action: SGC_AUDIT_ACTIONS.vencimientoAviso,
                entity: 'review_alert',
                entityId: row.id_review_alert,
                after: { key: it.key, to: c.email, roles: rr, channels: { campana: c.campana, correo: c.correo }, sentAt: sentAt.toISOString() },
                detail: `${doc.code} V${version.version_number} · ${KIND_LABELS[it.kind]} (${it.kind === 'vencido' ? `${it.offsetDays} días vencido` : `${it.offsetDays} días`}; vence ${dueText}) → ${c.email} (${rr.map((x) => ROLE_LABELS[x]).join(', ')}) por campana/push${cfg.emailEnabled ? ` y correo (${c.correo})` : ''}.`.slice(0, 1000),
              });
            }),
          });
        }
        if (it.kind !== 'anticipado') {
          await writeSgcAudit(tx, {
            idCompany,
            actorEmail: opts.actorEmail ?? SYSTEM_ACTOR,
            action: SGC_AUDIT_ACTIONS.vencimientoEscalado,
            entity: 'document',
            entityId: doc.id_document,
            after: { key: it.key, quality: resp.quality },
            detail: `${doc.code} V${version.version_number} ${it.kind === 'vencimiento' ? 'vence hoy' : `lleva ${it.offsetDays} días vencido`}: sigue vigente, marcado «vencido — en revisión» y escalado a Calidad (${resp.quality.join(', ') || 'sin personas con permiso de Calidad'}).`.slice(0, 1000),
          });
        }
      });
      already.add(it.key);
      summary.sent += 1;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Recordatorios automáticos de lectura (lo que el S4 dejó manual)
// ---------------------------------------------------------------------------

/**
 * Recuerda las lecturas obligatorias pendientes cada N días (configuración de
 * la empresa, 7 por defecto; 0 = apagado). Cuenta desde el último recordatorio
 * (manual o automático) o desde la asignación. Una sola vez por día y persona
 * aunque corra en paralelo (actualización condicionada).
 */
export async function runReadingReminders(db: SgcDb, notifier: SgcNotifier, opts: { now?: Date; idCompany?: number | null } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const today = colombiaToday(now);
  const companies = await db.sgcCompanyConfig.findMany({ where: { is_active: true, ...(opts.idCompany ? { id_company: opts.idCompany } : {}) }, select: { id_company: true } });
  let total = 0;
  for (const { id_company: idCompany } of companies) {
    const cfg = await db.sgcReviewAlertConfig.findUnique({ where: { id_company_scope_key: { id_company: idCompany, scope_key: 'empresa' } } });
    const every = cfg?.reading_reminder_days ?? SGC_DEFAULT_READING_REMINDER_DAYS;
    if (!every) continue;
    const pending = await db.sgcReadRecord.findMany({
      where: { status: 'pendiente', task: { status: 'abierta' }, request: { id_company: idCompany, status: 'abierta' } },
      include: { request: { select: { id_request: true, subject: true } } },
    });
    const due = pending.filter((p) => daysBetween(colombiaToday(p.last_reminder_at ?? p.assigned_at), today) >= every);
    const byRequest = new Map<number, { subject: string; idTask: number; emails: string[] }>();
    for (const p of due) {
      const claim = await db.sgcReadRecord.updateMany({
        where: { id_read_record: p.id_read_record, status: 'pendiente', last_reminder_at: p.last_reminder_at },
        data: { reminders_sent: { increment: 1 }, last_reminder_at: now },
      });
      if (claim.count !== 1) continue;
      const g = byRequest.get(p.id_request) ?? { subject: p.request.subject, idTask: p.id_task, emails: [] };
      g.emails.push(lower(p.user_email));
      byRequest.set(p.id_request, g);
    }
    for (const [idRequest, g] of byRequest) {
      await db.$transaction(async (tx) => {
        await tx.sgcInteraction.create({ data: { id_request: idRequest, id_task: g.idTask, kind: 'estado', author_email: SYSTEM_ACTOR, body: `Recordatorio automático de lectura (cada ${every} días) a ${g.emails.length} persona(s): ${g.emails.join(', ')}.`.slice(0, 8000) } });
        await writeSgcAudit(tx, { idCompany, actorEmail: SYSTEM_ACTOR, action: SGC_AUDIT_ACTIONS.lecturaRecordatorioAutomatico, entity: 'task', entityId: g.idTask, after: { idRequest, emails: g.emails, everyDays: every }, detail: `Recordatorio automático de lectura a ${g.emails.join(', ')} por campana/push.`.slice(0, 1000) });
      });
      await notifier([{ emails: g.emails, payload: { title: SGC_NOTIFICATION_TITLES.lecturaRecordatorio, body: `#${idRequest} · Tiene pendiente leer y firmar «Leído» — ${g.subject}`.slice(0, 300), url: taskUrl(g.idTask), tag: `sgc-task-${g.idTask}` } }]).catch((e) => console.error('[sgc/notificaciones]', e));
      total += g.emails.length;
    }
  }
  return total;
}

/** Corrida completa del día: avisos de vencimiento + recordatorios de lectura. */
export async function runDailySgcJob(db: SgcDb, deps: SgcAlertDeps, opts: { now?: Date; idCompany?: number | null; source?: 'programador' | 'manual'; actorEmail?: string | null } = {}): Promise<SgcAlertRunSummary> {
  const summary = await runReviewAlerts(db, deps, opts);
  summary.readingReminders = await runReadingReminders(db, deps.notifier, opts);
  if (opts.idCompany) {
    // Corrida manual de Calidad para su empresa (la del programador queda en scheduled_job_run).
    await writeSgcAudit(db, {
      idCompany: opts.idCompany,
      actorEmail: opts.actorEmail ?? SYSTEM_ACTOR,
      action: SGC_AUDIT_ACTIONS.vencimientoEjecucion,
      entity: 'review_alert',
      entityId: summary.runDate,
      after: summary,
      detail: `Ejecución ${opts.source ?? 'programador'} de avisos del ${summary.runDate}: ${summary.sent} enviados, ${summary.omitted} omitidos, ${summary.readingReminders} recordatorios de lectura.`,
    });
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Registro de avisos y estado del programador (vista de Calidad)
// ---------------------------------------------------------------------------

export async function listAlertLog(db: SgcDb, access: SgcCompanyAccess, opts: { idDocument?: number | null; limit?: number } = {}) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad consulta el registro de avisos.', 403);
  const rows = await db.sgcReviewAlert.findMany({
    where: { id_company: access.idCompany, ...(opts.idDocument ? { id_document: opts.idDocument } : {}) },
    include: { document: { select: { code: true, title: true } }, version: { select: { version_number: true } } },
    orderBy: { id_review_alert: 'desc' },
    take: Math.min(Math.max(opts.limit ?? 200, 1), 500),
  });
  return rows.map((r) => ({
    id: r.id_review_alert,
    idDocument: r.id_document,
    code: r.document.code,
    title: r.document.title,
    versionNumber: r.version.version_number,
    dueDate: formatCalendarDate(r.review_due_date),
    kind: r.kind,
    offsetDays: r.offset_days,
    status: r.status,
    scheduledFor: formatCalendarDate(r.scheduled_for),
    runDate: formatCalendarDate(r.run_date),
    runSource: r.run_source,
    recipients: safeJson<{ email: string; roles: string[] }[]>(r.recipients_json, []),
    channels: safeJson<{ email: string; campana: string; correo: string }[]>(r.channels_json, []),
    sentAt: r.sent_at ? r.sent_at.toISOString() : null,
  }));
}

function safeJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const SGC_ALERT_JOB_TYPE = 'sgc_review_alerts';

/** Estado del job del programador central (lectura; null si la tabla no existe). */
export async function getAlertSchedulerStatus(db: SgcDb): Promise<{ id: number; active: boolean; cron: string; nextRun: string | null; lastRun: string | null; lastStatus: string | null } | null> {
  try {
    const rows = await db.$queryRaw<{ id: number; active: boolean; cron_expression: string; next_run_date: Date | null; last_run_date: Date | null; last_status: string | null }[]>`
      SELECT TOP 1 id, active, cron_expression, next_run_date, last_run_date, last_status FROM dbo.scheduled_job WHERE job_type = ${SGC_ALERT_JOB_TYPE} ORDER BY id`;
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, active: !!r.active, cron: r.cron_expression, nextRun: r.next_run_date ? r.next_run_date.toISOString() : null, lastRun: r.last_run_date ? r.last_run_date.toISOString() : null, lastStatus: r.last_status };
  } catch {
    return null;
  }
}
