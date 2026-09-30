import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { authorizationStatusFor } from '../authorizations';
import { SGC_SUBPROCESS_URLS } from '../constants';
import { SgcError } from '../errors';
import { SGC_SIGNATURE_LABELS, type SgcFlowDefinition, type SgcTaskDefinition } from '../flows/definition';
import { SGC_DOCUMENT_FLOW_CODE, SGC_DOCUMENT_REQUEST_TYPE_LABELS, isSgcDocumentRequestType } from '../flows/documentFlow';
import {
  SGC_ASSIGNEE_STATUS_LABELS,
  SGC_REQUEST_STATUS_LABELS,
  SGC_TASK_STATUS_LABELS,
  assigneesInTurn,
  firstTask,
  normalizeSigners,
  parseSigningModes,
  pickAssigneeForDecision,
  planSignerChange,
  resolveNextStep,
  signingModeFor,
  taskOutcome,
  type SgcAssigneeState,
  type SgcAssigneeStatus,
  type SgcRequestStatus,
  type SgcTaskStatus,
} from '../flows/engine';
import { SGC_NOTIFICATION_TITLES, recipients, requestUrl, taskUrl, type SgcNotification, type SgcNotifier } from '../notifications';
import type { SgcCompanyAccess } from '../permissions';
import { SGC_SIGNATURE_STUB_NOTICE, describeSignaturePoint, signaturePointFor } from '../signature/signaturePoint';
import { sha256Hex } from '../storage';
import { getPoolMembers, getPoolTypeCodes } from './authorizations';
import type { SgcActor, SgcDb } from './catalogs';
import type { SgcUploader } from './documents';
import { getCurrentFlowVersion, loadDefinition } from './flows';

/**
 * Solicitudes y «Tareas documentales» del SGC (Sprint 2): instancias del
 * motor de flujos validados sobre tablas propias (sgc.request, sgc.task,
 * sgc.task_assignee, sgc.interaction…). COPIA CONGELADA del comportamiento de
 * la vista interna de solicitudes de SynerLink (historial de interacciones,
 * tareas con responsable, reasignación, adjuntos, información adicional),
 * sin tocar las tablas de solicitudes generales.
 *
 * Toda acción corre en una transacción que primero bloquea la fila de la
 * solicitud (dos firmas en paralelo no pueden adelantar el flujo dos veces) y
 * deja rastro en el historial propio y en sgc.audit_log. Las notificaciones
 * se envían DESPUÉS de confirmar la transacción.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTS = { maxWait: 10_000, timeout: 30_000 } as const;

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DRAFT_EXT = /\.(docx|doc|pdf)$/i;

function text(value: unknown, label: string, max: number, min = 1): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new SgcError(min > 1 ? `${label} es obligatorio (mínimo ${min} caracteres).` : `${label} es obligatorio.`);
  if (s.length > max) throw new SgcError(`${label} admite máximo ${max} caracteres.`);
  return s;
}

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Personas habilitadas y nombres
// ---------------------------------------------------------------------------

/** Personas con permiso de gestión o Calidad del SGC en la empresa (elegibles como firmantes). */
export async function listEligibleUsers(db: SgcDb | Tx, idCompany: number): Promise<{ email: string; name: string | null }[]> {
  const rows = await db.subprocessUserCompany.findMany({
    where: {
      subprocess: { subprocess_url: { in: [SGC_SUBPROCESS_URLS.gestion, SGC_SUBPROCESS_URLS.calidad] } },
      companyUser: { company: { id_company: idCompany }, user: { isActive: true } },
    },
    select: { companyUser: { select: { user: { select: { email: true, name: true } } } } },
  });
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(lower(r.companyUser.user.email), r.companyUser.user.name);
  return [...map.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'es'));
}

async function namesFor(db: SgcDb | Tx, emails: Iterable<string | null | undefined>): Promise<Map<string, string | null>> {
  const list = [...new Set([...emails].map(lower).filter(Boolean))];
  if (list.length === 0) return new Map();
  const users = await db.user.findMany({ where: { email: { in: list } }, select: { email: true, name: true } });
  return new Map(users.map((u) => [lower(u.email), u.name]));
}

// ---------------------------------------------------------------------------
// Núcleo del motor: activar la tarea de un paso
// ---------------------------------------------------------------------------

type RequestRow = Prisma.SgcRequestGetPayload<{ include: { documentType: true } }>;

interface EngineCtx {
  tx: Tx;
  request: RequestRow;
  def: SgcFlowDefinition;
  notifications: SgcNotification[];
  actor: SgcActor;
  subjectLabel: string;
}

async function addInteraction(
  tx: Tx,
  idRequest: number,
  kind: string,
  author: string,
  body: string,
  opts: { idTask?: number | null; meta?: unknown; notifyEmails?: string[] } = {}
) {
  await tx.sgcInteraction.create({
    data: {
      id_request: idRequest,
      id_task: opts.idTask ?? null,
      kind,
      author_email: author,
      body: body.slice(0, 8000),
      meta_json: opts.meta === undefined ? null : JSON.stringify(opts.meta),
      notify_emails: opts.notifyEmails?.length ? opts.notifyEmails.join('; ').slice(0, 2000) : null,
    },
  });
}

/**
 * Crea la tarea de un paso con sus responsables según la definición:
 * solicitante, elaborador, firmantes configurados por el elaborador (+ el
 * cupo del grupo de verificación, al final) o el grupo de Calidad. Si el paso
 * está deshabilitado en el motor, queda «en espera» sin responsables.
 */
async function activateTask(ctx: EngineCtx, taskDef: SgcTaskDefinition, round: number): Promise<void> {
  const { tx, request } = ctx;
  const flowTaskDef = await tx.sgcFlowTaskDef.findUnique({
    where: { id_flow_version_task_key: { id_flow_version: request.id_flow_version, task_key: taskDef.key } },
  });
  if (!flowTaskDef) throw new SgcError('La definición del flujo no tiene esa tarea.', 500);
  const now = new Date();

  if (!taskDef.isEnabled) {
    const task = await tx.sgcTask.create({
      data: { id_request: request.id_request, id_flow_task_def: flowTaskDef.id_flow_task_def, task_key: taskDef.key, name: taskDef.name, step_order: taskDef.stepOrder, round, status: 'en_espera', started_at: now },
    });
    await tx.sgcRequest.update({ where: { id_request: request.id_request }, data: { status: 'en_espera', current_task_key: taskDef.key } });
    await addInteraction(tx, request.id_request, 'sistema', ctx.actor.email, `La solicitud llegó a «${taskDef.name}». Este paso está definido en el flujo, pero el sistema aún no lo ejecuta (se habilita en el Sprint 4): la solicitud queda en espera.`, { idTask: task.id_task });
    ctx.notifications.push({
      emails: recipients([request.requester_email, request.elaborator_email], ctx.actor.email),
      payload: { title: SGC_NOTIFICATION_TITLES.avance, body: `#${request.id_request} · ${taskDef.name} — ${ctx.subjectLabel}`, url: requestUrl(request.id_request), tag: `sgc-request-${request.id_request}` },
    });
    return;
  }

  const modes = parseSigningModes(request.signing_modes_json);
  const mode = signingModeFor(taskDef, modes);
  const point = signaturePointFor(taskDef.signatureMeaning);
  const slots: { userEmail: string | null; poolTypeCode: string | null; order: number }[] = [];
  if (taskDef.assignment === 'solicitante') slots.push({ userEmail: lower(request.requester_email), poolTypeCode: null, order: 1 });
  else if (taskDef.assignment === 'elaborador') slots.push({ userEmail: lower(request.elaborator_email), poolTypeCode: null, order: 1 });
  else if (taskDef.assignment === 'firmantes') {
    const signers = await tx.sgcRequestSigner.findMany({ where: { id_request: request.id_request, step_key: taskDef.key, is_active: true }, orderBy: { sign_order: 'asc' } });
    if (signers.length === 0) throw new SgcError(`Falta asignar los firmantes de «${taskDef.name}».`, 409);
    signers.forEach((s, i) => slots.push({ userEmail: lower(s.user_email), poolTypeCode: null, order: i + 1 }));
  }
  if (taskDef.poolAuthorizationTypeCode) slots.push({ userEmail: null, poolTypeCode: taskDef.poolAuthorizationTypeCode, order: slots.length + 1 });
  if (slots.length === 0) throw new SgcError(`La tarea «${taskDef.name}» no tiene responsables.`, 500);

  const task = await tx.sgcTask.create({
    data: {
      id_request: request.id_request,
      id_flow_task_def: flowTaskDef.id_flow_task_def,
      task_key: taskDef.key,
      name: taskDef.name,
      step_order: taskDef.stepOrder,
      round,
      status: 'abierta',
      signing_mode: mode,
      started_at: now,
    },
  });
  const typeIds = new Map<string, number>();
  for (const code of [taskDef.authorizationTypeCode, taskDef.poolAuthorizationTypeCode].filter((c): c is string => !!c)) {
    const t = await tx.sgcAuthorizationType.findUnique({ where: { id_company_code: { id_company: request.id_company, code } } });
    if (!t || !t.is_active) throw new SgcError(`El tipo de autorización ${code} no existe o está inactivo en la empresa.`, 409);
    typeIds.set(code, t.id_authorization_type);
  }
  const created: SgcAssigneeState[] = [];
  for (const s of slots) {
    const a = await tx.sgcTaskAssignee.create({
      data: { id_task: task.id_task, user_email: s.userEmail, pool_type_code: s.poolTypeCode, sign_order: s.order, status: 'pendiente', signature_status: point.signatureStatus, signature_meaning: point.signatureMeaning },
    });
    created.push({ id: a.id_task_assignee, userEmail: s.userEmail, poolTypeCode: s.poolTypeCode, signOrder: s.order, status: 'pendiente' });
    const authType = s.poolTypeCode ?? (taskDef.isAuthorization ? taskDef.authorizationTypeCode : null);
    if (authType) {
      await tx.sgcAuthorization.create({
        data: { id_company: request.id_company, id_authorization_type: typeIds.get(authType)!, id_request: request.id_request, id_task_assignee: a.id_task_assignee, assigned_email: s.userEmail, status: 'pendiente' },
      });
    }
  }
  await tx.sgcRequest.update({ where: { id_request: request.id_request }, data: { current_task_key: taskDef.key, status: 'abierta' } });
  const who = slots.map((s) => s.userEmail ?? `grupo ${s.poolTypeCode}`).join(', ');
  const modeText = mode ? ` · firma ${mode === 'orden' ? 'en orden' : 'en paralelo'}` : '';
  await addInteraction(tx, request.id_request, 'estado', ctx.actor.email, `Tarea «${taskDef.name}»${round > 1 ? ` (ronda ${round})` : ''} asignada a: ${who}${modeText}.`, { idTask: task.id_task });
  await notifyTurn(ctx, task.id_task, taskDef, created, mode);
}

/** Notifica a quienes les toca (personas y, si es un cupo de grupo, a su grupo). */
async function notifyTurn(ctx: EngineCtx, idTask: number, taskDef: { name: string; isAuthorization: boolean }, assignees: SgcAssigneeState[], mode: 'orden' | 'paralelo' | null) {
  const turn = assigneesInTurn(assignees, mode);
  const people = recipients(turn.map((a) => a.userEmail), ctx.actor.email);
  const body = `#${ctx.request.id_request} · ${taskDef.name} — ${ctx.subjectLabel}`;
  if (people.length) {
    ctx.notifications.push({ emails: people, payload: { title: taskDef.isAuthorization ? SGC_NOTIFICATION_TITLES.autorizacionPendiente : SGC_NOTIFICATION_TITLES.tareaAsignada, body, url: taskUrl(idTask), tag: `sgc-task-${idTask}` } });
  }
  for (const code of new Set(turn.filter((a) => !a.userEmail && a.poolTypeCode).map((a) => a.poolTypeCode!))) {
    const members = recipients(await getPoolMembers(ctx.tx, ctx.request.id_company, code), ctx.actor.email);
    if (members.length) ctx.notifications.push({ emails: members, payload: { title: SGC_NOTIFICATION_TITLES.autorizacionPendiente, body, url: '/process/sgc-documental/autorizaciones', tag: `sgc-task-${idTask}-grupo` } });
  }
}

async function lockRequest(tx: Tx, idRequest: number): Promise<RequestRow> {
  // El UPDATE toma el bloqueo exclusivo de la fila hasta el COMMIT.
  await tx.sgcRequest.update({ where: { id_request: idRequest }, data: { updated_at: new Date() } }).catch(() => {
    throw new SgcError('Solicitud no encontrada.', 404);
  });
  return tx.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest }, include: { documentType: true } });
}

async function send(notifier: SgcNotifier, notifications: SgcNotification[]) {
  const real = notifications.filter((n) => n.emails.length > 0);
  if (real.length) await notifier(real).catch((e) => console.error('[sgc/notificaciones]', e));
}

// ---------------------------------------------------------------------------
// Crear una solicitud documental
// ---------------------------------------------------------------------------

export interface SgcCreateRequestInput {
  idCompany: number;
  flowCode?: string;
  requestType: unknown;
  subject: unknown;
  description: unknown;
  idDocument?: unknown;
  idProcess?: unknown;
  idDocumentType?: unknown;
  elaboratorEmail?: unknown;
  formValues?: Record<string, unknown>;
}

function validateFieldValue(field: SgcFlowDefinition['formFields'][number], raw: unknown): string | null {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    if (field.required) throw new SgcError(`«${field.label}» es obligatorio.`);
    return null;
  }
  const value = String(raw).trim();
  if (value.length > 4000) throw new SgcError(`«${field.label}» admite máximo 4000 caracteres.`);
  switch (field.type) {
    case 'numero':
      if (!Number.isFinite(Number(value))) throw new SgcError(`«${field.label}» debe ser un número.`);
      break;
    case 'fecha':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new SgcError(`«${field.label}» debe ser una fecha AAAA-MM-DD.`);
      break;
    case 'seleccion':
      if (!field.options.includes(value)) throw new SgcError(`«${field.label}»: opción no permitida.`);
      break;
    case 'si_no':
      if (value !== 'si' && value !== 'no') throw new SgcError(`«${field.label}» debe ser sí o no.`);
      break;
    case 'texto':
      if (value.length > 300) throw new SgcError(`«${field.label}» admite máximo 300 caracteres.`);
      break;
  }
  return value;
}

async function saveFieldValues(tx: Tx, idRequest: number, idFlowVersion: number, fields: SgcFlowDefinition['formFields'], values: Record<string, unknown>, actor: string, partial: boolean) {
  const rows = await tx.sgcFlowFormField.findMany({ where: { id_flow_version: idFlowVersion } });
  const idOf = new Map(rows.map((r) => [`${r.task_key ?? ''}:${r.field_key}`, r.id_flow_form_field]));
  const saved: Record<string, string | null> = {};
  for (const f of fields) {
    if (partial && !(f.key in values)) continue;
    const value = validateFieldValue(f, values[f.key]);
    const id = idOf.get(`${f.taskKey ?? ''}:${f.key}`)!;
    await tx.sgcFormValue.upsert({
      where: { id_request_id_flow_form_field: { id_request: idRequest, id_flow_form_field: id } },
      create: { id_request: idRequest, id_flow_form_field: id, value_text: value, updated_by: actor },
      update: { value_text: value, updated_by: actor },
    });
    saved[f.key] = value;
  }
  return saved;
}

export async function createRequest(db: SgcDb, notifier: SgcNotifier, access: SgcCompanyAccess, input: SgcCreateRequestInput, actor: SgcActor) {
  if (!access.canManage && !access.canQuality) throw new SgcError('Solo quien gestiona documentos del SGC puede crear una solicitud documental.', 403);
  const idCompany = input.idCompany;
  if (!isSgcDocumentRequestType(input.requestType)) throw new SgcError('Tipo de solicitud inválido.');
  const requestType = input.requestType;
  const subject = text(input.subject, 'El asunto', 300, 5);
  const description = text(input.description, 'La justificación', 4000, 10);
  const elaborator = lower(typeof input.elaboratorEmail === 'string' && input.elaboratorEmail.trim() ? input.elaboratorEmail : actor.email);
  const eligible = new Set((await listEligibleUsers(db, idCompany)).map((u) => u.email));
  if (!eligible.has(elaborator)) throw new SgcError(`${elaborator} no tiene permiso de gestión documental en el SGC de esta empresa.`);

  let idDocument: number | null = null;
  let idProcess: number | null = null;
  let idDocumentType: number | null = null;
  if (requestType === 'nuevo') {
    idProcess = Number(input.idProcess);
    idDocumentType = Number(input.idDocumentType);
    const [proc, type] = await Promise.all([
      Number.isInteger(idProcess) ? db.sgcProcessMap.findFirst({ where: { id_process_map: idProcess, id_company: idCompany, is_active: true } }) : null,
      Number.isInteger(idDocumentType) ? db.sgcDocumentType.findFirst({ where: { id_document_type: idDocumentType, id_company: idCompany, is_active: true } }) : null,
    ]);
    if (!proc) throw new SgcError('Seleccione un proceso activo de la empresa.');
    if (!type) throw new SgcError('Seleccione un tipo documental activo de la empresa.');
  } else {
    idDocument = Number(input.idDocument);
    const doc = Number.isInteger(idDocument) ? await db.sgcDocument.findFirst({ where: { id_document: idDocument, id_company: idCompany } }) : null;
    if (!doc) throw new SgcError('Seleccione el documento vigente sobre el que se hace la solicitud.');
    if (doc.status !== 'vigente') throw new SgcError('Solo se pide una nueva versión o modificación de un documento VIGENTE.', 409);
    const open = await db.sgcRequest.findFirst({ where: { id_document: idDocument, status: { in: ['abierta', 'en_espera'] } } });
    if (open) throw new SgcError(`El documento ya tiene la solicitud #${open.id_request} en curso.`, 409);
    idProcess = doc.id_process_map;
    idDocumentType = doc.id_document_type;
  }

  const { process, version } = await getCurrentFlowVersion(db, idCompany, input.flowCode ?? SGC_DOCUMENT_FLOW_CODE);
  const def = await loadDefinition(db, version.id_flow_version);
  const requestFields = def.formFields.filter((f) => f.taskKey === null);
  for (const f of requestFields) validateFieldValue(f, input.formValues?.[f.key]);
  const notifications: SgcNotification[] = [];

  const result = await db.$transaction(async (tx) => {
    const created = await tx.sgcRequest.create({
      data: {
        id_company: idCompany,
        id_flow_process: process.id_flow_process,
        id_flow_version: version.id_flow_version,
        request_type: requestType,
        subject,
        description,
        id_document: idDocument,
        id_process_map: idProcess,
        id_document_type: idDocumentType,
        requester_email: lower(actor.email),
        elaborator_email: elaborator,
        status: 'abierta',
      },
    });
    const request = await tx.sgcRequest.findUniqueOrThrow({ where: { id_request: created.id_request }, include: { documentType: true } });
    await saveFieldValues(tx, request.id_request, version.id_flow_version, requestFields, input.formValues ?? {}, actor.email, false);
    const ctx: EngineCtx = { tx, request, def, notifications, actor, subjectLabel: subject };
    const start = firstTask(def);
    const startDef = await tx.sgcFlowTaskDef.findUniqueOrThrow({ where: { id_flow_version_task_key: { id_flow_version: version.id_flow_version, task_key: start.key } } });
    const now = new Date();
    const startTask = await tx.sgcTask.create({
      data: { id_request: request.id_request, id_flow_task_def: startDef.id_flow_task_def, task_key: start.key, name: start.name, step_order: start.stepOrder, status: 'resuelta', started_at: now, ended_at: now, resolved_by: lower(actor.email), resolution: 'Solicitud registrada.' },
    });
    await addInteraction(tx, request.id_request, 'estado', actor.email, `Solicitud documental creada (${SGC_DOCUMENT_REQUEST_TYPE_LABELS[requestType]}). Flujo «${process.name}» versión ${version.version_number}.`, { idTask: startTask.id_task });
    const next = resolveNextStep(def, start.key, 'aprobar', { requestType, requiresTraining: request.documentType?.requires_training ?? true });
    if (next.kind === 'task') await activateTask(ctx, next.task, 1);
    await writeSgcAudit(tx, {
      idCompany,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.solicitudCreada,
      entity: 'request',
      entityId: request.id_request,
      after: { requestType, subject, idDocument, idProcess, idDocumentType, elaborator, flowVersion: version.version_number },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { idRequest: request.id_request };
  }, TX_OPTS);
  await send(notifier, notifications);
  return result;
}

// ---------------------------------------------------------------------------
// Decidir una tarea (aprobar / devolver); también desde Autorizaciones SGC
// ---------------------------------------------------------------------------

export interface SgcDecisionInput {
  decision: unknown;
  comment?: unknown;
  /** Si llega desde Autorizaciones SGC: el cupo exacto que se decide. */
  idAssignee?: number | null;
}

function toAssigneeState(a: { id_task_assignee: number; user_email: string | null; pool_type_code: string | null; sign_order: number; status: string }): SgcAssigneeState {
  return { id: a.id_task_assignee, userEmail: a.user_email, poolTypeCode: a.pool_type_code, signOrder: a.sign_order, status: a.status as SgcAssigneeStatus };
}

async function assertReadyToSubmit(tx: Tx, request: RequestRow, def: SgcFlowDefinition, taskKey: string) {
  const drafts = await tx.sgcAttachment.count({ where: { id_request: request.id_request, purpose: 'borrador', withdrawn_at: null } });
  if (drafts === 0) throw new SgcError('Cargue el borrador del documento (Word o PDF) antes de enviarlo.', 409);
  for (const t of def.tasks.filter((x) => x.assignment === 'firmantes' && x.isEnabled)) {
    const n = await tx.sgcRequestSigner.count({ where: { id_request: request.id_request, step_key: t.key, is_active: true } });
    if (n === 0) throw new SgcError(`Asigne los firmantes de «${t.name}» antes de enviar el documento.`, 409);
  }
  const fields = def.formFields.filter((f) => f.taskKey === taskKey && f.required);
  if (fields.length) {
    const values = await tx.sgcFormValue.findMany({ where: { id_request: request.id_request, field: { task_key: taskKey } }, include: { field: true } });
    const have = new Set(values.filter((v) => v.value_text).map((v) => v.field.field_key));
    const missing = fields.filter((f) => !have.has(f.key));
    if (missing.length) throw new SgcError(`Complete: ${missing.map((f) => `«${f.label}»`).join(', ')}.`, 409);
  }
}

export async function decideTask(db: SgcDb, notifier: SgcNotifier, idTask: number, input: SgcDecisionInput, actor: SgcActor) {
  const decision = input.decision === 'aprobar' || input.decision === 'devolver' ? input.decision : null;
  if (!decision) throw new SgcError('Decisión inválida: aprobar o devolver.');
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 2000) : '';
  if (decision === 'devolver' && comment.length < 5) throw new SgcError('Escriba las observaciones de la devolución (mínimo 5 caracteres).');
  const me = lower(actor.email);
  const head = await db.sgcTask.findUnique({ where: { id_task: idTask }, select: { id_request: true } });
  if (!head) throw new SgcError('Tarea no encontrada.', 404);
  const notifications: SgcNotification[] = [];

  const result = await db.$transaction(async (tx) => {
    const request = await lockRequest(tx, head.id_request);
    const task = await tx.sgcTask.findUniqueOrThrow({ where: { id_task: idTask }, include: { assignees: true, taskDef: true } });
    if (request.status !== 'abierta') throw new SgcError('La solicitud no está abierta.', 409);
    if (task.status !== 'abierta') throw new SgcError('Esta tarea ya no está abierta.', 409);
    const def = await loadDefinition(tx, request.id_flow_version);
    const taskDef = def.tasks.find((t) => t.key === task.task_key);
    if (!taskDef) throw new SgcError('La tarea no existe en la versión del flujo.', 500);
    const pools = await getPoolTypeCodes(tx, request.id_company, me);
    const states = task.assignees.map(toAssigneeState);
    const chosen = pickAssigneeForDecision(states, (task.signing_mode as 'orden' | 'paralelo' | null) ?? null, { email: me, poolTypeCodes: pools }, {
      elaboratorEmail: request.elaborator_email,
      allowElaborator: taskDef.assignment === 'solicitante' || taskDef.assignment === 'elaborador',
    });
    if (input.idAssignee && input.idAssignee !== chosen.id) {
      throw new SgcError('Esa autorización no es la que le corresponde decidir ahora (firma en orden).', 409);
    }
    // Las condiciones previas de «enviar» se validan antes de registrar la decisión.
    if (!def.transitions.some((t) => t.from === task.task_key && t.action === decision)) {
      throw new SgcError(decision === 'devolver' ? 'Esta tarea no se puede devolver.' : 'Esta tarea no tiene a dónde avanzar.', 409);
    }
    const isSubmit = taskDef.assignment === 'elaborador' && decision === 'aprobar';
    if (isSubmit) await assertReadyToSubmit(tx, request, def, task.task_key);

    const now = new Date();
    const assignee = task.assignees.find((a) => a.id_task_assignee === chosen.id)!;
    await tx.sgcTaskAssignee.update({
      where: { id_task_assignee: chosen.id },
      data: { status: decision === 'aprobar' ? 'aprobado' : 'devuelto', decided_by: me, decided_at: now, comment: comment || null },
    });
    await tx.sgcAuthorization.updateMany({
      where: { id_task_assignee: chosen.id, status: 'pendiente' },
      data: { status: authorizationStatusFor(decision), decided_by: me, decided_at: now, decision_comment: comment || null },
    });
    const signText = describeSignaturePoint(assignee.signature_meaning, assignee.signature_status);
    const verb = isSubmit ? 'Envió el documento' : decision === 'aprobar' ? 'Aprobó' : 'Devolvió a elaboración';
    const slotText = assignee.pool_type_code && !assignee.user_email ? ` como integrante del grupo ${assignee.pool_type_code}` : '';
    await addInteraction(tx, request.id_request, decision === 'devolver' ? 'devolucion' : 'decision', me, `${verb} en «${task.name}»${slotText}.${comment ? `\n${decision === 'devolver' ? 'Observaciones' : 'Comentario'}: ${comment}` : ''}${signText ? `\nPunto de firma: ${signText}.` : ''}`, {
      idTask,
      meta: { decision, idAssignee: chosen.id, signature: { meaning: assignee.signature_meaning, status: assignee.signature_status } },
    });

    const after = task.assignees.map((a) => (a.id_task_assignee === chosen.id ? { ...toAssigneeState(a), status: (decision === 'aprobar' ? 'aprobado' : 'devuelto') as SgcAssigneeStatus } : toAssigneeState(a)));
    const outcome = taskOutcome(after);
    const ctx: EngineCtx = { tx, request, def, notifications, actor, subjectLabel: request.subject };
    const condition = { requestType: request.request_type, requiresTraining: request.documentType?.requires_training ?? true };
    let next: string = task.task_key;

    if (outcome === 'abierta') {
      await notifyTurn(ctx, idTask, taskDef, after, (task.signing_mode as 'orden' | 'paralelo' | null) ?? null);
    } else if (outcome === 'resuelta') {
      await tx.sgcTask.update({ where: { id_task: idTask }, data: { status: 'resuelta', ended_at: now, resolved_by: me, resolution: comment || `${task.name} aprobada.` } });
      const step = resolveNextStep(def, task.task_key, 'aprobar', condition);
      if (step.kind === 'task') {
        await activateTask(ctx, step.task, 1);
        next = step.task.key;
      } else {
        await tx.sgcRequest.update({ where: { id_request: request.id_request }, data: { status: step.status, current_task_key: null, closed_by: me, closed_at: now } });
        await addInteraction(tx, request.id_request, 'estado', me, `Solicitud cerrada: ${SGC_REQUEST_STATUS_LABELS[step.status]}.`);
        next = step.status;
      }
    } else {
      // Devuelta: los demás cupos pendientes se anulan y se reabre la tarea destino en una ronda nueva.
      await tx.sgcTask.update({ where: { id_task: idTask }, data: { status: 'devuelta', ended_at: now, resolved_by: me, resolution: comment } });
      const pendingIds = task.assignees.filter((a) => a.status === 'pendiente' && a.id_task_assignee !== chosen.id).map((a) => a.id_task_assignee);
      if (pendingIds.length) {
        await tx.sgcTaskAssignee.updateMany({ where: { id_task_assignee: { in: pendingIds } }, data: { status: 'anulado' } });
        await tx.sgcAuthorization.updateMany({ where: { id_task_assignee: { in: pendingIds }, status: 'pendiente' }, data: { status: 'anulada' } });
      }
      const step = resolveNextStep(def, task.task_key, 'devolver', condition);
      if (step.kind !== 'task') throw new SgcError('La definición no indica a dónde se devuelve.', 500);
      const round = (await tx.sgcTask.count({ where: { id_request: request.id_request, task_key: step.task.key } })) + 1;
      await activateTask(ctx, step.task, round);
      next = step.task.key;
      ctx.notifications.push({
        emails: recipients([request.elaborator_email, request.requester_email], me),
        payload: { title: SGC_NOTIFICATION_TITLES.devuelta, body: `#${request.id_request} · ${task.name} — ${comment}`.slice(0, 400), url: requestUrl(request.id_request), tag: `sgc-request-${request.id_request}` },
      });
    }
    await writeSgcAudit(tx, {
      idCompany: request.id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.tareaDecision,
      entity: 'task',
      entityId: idTask,
      before: { status: 'abierta', assignee: chosen.id },
      after: { decision, outcome, next, signature: assignee.signature_status },
      detail: comment || null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { outcome, next, idRequest: request.id_request };
  }, TX_OPTS);
  await send(notifier, notifications);
  return result;
}

// ---------------------------------------------------------------------------
// Firmantes (revisores/aprobadores): los asigna y cambia el ELABORADOR
// ---------------------------------------------------------------------------

export interface SgcSignersInput {
  stepKey: unknown;
  signers: unknown;
  mode?: unknown;
  reason?: unknown;
}

export async function setSigners(db: SgcDb, notifier: SgcNotifier, idRequest: number, input: SgcSignersInput, actor: SgcActor) {
  const me = lower(actor.email);
  const stepKey = typeof input.stepKey === 'string' ? input.stepKey : '';
  const notifications: SgcNotification[] = [];
  const result = await db.$transaction(async (tx) => {
    const request = await lockRequest(tx, idRequest);
    if (request.status !== 'abierta') throw new SgcError('La solicitud no está abierta.', 409);
    if (lower(request.elaborator_email) !== me) throw new SgcError('Solo el elaborador asigna o cambia a los revisores y aprobadores.', 403);
    const def = await loadDefinition(tx, request.id_flow_version);
    const stepDef = def.tasks.find((t) => t.key === stepKey && t.assignment === 'firmantes');
    if (!stepDef) throw new SgcError('Ese paso no admite firmantes asignados por el elaborador.');
    const eligible = new Set((await listEligibleUsers(tx, request.id_company)).map((u) => u.email));
    const desired = normalizeSigners(input.signers, { stepName: stepDef.name, elaboratorEmail: request.elaborator_email, eligibleEmails: eligible });
    const modes = parseSigningModes(request.signing_modes_json);
    const currentMode = signingModeFor(stepDef, modes);
    const newMode = input.mode === 'orden' || input.mode === 'paralelo' ? input.mode : currentMode;
    const everSet = (await tx.sgcRequestSigner.count({ where: { id_request: idRequest, step_key: stepKey } })) > 0;
    const reasonRaw = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (everSet && reasonRaw.length < 5) throw new SgcError('Escriba el motivo del cambio de firmantes (mínimo 5 caracteres).');
    const reason = reasonRaw || 'Asignación inicial de firmantes.';

    const openTask = await tx.sgcTask.findFirst({ where: { id_request: idRequest, task_key: stepKey, status: 'abierta' }, include: { assignees: true } });
    const active = await tx.sgcRequestSigner.findMany({ where: { id_request: idRequest, step_key: stepKey, is_active: true }, orderBy: { sign_order: 'asc' } });
    const decidedEmails = new Set((openTask?.assignees ?? []).filter((a) => a.user_email && (a.status === 'aprobado' || a.status === 'devuelto')).map((a) => lower(a.user_email)));
    const plan = planSignerChange(
      active.map((s) => ({ email: lower(s.user_email), order: s.sign_order, decided: decidedEmails.has(lower(s.user_email)) })),
      desired
    );
    if (plan.unchanged && newMode === currentMode) return { changed: false };
    const now = new Date();
    for (const email of plan.remove) {
      await tx.sgcRequestSigner.updateMany({ where: { id_request: idRequest, step_key: stepKey, user_email: email, is_active: true }, data: { is_active: false, removed_by: me, removed_at: now, change_reason: reason } });
    }
    for (const s of plan.add) {
      await tx.sgcRequestSigner.create({ data: { id_request: idRequest, step_key: stepKey, user_email: s.email, sign_order: s.order, added_by: me, change_reason: reason } });
    }
    for (const s of plan.reorder) {
      await tx.sgcRequestSigner.updateMany({ where: { id_request: idRequest, step_key: stepKey, user_email: s.email, is_active: true }, data: { sign_order: s.order, change_reason: reason } });
    }
    if (newMode !== currentMode) {
      await tx.sgcRequest.update({ where: { id_request: idRequest }, data: { signing_modes_json: JSON.stringify({ ...modes, [stepKey]: newMode }) } });
    }
    // Si el paso está en curso, se ajustan sus cupos pendientes (lo decidido se conserva).
    if (openTask) {
      const point = signaturePointFor(stepDef.signatureMeaning);
      const removed = openTask.assignees.filter((a) => a.user_email && plan.remove.includes(lower(a.user_email)) && a.status === 'pendiente');
      if (removed.length) {
        await tx.sgcTaskAssignee.updateMany({ where: { id_task_assignee: { in: removed.map((a) => a.id_task_assignee) } }, data: { status: 'reemplazado' } });
        await tx.sgcAuthorization.updateMany({ where: { id_task_assignee: { in: removed.map((a) => a.id_task_assignee) }, status: 'pendiente' }, data: { status: 'anulada' } });
      }
      const authType = stepDef.isAuthorization && stepDef.authorizationTypeCode
        ? await tx.sgcAuthorizationType.findUnique({ where: { id_company_code: { id_company: request.id_company, code: stepDef.authorizationTypeCode } } })
        : null;
      for (const s of plan.add) {
        const a = await tx.sgcTaskAssignee.create({ data: { id_task: openTask.id_task, user_email: s.email, sign_order: s.order, status: 'pendiente', signature_status: point.signatureStatus, signature_meaning: point.signatureMeaning } });
        if (authType) await tx.sgcAuthorization.create({ data: { id_company: request.id_company, id_authorization_type: authType.id_authorization_type, id_request: idRequest, id_task_assignee: a.id_task_assignee, assigned_email: s.email } });
      }
      for (const s of desired) {
        await tx.sgcTaskAssignee.updateMany({ where: { id_task: openTask.id_task, user_email: s.email, status: 'pendiente' }, data: { sign_order: s.order } });
      }
      // El cupo del grupo de verificación siempre va al final.
      await tx.sgcTaskAssignee.updateMany({ where: { id_task: openTask.id_task, user_email: null, status: 'pendiente' }, data: { sign_order: desired.length + 1 } });
      if (newMode !== currentMode) await tx.sgcTask.update({ where: { id_task: openTask.id_task }, data: { signing_mode: newMode } });
      const fresh = await tx.sgcTaskAssignee.findMany({ where: { id_task: openTask.id_task } });
      const beforeTurn = new Set(assigneesInTurn(openTask.assignees.map(toAssigneeState), currentMode).map((a) => a.id));
      const nowTurn = assigneesInTurn(fresh.map(toAssigneeState), newMode).filter((a) => !beforeTurn.has(a.id));
      await notifyTurn({ tx, request, def, notifications, actor, subjectLabel: request.subject }, openTask.id_task, stepDef, nowTurn, 'paralelo');
    }
    const before = { signers: active.map((s) => ({ email: lower(s.user_email), order: s.sign_order })), mode: currentMode };
    const after = { signers: desired, mode: newMode };
    const lines = [
      ...plan.add.map((s) => `+ ${s.email} (orden ${s.order})`),
      ...plan.remove.map((e) => `− ${e}`),
      ...plan.reorder.map((s) => `↕ ${s.email} → orden ${s.order}`),
      ...(newMode !== currentMode ? [`Modo de firma: ${newMode === 'orden' ? 'en orden' : 'en paralelo'}`] : []),
    ];
    await addInteraction(tx, idRequest, 'firmantes', me, `${everSet ? 'Cambió' : 'Asignó'} los firmantes de «${stepDef.name}».\n${lines.join('\n')}\nMotivo: ${reason}`, { meta: { stepKey, before, after } });
    await writeSgcAudit(tx, { idCompany: request.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.firmantesCambiados, entity: 'request', entityId: idRequest, before, after: { stepKey, ...after }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { changed: true };
  }, TX_OPTS);
  await send(notifier, notifications);
  return result;
}

// ---------------------------------------------------------------------------
// Reasignar una tarea de un solo responsable (elaboración)
// ---------------------------------------------------------------------------

export async function reassignTask(
  db: SgcDb,
  notifier: SgcNotifier,
  access: SgcCompanyAccess | null,
  idTask: number,
  input: { toEmail: unknown; reason: unknown },
  actor: SgcActor
) {
  const me = lower(actor.email);
  const to = lower(typeof input.toEmail === 'string' ? input.toEmail : '');
  const reason = text(input.reason, 'El motivo de la reasignación', 1000, 5);
  const head = await db.sgcTask.findUnique({ where: { id_task: idTask }, select: { id_request: true } });
  if (!head) throw new SgcError('Tarea no encontrada.', 404);
  const notifications: SgcNotification[] = [];
  const result = await db.$transaction(async (tx) => {
    const request = await lockRequest(tx, head.id_request);
    const task = await tx.sgcTask.findUniqueOrThrow({ where: { id_task: idTask }, include: { assignees: true, taskDef: true } });
    if (request.status !== 'abierta' || task.status !== 'abierta') throw new SgcError('La tarea no está abierta.', 409);
    if (task.taskDef.multi_assignee || task.taskDef.assignment === 'calidad') throw new SgcError('En los pasos con firmantes el elaborador cambia a las personas (no se reasigna la tarea).', 409);
    const current = task.assignees.find((a) => a.status === 'pendiente');
    if (!current) throw new SgcError('La tarea no tiene un responsable pendiente.', 409);
    const allowed = me === lower(current.user_email) || me === lower(request.requester_email) || Boolean(access?.canQuality);
    if (!allowed) throw new SgcError('Solo el responsable actual, el solicitante o Aseguramiento de Calidad reasignan esta tarea.', 403);
    if (to === lower(current.user_email)) throw new SgcError('La tarea ya está asignada a esa persona.');
    const eligible = new Set((await listEligibleUsers(tx, request.id_company)).map((u) => u.email));
    if (!eligible.has(to)) throw new SgcError(`${to} no tiene permiso de gestión documental en el SGC de esta empresa.`);
    if (task.taskDef.assignment === 'elaborador') {
      const isSigner = await tx.sgcRequestSigner.count({ where: { id_request: request.id_request, user_email: to, is_active: true } });
      if (isSigner) throw new SgcError('Esa persona es firmante del documento: el elaborador no puede revisar ni aprobar su propio documento.', 409);
      await tx.sgcRequest.update({ where: { id_request: request.id_request }, data: { elaborator_email: to } });
    }
    await tx.sgcTaskAssignee.update({ where: { id_task_assignee: current.id_task_assignee }, data: { status: 'reemplazado', decided_by: me, decided_at: new Date(), comment: `Reasignada: ${reason}` } });
    const created = await tx.sgcTaskAssignee.create({
      data: { id_task: idTask, user_email: to, sign_order: current.sign_order, status: 'pendiente', signature_status: current.signature_status, signature_meaning: current.signature_meaning },
    });
    await addInteraction(tx, request.id_request, 'reasignacion', me, `Reasignó «${task.name}» de ${current.user_email} a ${to}.\nMotivo: ${reason}`, { idTask, meta: { from: current.user_email, to } });
    await writeSgcAudit(tx, { idCompany: request.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.tareaReasignada, entity: 'task', entityId: idTask, before: { assignee: current.user_email }, after: { assignee: to }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    await notifyTurn({ tx, request, def: await loadDefinition(tx, request.id_flow_version), notifications, actor, subjectLabel: request.subject }, idTask, { name: task.name, isAuthorization: false }, [toAssigneeState(created)], null);
    return { idAssignee: created.id_task_assignee };
  }, TX_OPTS);
  await send(notifier, notifications);
  return result;
}

// ---------------------------------------------------------------------------
// Cancelar la solicitud (acción, no paso)
// ---------------------------------------------------------------------------

export async function cancelRequest(db: SgcDb, notifier: SgcNotifier, access: SgcCompanyAccess | null, idRequest: number, input: { reason: unknown }, actor: SgcActor) {
  const me = lower(actor.email);
  const reason = text(input.reason, 'El motivo de la cancelación', 1000, 5);
  const notifications: SgcNotification[] = [];
  const result = await db.$transaction(async (tx) => {
    const request = await lockRequest(tx, idRequest);
    if (request.status !== 'abierta' && request.status !== 'en_espera') throw new SgcError('La solicitud ya está cerrada.', 409);
    const allowed = me === lower(request.requester_email) || me === lower(request.elaborator_email) || Boolean(access?.canQuality);
    if (!allowed) throw new SgcError('Solo el solicitante, el elaborador o Aseguramiento de Calidad cancelan la solicitud.', 403);
    const def = await loadDefinition(tx, request.id_flow_version);
    if (!def.transitions.some((t) => t.from === request.current_task_key && t.action === 'cancelar')) {
      throw new SgcError('En esta etapa la solicitud ya no se cancela (el documento se anula desde su ficha).', 409);
    }
    const now = new Date();
    const open = await tx.sgcTask.findMany({ where: { id_request: idRequest, status: { in: ['abierta', 'sin_empezar', 'en_espera'] } }, include: { assignees: true } });
    const pendingIds = open.flatMap((t) => t.assignees.filter((a) => a.status === 'pendiente').map((a) => a.id_task_assignee));
    if (open.length) await tx.sgcTask.updateMany({ where: { id_task: { in: open.map((t) => t.id_task) } }, data: { status: 'cancelada', ended_at: now, resolved_by: me, resolution: reason } });
    if (pendingIds.length) {
      await tx.sgcTaskAssignee.updateMany({ where: { id_task_assignee: { in: pendingIds } }, data: { status: 'anulado' } });
      await tx.sgcAuthorization.updateMany({ where: { id_task_assignee: { in: pendingIds }, status: 'pendiente' }, data: { status: 'anulada' } });
    }
    await tx.sgcRequest.update({ where: { id_request: idRequest }, data: { status: 'cancelada', cancel_reason: reason, closed_by: me, closed_at: now, current_task_key: null } });
    await addInteraction(tx, idRequest, 'cancelacion', me, `Canceló la solicitud.\nMotivo: ${reason}`);
    const involved = await tx.sgcRequestSigner.findMany({ where: { id_request: idRequest, is_active: true }, select: { user_email: true } });
    notifications.push({
      emails: recipients([request.requester_email, request.elaborator_email, ...involved.map((s) => s.user_email)], me),
      payload: { title: SGC_NOTIFICATION_TITLES.cancelada, body: `#${idRequest} — ${request.subject}`, url: requestUrl(idRequest), tag: `sgc-request-${idRequest}` },
    });
    await writeSgcAudit(tx, { idCompany: request.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.solicitudCancelada, entity: 'request', entityId: idRequest, before: { status: request.status }, after: { status: 'cancelada' }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { status: 'cancelada' };
  }, TX_OPTS);
  await send(notifier, notifications);
  return result;
}

// ---------------------------------------------------------------------------
// Vista de la solicitud / tarea (copia de view-request / view-activities)
// ---------------------------------------------------------------------------

export interface SgcViewer {
  email: string;
  access: readonly SgcCompanyAccess[];
}

const detailInclude = {
  companyConfig: { include: { company: { select: { company: true } } } },
  process: true,
  version: true,
  document: { include: { versions: { select: { id_document_version: true, version_number: true } } } },
  processMap: true,
  documentType: true,
  tasks: { include: { assignees: { orderBy: { sign_order: 'asc' } }, taskDef: true }, orderBy: [{ id_task: 'asc' }] },
  signers: { orderBy: [{ step_key: 'asc' }, { sign_order: 'asc' }] },
  formValues: { include: { field: true } },
  interactions: { orderBy: { id_interaction: 'asc' } },
  attachments: { orderBy: { id_attachment: 'asc' } },
} satisfies Prisma.SgcRequestInclude;

type DetailRow = Prisma.SgcRequestGetPayload<{ include: typeof detailInclude }>;

export interface SgcRequestPermissions {
  canNote: boolean;
  canUploadDraft: boolean;
  canUploadSupport: boolean;
  canChangeSigners: boolean;
  canCancel: boolean;
  canEditForm: boolean;
  isRequester: boolean;
  isElaborator: boolean;
  isQuality: boolean;
}

function involvement(row: DetailRow, email: string, pools: readonly string[]) {
  const me = lower(email);
  const emails = new Set<string>([lower(row.requester_email), lower(row.elaborator_email)]);
  for (const s of row.signers) emails.add(lower(s.user_email));
  for (const t of row.tasks) for (const a of t.assignees) {
    if (a.user_email) emails.add(lower(a.user_email));
    if (a.decided_by) emails.add(lower(a.decided_by));
  }
  const poolPending = row.tasks.some((t) => t.status === 'abierta' && t.assignees.some((a) => !a.user_email && a.status === 'pendiente' && a.pool_type_code && pools.includes(a.pool_type_code)));
  return emails.has(me) || poolPending;
}

/** Detalle completo si la persona puede verlo (involucrada o Calidad); si no, 404 (no se revela). */
export async function getRequestDetail(db: SgcDb, idRequest: number, viewer: SgcViewer, focusTaskId?: number | null) {
  const row = await db.sgcRequest.findUnique({ where: { id_request: idRequest }, include: detailInclude });
  if (!row) throw new SgcError('Solicitud no encontrada.', 404);
  const access = viewer.access.find((a) => a.idCompany === row.id_company && a.canRead);
  if (!access) throw new SgcError('Solicitud no encontrada.', 404);
  const me = lower(viewer.email);
  const pools = await getPoolTypeCodes(db, row.id_company, me);
  const isQuality = access.canQuality;
  if (!isQuality && !involvement(row, me, pools)) throw new SgcError('Solicitud no encontrada.', 404);
  const def = await loadDefinition(db, row.id_flow_version);
  const defByKey = new Map(def.tasks.map((t) => [t.key, t]));

  const allEmails = new Set<string>([row.requester_email, row.elaborator_email]);
  row.signers.forEach((s) => allEmails.add(s.user_email));
  row.tasks.forEach((t) => t.assignees.forEach((a) => { if (a.user_email) allEmails.add(a.user_email); if (a.decided_by) allEmails.add(a.decided_by); }));
  row.interactions.forEach((i) => allEmails.add(i.author_email));
  row.attachments.forEach((a) => allEmails.add(a.uploaded_by));
  const names = await namesFor(db, allEmails);
  const nameOf = (e: string | null) => (e ? names.get(lower(e)) ?? e : null);

  const isOpen = row.status === 'abierta';
  const isRequester = me === lower(row.requester_email);
  const isElaborator = me === lower(row.elaborator_email);
  const currentTask = row.tasks.filter((t) => t.status === 'abierta' || t.status === 'en_espera').at(-1) ?? null;
  const inElaboration = Boolean(currentTask && currentTask.status === 'abierta' && defByKey.get(currentTask.task_key)?.assignment === 'elaborador');
  const cancellable = def.transitions.some((t) => t.from === row.current_task_key && t.action === 'cancelar');
  const permissions: SgcRequestPermissions = {
    canNote: row.status === 'abierta' || row.status === 'en_espera',
    canUploadDraft: isOpen && isElaborator && inElaboration,
    canUploadSupport: isOpen,
    canChangeSigners: isOpen && isElaborator,
    canCancel: (row.status === 'abierta' || row.status === 'en_espera') && cancellable && (isRequester || isElaborator || isQuality),
    canEditForm: isOpen && (isRequester || isElaborator),
    isRequester,
    isElaborator,
    isQuality,
  };

  const tasks = row.tasks.map((t) => {
    const tDef = defByKey.get(t.task_key);
    const states = t.assignees.map(toAssigneeState);
    const turn = new Set(t.status === 'abierta' ? assigneesInTurn(states, (t.signing_mode as 'orden' | 'paralelo' | null) ?? null).map((a) => a.id) : []);
    const mine = t.assignees.filter((a) => a.status === 'pendiente' && ((a.user_email && lower(a.user_email) === me) || (!a.user_email && a.pool_type_code && pools.includes(a.pool_type_code))));
    const myTurn = mine.find((a) => turn.has(a.id_task_assignee)) ?? null;
    const blockedBySoD = Boolean(myTurn && tDef && tDef.assignment !== 'elaborador' && tDef.assignment !== 'solicitante' && isElaborator);
    const single = !t.taskDef.multi_assignee && t.taskDef.assignment !== 'calidad';
    const currentAssignee = t.assignees.find((a) => a.status === 'pendiente');
    return {
      id: t.id_task,
      key: t.task_key,
      name: t.name,
      stepOrder: t.step_order,
      round: t.round,
      status: t.status as SgcTaskStatus,
      statusLabel: SGC_TASK_STATUS_LABELS[t.status as SgcTaskStatus] ?? t.status,
      signingMode: t.signing_mode,
      isSequential: t.signing_mode === 'orden',
      multiAssignee: t.taskDef.multi_assignee,
      isAuthorization: t.taskDef.is_authorization,
      isEnabled: t.taskDef.is_enabled,
      signatureMeaning: t.taskDef.signature_meaning,
      signatureLabel: t.taskDef.signature_meaning ? SGC_SIGNATURE_LABELS[t.taskDef.signature_meaning as keyof typeof SGC_SIGNATURE_LABELS] : null,
      startedAt: t.started_at?.toISOString() ?? null,
      endedAt: t.ended_at?.toISOString() ?? null,
      resolution: t.resolution,
      resolvedBy: nameOf(t.resolved_by),
      assignees: t.assignees.map((a) => ({
        id: a.id_task_assignee,
        email: a.user_email,
        name: a.user_email ? nameOf(a.user_email) : null,
        poolTypeCode: a.pool_type_code,
        signOrder: a.sign_order,
        status: a.status,
        statusLabel: SGC_ASSIGNEE_STATUS_LABELS[a.status as SgcAssigneeStatus] ?? a.status,
        inTurn: turn.has(a.id_task_assignee),
        decidedBy: nameOf(a.decided_by),
        decidedAt: a.decided_at?.toISOString() ?? null,
        comment: a.comment,
        signatureStatus: a.signature_status,
        signatureMeaning: a.signature_meaning,
      })),
      myAction: myTurn && !blockedBySoD ? { idAssignee: myTurn.id_task_assignee, kind: tDef?.assignment === 'elaborador' ? ('enviar' as const) : ('decidir' as const) } : null,
      myWaiting: !myTurn && mine.length > 0,
      canReassign: t.status === 'abierta' && single && isOpen && Boolean(currentAssignee) && (isRequester || isQuality || lower(currentAssignee?.user_email) === me),
      assignedLabel: t.assignees.filter((a) => a.status !== 'reemplazado' && a.status !== 'anulado').map((a) => (a.user_email ? nameOf(a.user_email) : `Grupo ${a.pool_type_code}`)).join(', '),
    };
  });

  const steps = def.tasks
    .filter((t) => t.assignment === 'firmantes')
    .map((t) => ({
      key: t.key,
      name: t.name,
      mode: signingModeFor(t, parseSigningModes(row.signing_modes_json)),
      pool: t.poolAuthorizationTypeCode,
      signers: row.signers
        .filter((s) => s.step_key === t.key && s.is_active)
        .map((s) => ({ email: s.user_email, name: nameOf(s.user_email), order: s.sign_order, addedBy: nameOf(s.added_by), addedAt: s.added_at.toISOString() })),
      history: row.signers
        .filter((s) => s.step_key === t.key)
        .map((s) => ({ email: s.user_email, order: s.sign_order, isActive: s.is_active, addedBy: s.added_by, addedAt: s.added_at.toISOString(), removedBy: s.removed_by, removedAt: s.removed_at?.toISOString() ?? null, reason: s.change_reason })),
    }));

  const valueOf = new Map(row.formValues.map((v) => [v.id_flow_form_field, v]));
  const fieldRows = await db.sgcFlowFormField.findMany({ where: { id_flow_version: row.id_flow_version }, orderBy: [{ sort_order: 'asc' }] });
  const formFields = fieldRows.map((f) => {
    const d = def.formFields.find((x) => x.key === f.field_key && x.taskKey === f.task_key)!;
    const v = valueOf.get(f.id_flow_form_field);
    return { id: f.id_flow_form_field, key: f.field_key, taskKey: f.task_key, label: f.label, type: f.field_type, required: f.required, options: d?.options ?? [], helpText: f.help_text, value: v?.value_text ?? null, updatedBy: v ? nameOf(v.updated_by) : null };
  });

  const status = row.status as SgcRequestStatus;
  return {
    request: {
      id: row.id_request,
      idCompany: row.id_company,
      company: row.companyConfig.company.company,
      subject: row.subject,
      description: row.description,
      requestType: row.request_type,
      requestTypeLabel: SGC_DOCUMENT_REQUEST_TYPE_LABELS[row.request_type as keyof typeof SGC_DOCUMENT_REQUEST_TYPE_LABELS] ?? row.request_type,
      status,
      statusLabel: SGC_REQUEST_STATUS_LABELS[status] ?? row.status,
      requesterEmail: row.requester_email,
      requester: nameOf(row.requester_email),
      elaboratorEmail: row.elaborator_email,
      elaborator: nameOf(row.elaborator_email),
      createdAt: row.created_at.toISOString(),
      closedAt: row.closed_at?.toISOString() ?? null,
      closedBy: nameOf(row.closed_by),
      cancelReason: row.cancel_reason,
      currentTaskKey: row.current_task_key,
      flow: { code: row.process.code, name: row.process.name, version: row.version.version_number },
      document: row.document ? { id: row.document.id_document, code: row.document.code, title: row.document.title, status: row.document.status } : null,
      process: row.processMap ? { id: row.processMap.id_process_map, code: row.processMap.code, name: row.processMap.name } : null,
      documentType: row.documentType ? { id: row.documentType.id_document_type, code: row.documentType.code, name: row.documentType.name } : null,
    },
    focusTaskId: focusTaskId ?? null,
    tasks,
    steps,
    formFields,
    interactions: row.interactions.map((i) => ({ id: i.id_interaction.toString(), kind: i.kind, authorEmail: i.author_email, author: nameOf(i.author_email), body: i.body, createdAt: i.created_at.toISOString(), idTask: i.id_task })),
    attachments: row.attachments.map((a) => ({
      id: a.id_attachment,
      fileName: a.file_name,
      purpose: a.purpose,
      sizeBytes: a.size_bytes,
      sha256: a.sha256,
      uploadedBy: nameOf(a.uploaded_by),
      uploadedByEmail: a.uploaded_by,
      createdAt: a.created_at.toISOString(),
      withdrawnAt: a.withdrawn_at?.toISOString() ?? null,
      withdrawReason: a.withdraw_reason,
    })),
    permissions,
    signatureNotice: SGC_SIGNATURE_STUB_NOTICE,
  };
}

export type SgcRequestDetail = Awaited<ReturnType<typeof getRequestDetail>>;

// ---------------------------------------------------------------------------
// Bandeja «Tareas documentales» y «Mis solicitudes»
// ---------------------------------------------------------------------------

export interface SgcInboxRow {
  idTask: number;
  idAssignee: number;
  idRequest: number;
  idCompany: number;
  company: string;
  task: string;
  subject: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  requester: string | null;
  assigned: string;
  isPool: boolean;
  isAuthorization: boolean;
}

/**
 * Tareas de la persona (una fila por cupo): «Abierto» si le toca, «Sin
 * Empezar» si espera turno (firma en orden), «Resuelto» si ya decidió y
 * «Cancelado» si su cupo se anuló o reemplazó. Incluye los cupos de GRUPO
 * pendientes de los tipos a los que pertenece.
 */
export async function listTaskInbox(
  db: SgcDb,
  email: string,
  access: readonly SgcCompanyAccess[],
  opts: { status?: string | null; idCompany?: number | null; idRequest?: number | null } = {}
): Promise<SgcInboxRow[]> {
  const me = lower(email);
  const companies = access.filter((a) => a.canRead).map((a) => a.idCompany).filter((c) => !opts.idCompany || c === opts.idCompany);
  if (companies.length === 0) return [];
  const pools = await db.sgcAuthorizationTypeUser.findMany({
    where: { user_email: me, revoked_at: null, type: { id_company: { in: companies }, is_active: true } },
    select: { type: { select: { code: true, id_company: true } } },
  });
  const poolCodes = [...new Set(pools.map((p) => p.type.code))];
  const rows = await db.sgcTaskAssignee.findMany({
    where: {
      task: { request: { id_company: { in: companies }, ...(opts.idRequest ? { id_request: opts.idRequest } : {}) } },
      OR: [{ user_email: me }, ...(poolCodes.length ? [{ user_email: null, pool_type_code: { in: poolCodes }, status: 'pendiente' }] : []), { user_email: null, decided_by: me }],
    },
    include: { task: { include: { assignees: true, taskDef: true, request: { include: { companyConfig: { include: { company: { select: { company: true } } } } } } } } },
    orderBy: { id_task_assignee: 'desc' },
    take: 500,
  });
  const names = await namesFor(db, rows.map((r) => r.task.request.requester_email).concat([me]));
  const out: SgcInboxRow[] = [];
  for (const r of rows) {
    const t = r.task;
    const turn = new Set(t.status === 'abierta' ? assigneesInTurn(t.assignees.map(toAssigneeState), (t.signing_mode as 'orden' | 'paralelo' | null) ?? null).map((a) => a.id) : []);
    let status: SgcTaskStatus;
    if (r.status === 'aprobado' || r.status === 'devuelto') status = 'resuelta';
    else if (r.status === 'anulado' || r.status === 'reemplazado') status = 'cancelada';
    else if (t.status === 'abierta') status = turn.has(r.id_task_assignee) ? 'abierta' : 'sin_empezar';
    else status = (t.status as SgcTaskStatus) === 'en_espera' ? 'en_espera' : 'cancelada';
    if (opts.status && opts.status !== 'todas' && opts.status !== status) continue;
    out.push({
      idTask: t.id_task,
      idAssignee: r.id_task_assignee,
      idRequest: t.id_request,
      idCompany: t.request.id_company,
      company: t.request.companyConfig.company.company,
      task: t.round > 1 ? `${t.name} (ronda ${t.round})` : t.name,
      subject: t.request.subject,
      status,
      statusLabel: SGC_TASK_STATUS_LABELS[status],
      createdAt: t.created_at.toISOString(),
      requester: names.get(lower(t.request.requester_email)) ?? t.request.requester_email,
      assigned: r.user_email ? names.get(lower(r.user_email)) ?? r.user_email : `Grupo ${r.pool_type_code}`,
      isPool: !r.user_email,
      isAuthorization: t.taskDef.is_authorization || !r.user_email,
    });
  }
  return out;
}

export interface SgcMyRequestRow {
  id: number;
  subject: string;
  requestTypeLabel: string;
  company: string;
  status: string;
  statusLabel: string;
  currentTask: string | null;
  createdAt: string;
  elaborator: string | null;
}

/** Solicitudes que la persona creó o elabora (Calidad: todas las de la empresa). */
export async function listMyRequests(db: SgcDb, email: string, access: readonly SgcCompanyAccess[], opts: { idCompany?: number | null } = {}): Promise<SgcMyRequestRow[]> {
  const me = lower(email);
  const readable = access.filter((a) => a.canRead && (!opts.idCompany || a.idCompany === opts.idCompany));
  if (readable.length === 0) return [];
  const quality = readable.filter((a) => a.canQuality).map((a) => a.idCompany);
  const others = readable.filter((a) => !a.canQuality).map((a) => a.idCompany);
  const rows = await db.sgcRequest.findMany({
    where: {
      OR: [
        ...(quality.length ? [{ id_company: { in: quality } }] : []),
        ...(others.length ? [{ id_company: { in: others }, OR: [{ requester_email: me }, { elaborator_email: me }] }] : []),
      ],
    },
    include: { companyConfig: { include: { company: { select: { company: true } } } }, tasks: { orderBy: { id_task: 'desc' }, take: 1 } },
    orderBy: { id_request: 'desc' },
    take: 500,
  });
  const names = await namesFor(db, rows.map((r) => r.elaborator_email));
  return rows.map((r) => ({
    id: r.id_request,
    subject: r.subject,
    requestTypeLabel: SGC_DOCUMENT_REQUEST_TYPE_LABELS[r.request_type as keyof typeof SGC_DOCUMENT_REQUEST_TYPE_LABELS] ?? r.request_type,
    company: r.companyConfig.company.company,
    status: r.status,
    statusLabel: SGC_REQUEST_STATUS_LABELS[r.status as SgcRequestStatus] ?? r.status,
    currentTask: r.status === 'abierta' || r.status === 'en_espera' ? r.tasks[0]?.name ?? null : null,
    createdAt: r.created_at.toISOString(),
    elaborator: names.get(lower(r.elaborator_email)) ?? r.elaborator_email,
  }));
}

// ---------------------------------------------------------------------------
// Historial: notas, adjuntos e información adicional
// ---------------------------------------------------------------------------

async function assertCanView(db: SgcDb | Tx, idRequest: number, viewer: SgcViewer) {
  const row = await db.sgcRequest.findUnique({ where: { id_request: idRequest }, include: { signers: true, tasks: { include: { assignees: true, taskDef: true } } } });
  if (!row) throw new SgcError('Solicitud no encontrada.', 404);
  const access = viewer.access.find((a) => a.idCompany === row.id_company && a.canRead);
  if (!access) throw new SgcError('Solicitud no encontrada.', 404);
  const pools = await getPoolTypeCodes(db, row.id_company, viewer.email);
  if (!access.canQuality && !involvement(row as unknown as DetailRow, viewer.email, pools)) throw new SgcError('Solicitud no encontrada.', 404);
  return { row, access };
}

export async function addNote(db: SgcDb, notifier: SgcNotifier, idRequest: number, input: { body: unknown; notifyEmails?: unknown }, viewer: SgcViewer, actor: SgcActor) {
  const body = text(input.body, 'La nota', 4000);
  const { row } = await assertCanView(db, idRequest, viewer);
  if (row.status !== 'abierta' && row.status !== 'en_espera') throw new SgcError('La solicitud está cerrada: el historial ya no admite notas.', 409);
  const notify = Array.isArray(input.notifyEmails) ? recipients(input.notifyEmails.map(String), actor.email).slice(0, 30) : [];
  await db.$transaction(async (tx) => {
    await addInteraction(tx, idRequest, 'nota', lower(actor.email), body, { notifyEmails: notify });
    await writeSgcAudit(tx, { idCompany: row.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.notaAgregada, entity: 'request', entityId: idRequest, after: { length: body.length, notify }, ip: actor.ip, userAgent: actor.userAgent });
  });
  await send(notifier, [{ emails: notify, payload: { title: SGC_NOTIFICATION_TITLES.nota, body: `#${idRequest} — ${body}`.slice(0, 300), url: requestUrl(idRequest), tag: `sgc-request-${idRequest}-nota` } }]);
  return { ok: true };
}

export async function uploadAttachment(
  db: SgcDb,
  upload: SgcUploader,
  idRequest: number,
  input: { purpose: unknown; fileName: string; contentType: string; bytes: Uint8Array },
  viewer: SgcViewer,
  actor: SgcActor
) {
  const purpose = input.purpose === 'borrador' ? 'borrador' : 'soporte';
  const { row } = await assertCanView(db, idRequest, viewer);
  if (row.status !== 'abierta') throw new SgcError('La solicitud no está abierta.', 409);
  if (!input.bytes.length) throw new SgcError('El archivo está vacío.');
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new SgcError('El archivo supera 25 MB.');
  const fileName = input.fileName.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 200);
  if (!fileName) throw new SgcError('Nombre de archivo inválido.');
  if (purpose === 'borrador') {
    if (lower(row.elaborator_email) !== lower(actor.email)) throw new SgcError('Solo el elaborador carga el borrador del documento.', 403);
    const open = row.tasks.find((t) => t.status === 'abierta' && t.taskDef.assignment === 'elaborador');
    if (!open) throw new SgcError('El borrador se carga durante la elaboración.', 409);
    if (!DRAFT_EXT.test(fileName)) throw new SgcError('El borrador debe ser Word (.docx, .doc) o PDF.');
  }
  const config = await db.sgcCompanyConfig.findUniqueOrThrow({ where: { id_company: row.id_company } });
  const segments = [...config.storage_root.split('/').filter(Boolean), '_solicitudes', `SOL-${idRequest}`];
  const sha = sha256Hex(input.bytes);
  const stamped = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}_${fileName}`;
  const item = await upload(segments, stamped, input.bytes, input.contentType || 'application/octet-stream');
  return db.$transaction(async (tx) => {
    const att = await tx.sgcAttachment.create({
      data: {
        id_request: idRequest,
        purpose,
        file_name: fileName,
        item_id: item.id,
        storage_path: `${segments.join('/')}/${stamped}`,
        content_type: (input.contentType || 'application/octet-stream').slice(0, 150),
        size_bytes: input.bytes.length,
        sha256: sha,
        uploaded_by: lower(actor.email),
      },
    });
    await addInteraction(tx, idRequest, 'adjunto', lower(actor.email), `Adjuntó ${purpose === 'borrador' ? 'el borrador' : 'un soporte'}: ${fileName}.`, { meta: { idAttachment: att.id_attachment, sha256: sha } });
    await writeSgcAudit(tx, { idCompany: row.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.adjuntoCargado, entity: 'attachment', entityId: att.id_attachment, after: { idRequest, fileName, purpose, sha256: sha, size: input.bytes.length }, ip: actor.ip, userAgent: actor.userAgent });
    return { id: att.id_attachment, sha256: sha };
  });
}

export async function withdrawAttachment(db: SgcDb, idRequest: number, idAttachment: number, input: { reason: unknown }, viewer: SgcViewer, actor: SgcActor) {
  const reason = text(input.reason, 'El motivo', 1000, 5);
  const { row, access } = await assertCanView(db, idRequest, viewer);
  if (row.status !== 'abierta') throw new SgcError('La solicitud no está abierta.', 409);
  const att = await db.sgcAttachment.findUnique({ where: { id_attachment: idAttachment } });
  if (!att || att.id_request !== idRequest) throw new SgcError('Adjunto no encontrado.', 404);
  if (att.withdrawn_at) throw new SgcError('El adjunto ya estaba retirado.', 409);
  const me = lower(actor.email);
  if (me !== lower(att.uploaded_by) && me !== lower(row.elaborator_email) && !access.canQuality) throw new SgcError('Solo quien lo cargó, el elaborador o Calidad retiran un adjunto.', 403);
  return db.$transaction(async (tx) => {
    await tx.sgcAttachment.update({ where: { id_attachment: idAttachment }, data: { withdrawn_at: new Date(), withdrawn_by: me, withdraw_reason: reason } });
    await addInteraction(tx, idRequest, 'adjunto', me, `Retiró el adjunto ${att.file_name} (no se borra: queda en el historial).\nMotivo: ${reason}`, { meta: { idAttachment } });
    await writeSgcAudit(tx, { idCompany: row.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.adjuntoRetirado, entity: 'attachment', entityId: idAttachment, before: { withdrawn: false }, after: { withdrawn: true }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { ok: true };
  });
}

/** Adjunto para descargarlo (lo registra en la auditoría). */
export async function getAttachmentForDownload(db: SgcDb, idRequest: number, idAttachment: number, viewer: SgcViewer, actor: SgcActor) {
  const { row } = await assertCanView(db, idRequest, viewer);
  const att = await db.sgcAttachment.findUnique({ where: { id_attachment: idAttachment } });
  if (!att || att.id_request !== idRequest) throw new SgcError('Adjunto no encontrado.', 404);
  await writeSgcAudit(db, { idCompany: row.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.adjuntoDescarga, entity: 'attachment', entityId: idAttachment, after: { idRequest, fileName: att.file_name }, ip: actor.ip, userAgent: actor.userAgent });
  return { itemId: att.item_id, fileName: att.file_name, contentType: att.content_type, sha256: att.sha256 };
}

export async function saveFormValues(db: SgcDb, idRequest: number, input: { values: unknown }, viewer: SgcViewer, actor: SgcActor) {
  const { row } = await assertCanView(db, idRequest, viewer);
  if (row.status !== 'abierta') throw new SgcError('La solicitud no está abierta.', 409);
  const me = lower(actor.email);
  if (me !== lower(row.requester_email) && me !== lower(row.elaborator_email)) throw new SgcError('Solo el solicitante o el elaborador editan la información adicional.', 403);
  const values = input.values && typeof input.values === 'object' ? (input.values as Record<string, unknown>) : {};
  const def = await loadDefinition(db, row.id_flow_version);
  return db.$transaction(async (tx) => {
    const before = await tx.sgcFormValue.findMany({ where: { id_request: idRequest }, include: { field: true } });
    const saved = await saveFieldValues(tx, idRequest, row.id_flow_version, def.formFields, values, me, true);
    if (Object.keys(saved).length === 0) return { saved };
    await addInteraction(tx, idRequest, 'estado', me, `Actualizó la información adicional: ${Object.keys(saved).map((k) => def.formFields.find((f) => f.key === k)?.label ?? k).join(', ')}.`);
    await writeSgcAudit(tx, { idCompany: row.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.solicitudFormulario, entity: 'request', entityId: idRequest, before: Object.fromEntries(before.map((b) => [b.field.field_key, b.value_text])), after: saved, ip: actor.ip, userAgent: actor.userAgent });
    return { saved };
  });
}

// ---------------------------------------------------------------------------
// Ayudas para las rutas
// ---------------------------------------------------------------------------

/** Empresa de una solicitud (404 si no existe). */
export async function companyOfRequest(db: SgcDb, idRequest: number): Promise<number> {
  const row = await db.sgcRequest.findUnique({ where: { id_request: idRequest }, select: { id_company: true } });
  if (!row) throw new SgcError('Solicitud no encontrada.', 404);
  return row.id_company;
}

/** Solicitud y empresa de una tarea (404 si no existe). */
export async function requestOfTask(db: SgcDb, idTask: number): Promise<{ idRequest: number; idCompany: number }> {
  const row = await db.sgcTask.findUnique({ where: { id_task: idTask }, select: { id_request: true, request: { select: { id_company: true } } } });
  if (!row) throw new SgcError('Tarea no encontrada.', 404);
  return { idRequest: row.id_request, idCompany: row.request.id_company };
}

/** Vista de una tarea documental: la solicitud completa con la tarea enfocada. */
export async function getTaskDetail(db: SgcDb, idTask: number, viewer: SgcViewer) {
  const { idRequest } = await requestOfTask(db, idTask);
  return getRequestDetail(db, idRequest, viewer, idTask);
}

/** Tarea y cupo de una autorización (para decidirla con el mismo motor). */
export async function taskOfAuthorization(db: SgcDb, idAuthorization: number): Promise<{ idTask: number; idAssignee: number; idCompany: number }> {
  const row = await db.sgcAuthorization.findUnique({ where: { id_authorization: idAuthorization }, select: { id_company: true, id_task_assignee: true, assignee: { select: { id_task: true } } } });
  if (!row) throw new SgcError('Autorización no encontrada.', 404);
  return { idTask: row.assignee.id_task, idAssignee: row.id_task_assignee, idCompany: row.id_company };
}

/** Formulario de una solicitud nueva: campos de la versión VIGENTE del flujo. */
export async function getRequestForm(db: SgcDb, idCompany: number, flowCode = SGC_DOCUMENT_FLOW_CODE) {
  const { process, version } = await getCurrentFlowVersion(db, idCompany, flowCode);
  const def = await loadDefinition(db, version.id_flow_version);
  return {
    flow: { code: process.code, name: process.name, version: version.version_number },
    requestTypes: Object.entries(SGC_DOCUMENT_REQUEST_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    fields: def.formFields.filter((f) => f.taskKey === null),
    steps: def.tasks.map((t) => ({ key: t.key, name: t.name, stepOrder: t.stepOrder, isEnabled: t.isEnabled, signature: t.signatureMeaning })),
  };
}
