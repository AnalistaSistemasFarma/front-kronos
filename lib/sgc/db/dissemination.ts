import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SGC_SUBPROCESS_URLS } from '../constants';
import {
  SGC_READ_STATUS_LABELS,
  SGC_SCOPE_KIND_LABELS,
  defaultScope,
  normalizeReadingEvent,
  normalizeScopeEntry,
  resolveReaders,
  scopeKey,
  summarizeCoverage,
  type SgcReadStatus,
  type SgcScopeDirectory,
  type SgcScopeEntry,
  type SgcScopeKind,
} from '../dissemination/scope';
import { SgcError } from '../errors';
import { SGC_NOTIFICATION_TITLES, recipients, requestUrl, taskUrl, type SgcNotification, type SgcNotifier } from '../notifications';
import type { SgcCompanyAccess } from '../permissions';
import { getPoolMembers } from './authorizations';
import type { SgcActor, SgcDb } from './catalogs';

/**
 * DIVULGACIÓN del SGC (Sprint 4, paso 4 del flujo documental): alcance,
 * tareas de lectura, avance de lectura, recordatorios y cobertura. Las reglas
 * puras están en lib/sgc/dissemination/scope.ts; la firma «Leyó» va por el
 * servicio de firma propio del S3 (lib/sgc/db/signatures.ts) y el avance del
 * flujo por el motor (lib/sgc/db/requests.ts).
 */

type Tx = Prisma.TransactionClient;
type Db = SgcDb | Tx;

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function reasonOf(value: unknown, min = 5, label = 'El motivo'): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new SgcError(`${label} es obligatorio (mínimo ${min} caracteres).`);
  return s.slice(0, 1000);
}

function toEntry(row: { kind: string; id_department: number | null; id_cargo: number | null; user_email: string | null }): SgcScopeEntry {
  return { kind: row.kind as SgcScopeKind, idDepartment: row.id_department, idCargo: row.id_cargo, userEmail: row.user_email ? lower(row.user_email) : null };
}

// ---------------------------------------------------------------------------
// Directorio de la empresa (quién puede leer, por departamento y por cargo)
// ---------------------------------------------------------------------------

/**
 * Directorio para resolver el alcance. «Toda la empresa» = las personas
 * activas con algún permiso del SGC en la empresa (quien no tiene acceso al
 * módulo no podría abrir su tarea de lectura).
 */
export async function buildScopeDirectory(db: Db, idCompany: number, entries: readonly SgcScopeEntry[]): Promise<SgcScopeDirectory> {
  const permRows = await db.subprocessUserCompany.findMany({
    where: {
      subprocess: { subprocess_url: { in: Object.values(SGC_SUBPROCESS_URLS) } },
      companyUser: { company: { id_company: idCompany }, user: { isActive: true } },
    },
    select: { companyUser: { select: { user: { select: { email: true } } } } },
  });
  const eligible = new Set(permRows.map((r) => lower(r.companyUser.user.email)));
  const deptIds = [...new Set(entries.filter((e) => e.kind === 'departamento').map((e) => e.idDepartment!))];
  const cargoIds = [...new Set(entries.filter((e) => e.kind === 'cargo').map((e) => e.idCargo!))];
  const departmentMembers = new Map<number, string[]>();
  if (deptIds.length) {
    const rows = await db.departmentUser.findMany({ where: { id_department: { in: deptIds }, user: { isActive: true } }, select: { id_department: true, user: { select: { email: true } } } });
    for (const r of rows) departmentMembers.set(r.id_department, [...(departmentMembers.get(r.id_department) ?? []), lower(r.user.email)]);
  }
  const cargoMembers = new Map<number, string[]>();
  if (cargoIds.length) {
    const rows = await db.sgcCargoMember.findMany({ where: { id_company: idCompany, id_cargo: { in: cargoIds }, is_active: true }, select: { id_cargo: true, user_email: true } });
    for (const r of rows) cargoMembers.set(r.id_cargo, [...(cargoMembers.get(r.id_cargo) ?? []), lower(r.user_email)]);
  }
  return { eligible, companyMembers: [...eligible], departmentMembers, cargoMembers };
}

// ---------------------------------------------------------------------------
// Activación de la divulgación (la llama el motor al llegar al paso)
// ---------------------------------------------------------------------------

export interface SgcActivateReadersCtx {
  tx: Tx;
  request: { id_request: number; id_company: number; id_process_map: number | null; subject: string };
  idTask: number;
  poolTypeCode: string | null;
  actor: SgcActor;
  notifications: SgcNotification[];
}

/**
 * Crea un cupo de lectura (firma «Leyó») por cada persona del alcance. Si
 * nadie definió el alcance, se toma el DEPARTAMENTO DUEÑO del proceso (queda
 * registrado como entrada del alcance). Devuelve cuántos lectores quedaron.
 */
export async function activateReaders(ctx: SgcActivateReadersCtx): Promise<{ readers: number; withoutAccess: string[] }> {
  const { tx, request } = ctx;
  let scopeRows = await tx.sgcDisseminationScope.findMany({ where: { id_request: request.id_request, is_active: true } });
  if (scopeRows.length === 0) {
    const proc = request.id_process_map ? await tx.sgcProcessMap.findUnique({ where: { id_process_map: request.id_process_map }, select: { id_department: true } }) : null;
    for (const e of defaultScope(proc?.id_department ?? null)) {
      await tx.sgcDisseminationScope.create({
        data: { id_request: request.id_request, kind: e.kind, id_department: e.idDepartment, id_cargo: e.idCargo, user_email: e.userEmail, scope_key: scopeKey(e), added_by: lower(ctx.actor.email), change_reason: 'Alcance por defecto: departamento dueño del proceso (nadie definió el alcance antes de la divulgación).' },
      });
    }
    scopeRows = await tx.sgcDisseminationScope.findMany({ where: { id_request: request.id_request, is_active: true } });
  }
  const entries = scopeRows.map(toEntry);
  const dir = await buildScopeDirectory(tx, request.id_company, entries);
  const { readers, withoutAccess } = resolveReaders(entries, dir);
  const added = await addReaders(tx, request, ctx.idTask, readers);
  const summary = `Divulgación iniciada: ${added.length} persona(s) deben leer el documento hasta el final y firmar «Leyó».${withoutAccess.length ? `\n${withoutAccess.length} persona(s) del alcance no tienen acceso al SGC y no recibieron tarea: ${withoutAccess.map((w) => w.email).join(', ')}.` : ''}${added.length === 0 ? '\nEl alcance no tiene lectores: Calidad debe ampliarlo (departamentos, cargos o personas) o cerrar la divulgación con justificación.' : ''}`;
  await tx.sgcInteraction.create({ data: { id_request: request.id_request, id_task: ctx.idTask, kind: 'estado', author_email: lower(ctx.actor.email), body: summary.slice(0, 8000), meta_json: JSON.stringify({ readers: added, withoutAccess: withoutAccess.map((w) => w.email) }) } });
  await writeSgcAudit(tx, { idCompany: request.id_company, actorEmail: ctx.actor.email, action: SGC_AUDIT_ACTIONS.lectoresAsignados, entity: 'task', entityId: ctx.idTask, after: { idRequest: request.id_request, readers: added, withoutAccess: withoutAccess.map((w) => w.email), scope: entries.map(scopeKey) }, ip: ctx.actor.ip, userAgent: ctx.actor.userAgent });
  pushReaderNotifications(ctx.notifications, added, request, ctx.idTask, ctx.actor.email);
  if (ctx.poolTypeCode) {
    const members = recipients(await getPoolMembers(tx, request.id_company, ctx.poolTypeCode), ctx.actor.email);
    if (members.length) {
      ctx.notifications.push({ emails: members, payload: { title: SGC_NOTIFICATION_TITLES.avance, body: `#${request.id_request} · Divulgación iniciada (${added.length} lector(es)) — ${request.subject}`.slice(0, 300), url: requestUrl(request.id_request), tag: `sgc-request-${request.id_request}` } });
    }
  }
  return { readers: added.length, withoutAccess: withoutAccess.map((w) => w.email) };
}

async function addReaders(tx: Tx, request: { id_request: number }, idTask: number, readers: readonly { email: string; sources: string[] }[]): Promise<string[]> {
  const existing = await tx.sgcReadRecord.findMany({ where: { id_task: idTask }, select: { user_email: true } });
  const have = new Set(existing.map((e) => lower(e.user_email)));
  const lastOrder = await tx.sgcTaskAssignee.aggregate({ where: { id_task: idTask }, _max: { sign_order: true } });
  let order = lastOrder._max.sign_order ?? 0;
  const now = new Date();
  const added: string[] = [];
  for (const r of readers) {
    if (have.has(r.email)) continue;
    order += 1;
    const a = await tx.sgcTaskAssignee.create({ data: { id_task: idTask, user_email: r.email, sign_order: order, status: 'pendiente', signature_status: 'pendiente', signature_meaning: 'leyo' } });
    await tx.sgcReadRecord.create({ data: { id_request: request.id_request, id_task: idTask, id_task_assignee: a.id_task_assignee, user_email: r.email, sources_json: JSON.stringify(r.sources).slice(0, 1000), status: 'pendiente', assigned_at: now } });
    added.push(r.email);
  }
  return added;
}

function pushReaderNotifications(out: SgcNotification[], emails: readonly string[], request: { id_request: number; subject: string }, idTask: number, actorEmail: string) {
  const people = recipients(emails, actorEmail);
  if (people.length) {
    out.push({ emails: people, payload: { title: SGC_NOTIFICATION_TITLES.lecturaAsignada, body: `#${request.id_request} · Lea el documento hasta el final y firme «Leído» — ${request.subject}`.slice(0, 300), url: taskUrl(idTask), tag: `sgc-task-${idTask}` } });
  }
}

// ---------------------------------------------------------------------------
// Alcance: agregar y retirar entradas
// ---------------------------------------------------------------------------

async function loadForScope(db: SgcDb, idRequest: number) {
  const request = await db.sgcRequest.findUnique({ where: { id_request: idRequest }, include: { tasks: { include: { taskDef: true } } } });
  if (!request) throw new SgcError('Solicitud no encontrada.', 404);
  const openDissemination = request.tasks.find((t) => t.status === 'abierta' && t.taskDef.assignment === 'alcance') ?? null;
  const disseminationStarted = request.tasks.some((t) => t.taskDef.assignment === 'alcance');
  return { request, openDissemination, disseminationStarted };
}

/**
 * Agrega una entrada al alcance. Antes de la divulgación: el elaborador o
 * Calidad. Durante la divulgación: solo Calidad (AMPLIAR), y las personas
 * nuevas reciben su tarea de lectura de inmediato. Después: no se cambia.
 */
export async function addScopeEntry(db: SgcDb, notifier: SgcNotifier, access: SgcCompanyAccess, idRequest: number, input: { entry?: unknown; reason?: unknown } & Record<string, unknown>, actor: SgcActor) {
  const entry = normalizeScopeEntry(input.entry ?? input);
  const { request, openDissemination, disseminationStarted } = await loadForScope(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  const me = lower(actor.email);
  if (request.status !== 'abierta') throw new SgcError('La solicitud no está abierta: el alcance ya no cambia.', 409);
  if (disseminationStarted && !openDissemination) throw new SgcError('La divulgación ya terminó: el alcance ya no cambia.', 409);
  if (openDissemination ? !access.canQuality : !(access.canQuality || me === lower(request.elaborator_email))) {
    throw new SgcError(openDissemination ? 'Durante la divulgación solo Aseguramiento de Calidad amplía el alcance.' : 'Solo el elaborador o Aseguramiento de Calidad definen el alcance de divulgación.', 403);
  }
  const reason = reasonOf(input.reason, 5, 'El motivo');
  if (entry.kind === 'departamento') {
    if (!(await db.department.findUnique({ where: { id_department: entry.idDepartment! } }))) throw new SgcError('El departamento no existe.');
  } else if (entry.kind === 'cargo') {
    if (!(await db.cargo.findUnique({ where: { id_cargo: entry.idCargo! } }))) throw new SgcError('El cargo no existe.');
  } else if (entry.kind === 'persona') {
    if (!(await db.user.findFirst({ where: { email: entry.userEmail!, isActive: true } }))) throw new SgcError('La persona no existe o está inactiva en SynerLink.');
  }
  const key = scopeKey(entry);
  const notifications: SgcNotification[] = [];
  const result = await db.$transaction(async (tx) => {
    await tx.sgcRequest.update({ where: { id_request: idRequest }, data: { updated_at: new Date() } });
    const dup = await tx.sgcDisseminationScope.findFirst({ where: { id_request: idRequest, scope_key: key, is_active: true } });
    if (dup) throw new SgcError('Esa entrada ya está en el alcance.', 409);
    const row = await tx.sgcDisseminationScope.create({ data: { id_request: idRequest, kind: entry.kind, id_department: entry.idDepartment, id_cargo: entry.idCargo, user_email: entry.userEmail, scope_key: key, added_by: me, change_reason: reason } });
    let added: string[] = [];
    let withoutAccess: string[] = [];
    if (openDissemination) {
      const excluded = new Set((await tx.sgcReadRecord.findMany({ where: { id_task: openDissemination.id_task }, select: { user_email: true } })).map((r) => lower(r.user_email)));
      const dir = await buildScopeDirectory(tx, request.id_company, [entry]);
      const res = resolveReaders([entry], dir, excluded);
      added = await addReaders(tx, request, openDissemination.id_task, res.readers);
      withoutAccess = res.withoutAccess.map((w) => w.email);
      pushReaderNotifications(notifications, added, request, openDissemination.id_task, me);
    }
    await tx.sgcInteraction.create({
      data: {
        id_request: idRequest,
        id_task: openDissemination?.id_task ?? null,
        kind: 'estado',
        author_email: me,
        body: `Agregó al alcance de divulgación: ${SGC_SCOPE_KIND_LABELS[entry.kind]} ${entry.idDepartment ?? entry.idCargo ?? entry.userEmail ?? ''}.${openDissemination ? ` Nuevos lectores: ${added.length}.` : ''}${withoutAccess.length ? ` Sin acceso al SGC: ${withoutAccess.join(', ')}.` : ''}\nMotivo: ${reason}`.slice(0, 8000),
        meta_json: JSON.stringify({ scope: key, added, withoutAccess }),
      },
    });
    await writeSgcAudit(tx, { idCompany: request.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.alcanceAgregado, entity: 'dissemination_scope', entityId: row.id_scope, after: { idRequest, scope: key, added, withoutAccess }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { idScope: row.id_scope, added: added.length, withoutAccess };
  });
  const real = notifications.filter((n) => n.emails.length);
  if (real.length) await notifier(real).catch((e) => console.error('[sgc/notificaciones]', e));
  return result;
}

/** Retira una entrada del alcance (solo ANTES de la divulgación; durante, se excluye a la persona). */
export async function removeScopeEntry(db: SgcDb, access: SgcCompanyAccess, idRequest: number, idScope: number, input: { reason?: unknown }, actor: SgcActor) {
  const reason = reasonOf(input.reason);
  const { request, disseminationStarted } = await loadForScope(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  const me = lower(actor.email);
  if (request.status !== 'abierta') throw new SgcError('La solicitud no está abierta: el alcance ya no cambia.', 409);
  if (disseminationStarted) throw new SgcError('La divulgación ya empezó: para dejar a alguien por fuera, Calidad excluye su lectura con justificación.', 409);
  if (!(access.canQuality || me === lower(request.elaborator_email))) throw new SgcError('Solo el elaborador o Aseguramiento de Calidad definen el alcance de divulgación.', 403);
  const row = await db.sgcDisseminationScope.findUnique({ where: { id_scope: idScope } });
  if (!row || row.id_request !== idRequest) throw new SgcError('Entrada del alcance no encontrada.', 404);
  if (!row.is_active) throw new SgcError('La entrada ya estaba retirada.', 409);
  await db.$transaction(async (tx) => {
    await tx.sgcDisseminationScope.update({ where: { id_scope: idScope }, data: { is_active: false, removed_by: me, removed_at: new Date(), remove_reason: reason } });
    await tx.sgcInteraction.create({ data: { id_request: idRequest, kind: 'estado', author_email: me, body: `Retiró del alcance de divulgación: ${row.scope_key}.\nMotivo: ${reason}`, meta_json: JSON.stringify({ scope: row.scope_key }) } });
    await writeSgcAudit(tx, { idCompany: request.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.alcanceRetirado, entity: 'dissemination_scope', entityId: idScope, before: { active: true, scope: row.scope_key }, after: { active: false }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lectura: archivo, avance (abrió / llegó al final)
// ---------------------------------------------------------------------------

async function loadMyRead(db: Db, idAssignee: number, email: string) {
  const rec = await db.sgcReadRecord.findUnique({
    where: { id_task_assignee: idAssignee },
    include: { request: { include: { document: true } }, task: true },
  });
  if (!rec || lower(rec.user_email) !== lower(email)) throw new SgcError('Lectura no encontrada.', 404);
  return rec;
}

/**
 * Versión que la persona debe leer (el PDF CONTROLADO de la solicitud). Deja
 * el registro de apertura (la primera vez fija «abrió»). Solo la persona
 * asignada; 409 si el PDF controlado aún no está listo.
 */
export async function openReadingFile(db: SgcDb, idAssignee: number, viewer: { email: string; access: readonly SgcCompanyAccess[] }, actor: SgcActor) {
  const rec = await loadMyRead(db, idAssignee, viewer.email);
  if (!viewer.access.some((a) => a.idCompany === rec.request.id_company && a.canRead)) throw new SgcError('Lectura no encontrada.', 404);
  // Sprint 6: la asignación de lectura no es un acceso permanente. Excluida = sin archivo; ya firmada,
  // solo mientras la divulgación siga abierta (después se consulta como cualquiera, por el listado maestro).
  if (rec.status === 'excluido') throw new SgcError('Lectura no encontrada.', 404);
  if (rec.status !== 'pendiente' && rec.task.status !== 'abierta') {
    throw new SgcError('La divulgación ya cerró: consulte el documento desde el listado maestro.', 409);
  }
  const idVersion = rec.request.id_document_version;
  if (!idVersion || rec.request.controlled_pdf_status !== 'generado') throw new SgcError('El PDF controlado de esta versión aún no está disponible. Intente más tarde.', 409);
  const version = await db.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: idVersion }, include: { document: true } });
  const now = new Date();
  if (rec.status === 'pendiente') {
    await db.sgcReadRecord.update({
      where: { id_read_record: rec.id_read_record },
      data: { id_document_version: idVersion, first_opened_at: rec.first_opened_at ?? now, last_opened_at: now, open_count: { increment: 1 } },
    });
  }
  await writeSgcAudit(db, { idCompany: rec.request.id_company, actorEmail: viewer.email, action: SGC_AUDIT_ACTIONS.lecturaAbierta, entity: 'read_record', entityId: rec.id_read_record, after: { idRequest: rec.id_request, idVersion, code: version.document.code, version: version.version_number }, ip: actor.ip, userAgent: actor.userAgent });
  return {
    itemId: version.pdf_item_id,
    sha256: version.pdf_sha256.trim(),
    code: version.document.code,
    versionNumber: version.version_number,
    state: version.status === 'vigente' ? ('vigente' as const) : version.status === 'obsoleto' ? ('obsoleto' as const) : version.status === 'anulado' ? ('anulado' as const) : ('divulgacion' as const),
  };
}

/**
 * Avance de lectura que informa el visor: «final» = la persona llegó al final
 * del documento (el visor lo detecta al desplazarse hasta la última página).
 * Se exige haber abierto el archivo desde el servidor antes. Solo la primera
 * vez queda la hora; es la condición del servidor para firmar «Leyó».
 */
export async function recordReadingEvent(db: SgcDb, idAssignee: number, raw: unknown, viewer: { email: string; access?: readonly SgcCompanyAccess[] }, actor: SgcActor) {
  const ev = normalizeReadingEvent(raw);
  const rec = await loadMyRead(db, idAssignee, viewer.email);
  // Sprint 6: quien perdió el acceso al SGC de la empresa ya no registra avance.
  if (viewer.access && !viewer.access.some((a) => a.idCompany === rec.request.id_company && a.canRead)) throw new SgcError('Lectura no encontrada.', 404);
  if (rec.status !== 'pendiente') return { status: rec.status, reachedEndAt: rec.reached_end_at?.toISOString() ?? null };
  if (!rec.first_opened_at) throw new SgcError('Abra el documento antes de registrar la lectura.', 409);
  if (ev.event === 'abierto' || rec.reached_end_at) return { status: rec.status, reachedEndAt: rec.reached_end_at?.toISOString() ?? null };
  const now = new Date();
  await db.sgcReadRecord.update({ where: { id_read_record: rec.id_read_record }, data: { reached_end_at: now, pages: ev.pages } });
  await writeSgcAudit(db, { idCompany: rec.request.id_company, actorEmail: viewer.email, action: SGC_AUDIT_ACTIONS.lecturaFinal, entity: 'read_record', entityId: rec.id_read_record, after: { idRequest: rec.id_request, pages: ev.pages, openedAt: rec.first_opened_at.toISOString() }, ip: actor.ip, userAgent: actor.userAgent });
  return { status: rec.status, reachedEndAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------------

/** Recordatorio a quienes aún no firman (Calidad). Queda la cuenta por persona y en la auditoría. */
export async function sendReadingReminders(db: SgcDb, notifier: SgcNotifier, access: SgcCompanyAccess, idRequest: number, actor: SgcActor) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad envía recordatorios de lectura.', 403);
  const { request, openDissemination } = await loadForScope(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  if (!openDissemination) throw new SgcError('La solicitud no está en divulgación.', 409);
  const pending = await db.sgcReadRecord.findMany({ where: { id_task: openDissemination.id_task, status: 'pendiente' } });
  if (pending.length === 0) return { sent: 0 };
  const now = new Date();
  const emails = pending.map((p) => lower(p.user_email));
  await db.$transaction(async (tx) => {
    await tx.sgcReadRecord.updateMany({ where: { id_read_record: { in: pending.map((p) => p.id_read_record) } }, data: { reminders_sent: { increment: 1 }, last_reminder_at: now } });
    await tx.sgcInteraction.create({ data: { id_request: idRequest, id_task: openDissemination.id_task, kind: 'estado', author_email: lower(actor.email), body: `Envió recordatorio de lectura a ${emails.length} persona(s): ${emails.join(', ')}.`.slice(0, 8000) } });
    await writeSgcAudit(tx, { idCompany: request.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.divulgacionRecordatorio, entity: 'task', entityId: openDissemination.id_task, after: { idRequest, emails }, ip: actor.ip, userAgent: actor.userAgent });
  });
  await notifier([{ emails: recipients(emails, actor.email), payload: { title: SGC_NOTIFICATION_TITLES.lecturaRecordatorio, body: `#${idRequest} · Tiene pendiente leer y firmar «Leído» — ${request.subject}`.slice(0, 300), url: taskUrl(openDissemination.id_task), tag: `sgc-task-${openDissemination.id_task}` } }]).catch((e) => console.error('[sgc/notificaciones]', e));
  return { sent: emails.length };
}

// ---------------------------------------------------------------------------
// Vista de la divulgación (para la solicitud)
// ---------------------------------------------------------------------------

export interface SgcDisseminationView {
  scope: { id: number; kind: SgcScopeKind; kindLabel: string; label: string; addedBy: string; addedAt: string; reason: string | null }[];
  scopeHistory: { id: number; label: string; isActive: boolean; addedBy: string; addedAt: string; removedBy: string | null; removedAt: string | null; removeReason: string | null }[];
  readers: {
    id: number;
    idAssignee: number;
    email: string;
    name: string | null;
    sources: string[];
    status: SgcReadStatus;
    statusLabel: string;
    assignedAt: string;
    openedAt: string | null;
    reachedEndAt: string | null;
    signedAt: string | null;
    remindersSent: number;
    excludeReason: string | null;
  }[];
  withoutAccess: string[];
  coverage: ReturnType<typeof summarizeCoverage>;
  started: boolean;
  open: boolean;
  idTask: number | null;
  canEditScope: boolean;
  canRemoveScope: boolean;
  canManage: boolean;
}

export async function getDisseminationView(
  db: SgcDb,
  request: { id_request: number; id_company: number; status: string; elaborator_email: string; tasks: { id_task: number; status: string; taskDef: { assignment: string } }[] },
  viewer: { email: string; isQuality: boolean },
  names: (email: string | null) => string | null
): Promise<SgcDisseminationView> {
  const rows = await db.sgcDisseminationScope.findMany({ where: { id_request: request.id_request }, orderBy: { id_scope: 'asc' } });
  const dTasks = request.tasks.filter((t) => t.taskDef.assignment === 'alcance');
  const current = dTasks.at(-1) ?? null;
  const records = current ? await db.sgcReadRecord.findMany({ where: { id_task: current.id_task }, orderBy: { user_email: 'asc' } }) : [];
  const deptIds = [...new Set(rows.map((r) => r.id_department).filter((x): x is number => !!x))];
  const cargoIds = [...new Set(rows.map((r) => r.id_cargo).filter((x): x is number => !!x))];
  const [depts, cargos] = await Promise.all([
    deptIds.length ? db.department.findMany({ where: { id_department: { in: deptIds } }, select: { id_department: true, department: true } }) : [],
    cargoIds.length ? db.cargo.findMany({ where: { id_cargo: { in: cargoIds } }, select: { id_cargo: true, nombre_normalizado: true } }) : [],
  ]);
  const deptName = new Map(depts.map((d) => [d.id_department, d.department]));
  const cargoName = new Map(cargos.map((c) => [c.id_cargo, c.nombre_normalizado]));
  const labelOf = (r: { kind: string; id_department: number | null; id_cargo: number | null; user_email: string | null }) =>
    r.kind === 'empresa'
      ? 'Toda la empresa (personas con acceso al SGC)'
      : r.kind === 'departamento'
        ? `Departamento: ${deptName.get(r.id_department!) ?? r.id_department}`
        : r.kind === 'cargo'
          ? `Cargo: ${cargoName.get(r.id_cargo!) ?? r.id_cargo}`
          : `Persona: ${names(r.user_email) ?? r.user_email} (${r.user_email})`;
  const active = rows.filter((r) => r.is_active);
  const entries = active.map(toEntry);
  const dir = await buildScopeDirectory(db, request.id_company, entries);
  const { withoutAccess } = resolveReaders(entries, dir);
  const isOpen = request.status === 'abierta';
  const started = dTasks.length > 0;
  const openTask = current && current.status === 'abierta' ? current : null;
  const isElaborator = lower(viewer.email) === lower(request.elaborator_email);
  return {
    scope: active.map((r) => ({ id: r.id_scope, kind: r.kind as SgcScopeKind, kindLabel: SGC_SCOPE_KIND_LABELS[r.kind as SgcScopeKind] ?? r.kind, label: labelOf(r), addedBy: names(r.added_by) ?? r.added_by, addedAt: r.added_at.toISOString(), reason: r.change_reason })),
    scopeHistory: rows.map((r) => ({ id: r.id_scope, label: labelOf(r), isActive: r.is_active, addedBy: r.added_by, addedAt: r.added_at.toISOString(), removedBy: r.removed_by, removedAt: r.removed_at?.toISOString() ?? null, removeReason: r.remove_reason })),
    readers: records.map((r) => ({
      id: r.id_read_record,
      idAssignee: r.id_task_assignee,
      email: r.user_email,
      name: names(r.user_email),
      // Lo escribe el propio SGC al asignar la lectura (JSON válido).
      sources: JSON.parse(r.sources_json) as string[],
      status: r.status as SgcReadStatus,
      statusLabel: SGC_READ_STATUS_LABELS[r.status as SgcReadStatus] ?? r.status,
      assignedAt: r.assigned_at.toISOString(),
      openedAt: r.first_opened_at?.toISOString() ?? null,
      reachedEndAt: r.reached_end_at?.toISOString() ?? null,
      signedAt: r.signed_at?.toISOString() ?? null,
      remindersSent: r.reminders_sent,
      excludeReason: r.exclude_reason,
    })),
    withoutAccess: withoutAccess.map((w) => w.email),
    coverage: summarizeCoverage(records.map((r) => ({ status: r.status as SgcReadStatus, openedAt: r.first_opened_at, reachedEndAt: r.reached_end_at, signedAt: r.signed_at }))),
    started,
    open: Boolean(openTask),
    idTask: current?.id_task ?? null,
    canEditScope: isOpen && (started ? Boolean(openTask) && viewer.isQuality : viewer.isQuality || isElaborator),
    canRemoveScope: isOpen && !started && (viewer.isQuality || isElaborator),
    canManage: Boolean(openTask) && viewer.isQuality,
  };
}

/** Lectura de la persona en una tarea de divulgación (para su vista de la tarea). */
export async function getMyReading(db: SgcDb, idTask: number, email: string) {
  const rec = await db.sgcReadRecord.findFirst({ where: { id_task: idTask, user_email: lower(email) }, include: { request: true } });
  if (!rec) return null;
  const pdfReady = Boolean(rec.request.id_document_version && rec.request.controlled_pdf_status === 'generado');
  const version = pdfReady ? await db.sgcDocumentVersion.findUnique({ where: { id_document_version: rec.request.id_document_version! }, include: { document: { select: { code: true, title: true } } } }) : null;
  return {
    // Lo que se firma con «Leyó»: el PDF controlado de la versión (su SHA-256 registrado).
    content: version ? { ref: `version:${version.id_document_version}`, name: version.pdf_file_name, sha256: version.pdf_sha256.trim() } : null,
    document: version ? { code: version.document.code, title: version.document.title, versionNumber: version.version_number } : null,
    idReadRecord: rec.id_read_record,
    idAssignee: rec.id_task_assignee,
    status: rec.status as SgcReadStatus,
    statusLabel: SGC_READ_STATUS_LABELS[rec.status as SgcReadStatus] ?? rec.status,
    openedAt: rec.first_opened_at?.toISOString() ?? null,
    reachedEndAt: rec.reached_end_at?.toISOString() ?? null,
    signedAt: rec.signed_at?.toISOString() ?? null,
    excludeReason: rec.exclude_reason,
    pdfReady,
    fileUrl: pdfReady ? `/api/sgc/reading/${rec.id_task_assignee}/file` : null,
  };
}
