import { getPool, sql } from '../mssqlPool';
import { prisma } from '../prisma';
import {
  DOCUMENT_WORKFLOW_PROCESS_NAME,
  DOCUMENT_WORKFLOW_STATES,
  INITIAL_STATE,
  RESUME_FROM_REASSIGNMENT_ACTION,
  findAction,
  type DocumentWorkflowState,
  type WorkflowActionDef,
} from './workflowStates';
import { DOCUMENT_MANAGEMENT_WRITE_URL } from './access';
// notificationEvents.js / notifications.js infieren tipos por JSDoc; se tipan explícitamente
// abajo, mismo patrón que app/api/payment-assistant/submit-run/route.ts.
import { fireAndForgetNotification, buildAppUrl } from '../notificationEvents.js';
import { createAndSendNotifications } from '../notifications.js';

const sendToEmails = createAndSendNotifications as (
  emails: string[],
  payload: { title: string; body: string; url?: string; tag?: string }
) => Promise<{ saved: number; pushed: number }>;

/**
 * Orquestador del flujo de aprobación documental (Fase 2). Ver el comentario
 * al inicio de workflowStates.ts para el porqué de que la transición entre
 * estados NO se delegue en lib/workflow/advanceSequentialTask.js: ese
 * mecanismo solo sabe avanzar a "la siguiente tarea por display_order" y no
 * puede expresar un rechazo que salta a otra rama, ni un regreso a un estado
 * anterior (Reelaboración → En elaboración).
 *
 * Lo que SÍ se reutiliza sin cambios del motor de "solicitudes generales":
 *   - Las tablas: process_category / task_process_category (catálogo de
 *     estados, sembrado por prisma/seeds/document-management-workflow.sql),
 *     requests_general / task_request_general (una instancia + su bitácora
 *     de tareas por DocumentVersion), notes (bitácora de motivos).
 *   - Los códigos de id_status de task_request_general: 2=Resuelto,
 *     3=Rechazado/Cancelado, 4=Pendiente (idénticos a
 *     app/api/requests-general/update-activities/route.js).
 *   - El mecanismo de notificación (lib/notifications.js
 *     createAndSendNotifications: fila en `notifications` + push), igual que
 *     lib/notificationEvents.js.
 *
 * Control de acceso: TODAS las acciones de transición exigen permiso de
 * ESCRITURA (`subprocess_user_company` sobre `/process/document-management/manage`,
 * ver lib/document-management/access.ts) en la empresa del documento — nunca
 * un rol nuevo. No hay una regla especial para el "dueño" del documento
 * porque, en la práctica, para llegar a ser dueño de un documento hace falta
 * ya tener ese mismo permiso de escritura (es el único camino para crear un
 * documento, ver lib/document-management/documents.ts). El campo `actorRole`
 * de workflowStates.ts es solo METADATA para decidir a quién se le asigna la
 * siguiente tarea (al dueño, o abierta a cualquiera con escritura) y para
 * rotular los botones en la UI — no es un gate de permisos adicional.
 */

export class WorkflowNotSeededError extends Error {
  constructor() {
    super(
      'El flujo de "Gestión Documental" no está sembrado en esta base. ' +
        'Corra prisma/seeds/document-management-workflow.sql antes de usar Fase 2.'
    );
  }
}

export class WorkflowTransitionError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

interface WorkflowCatalog {
  processId: number;
  taskIdByState: Record<string, number>;
}

let cachedCatalog: WorkflowCatalog | null = null;

/** Resuelve (y cachea en memoria del proceso) el process_category + las 14 tareas sembradas. */
async function resolveWorkflowCatalog(pool: Awaited<ReturnType<typeof getPool>>): Promise<WorkflowCatalog> {
  if (cachedCatalog) return cachedCatalog;

  const pcResult = await pool
    .request()
    .input('name', sql.NVarChar(1000), DOCUMENT_WORKFLOW_PROCESS_NAME)
    .query(`SELECT TOP 1 id FROM process_category WHERE process = @name AND active = 1 ORDER BY id`);
  const processId: number | undefined = pcResult.recordset[0]?.id;
  if (!processId) throw new WorkflowNotSeededError();

  const tasksResult = await pool
    .request()
    .input('id_process', sql.Int, processId)
    .query(`SELECT id, task FROM task_process_category WHERE id_process_category = @id_process AND active = 1`);

  const taskIdByState: Record<string, number> = {};
  for (const row of tasksResult.recordset as Array<{ id: number; task: string }>) {
    taskIdByState[row.task] = row.id;
  }

  const missing = DOCUMENT_WORKFLOW_STATES.filter((s) => !(s in taskIdByState));
  if (missing.length > 0) {
    throw new Error(
      `Faltan tareas del flujo documental en task_process_category: ${missing.join(', ')}. ` +
        'Vuelva a correr prisma/seeds/document-management-workflow.sql.'
    );
  }

  cachedCatalog = { processId, taskIdByState };
  return cachedCatalog;
}

/** Solo para pruebas/reintentos manuales: fuerza a releer el catálogo la próxima vez. */
export function invalidateWorkflowCatalogCache(): void {
  cachedCatalog = null;
}

function documentDetailUrl(idDocument: number): string {
  return buildAppUrl(`/process/document-management/${idDocument}`);
}

/** Emails con acceso de ESCRITURA al módulo en una empresa (mismo patrón que resolveHelpDeskTechnicianEmails). */
async function resolveWriteAccessEmails(
  pool: Awaited<ReturnType<typeof getPool>>,
  idCompany: number
): Promise<string[]> {
  const result = await pool
    .request()
    .input('id_company', sql.Int, idCompany)
    .input('url', sql.NVarChar(255), DOCUMENT_MANAGEMENT_WRITE_URL)
    .query(`
      SELECT DISTINCT u.email
      FROM subprocess_user_company suc
      INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
      INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      INNER JOIN [user] u ON u.id = cu.id_user
      WHERE s.subprocess_url = @url AND cu.id_company = @id_company AND u.email IS NOT NULL
    `);
  return [...new Set((result.recordset as Array<{ email: string }>).map((r) => r.email).filter(Boolean))];
}

async function insertNote(
  pool: Awaited<ReturnType<typeof getPool>>,
  { idRequestGeneral, note, createdBy }: { idRequestGeneral: number; note: string; createdBy: string }
): Promise<void> {
  try {
    await pool
      .request()
      .input('note', sql.NVarChar(sql.MAX), note)
      .input('id_request', sql.Int, idRequestGeneral)
      .input('created_by', sql.NVarChar(1000), createdBy)
      .query(`INSERT INTO notes (note, id_request, created_by) VALUES (@note, @id_request, @created_by)`);
  } catch (err) {
    // No romper la transición por un problema al dejar la nota (igual criterio que
    // lib/sapsend/resolveWorkflowTask.js: la transición ya se confirmó).
    console.error('[workflowEngine] Error insertando nota:', err);
  }
}

export interface CreateVersionAndStartWorkflowParams {
  idDocument: number;
  versionNumber: number;
  onedriveItemId: string | null;
  onedrivePath: string;
  createdBy: string;
  comments: string | null;
  idCompany: number;
  ownerUserId: string;
  subject: string;
}

export interface CreateVersionAndStartWorkflowResult {
  idDocumentVersion: number;
  createdAt: Date;
  idRequestGeneral: number;
}

/**
 * Crea la fila de `document_version` Y arranca su flujo de aprobación
 * (`requests_general` + primera `task_request_general` en estado "En
 * creación", asignada al dueño) EN UNA SOLA transacción `sql.Transaction`.
 *
 * Por qué esto NO es un `prisma.$transaction` (fix del 2026-09-01, bug
 * reportado por Nicolás): `document_version` sí es un modelo Prisma, pero
 * `requests_general` / `task_request_general` / `process_category_request_general`
 * NUNCA lo fueron (motor de "solicitudes generales" en SQL crudo, ver nota de
 * módulo arriba) — viven detrás de un `mssql.ConnectionPool` totalmente
 * aparte del pool interno de Prisma (`lib/mssqlPool.ts` vs `lib/prisma.ts`).
 * Prisma y `mssql` no comparten conexión, así que un `prisma.$transaction`
 * jamás habría podido abarcar los INSERT de `requests_general`/
 * `task_request_general`: solo hubiera protegido la mitad del problema.
 *
 * Antes de este fix, `lib/document-management/newVersion.ts` hacía
 * `prisma.documentVersion.create(...)` (se confirmaba solo, en su propia
 * conexión) y LUEGO, en una llamada aparte, arrancaba este flujo. Si el
 * arranque fallaba (típicamente `WorkflowNotSeededError` cuando
 * `KRONOSDB_PRUEBAS` se refresca y pierde el seed de
 * `prisma/seeds/document-management-workflow.sql`), la `DocumentVersion` ya
 * había quedado comprometida en la base — huérfana, en "En creación", con el
 * archivo ya subido a OneDrive pero sin ninguna tarea de flujo asociada.
 *
 * La solución real es que AMBAS escrituras corran dentro de la MISMA
 * transacción de base de datos — por eso el INSERT de `document_version` se
 * movió aquí, a SQL crudo sobre esta misma `sql.Transaction`, en vez de vivir
 * como un `prisma.documentVersion.create` separado. Así, si cualquier paso
 * falla (seed faltante, catálogo incompleto, error de red a mitad de
 * transacción), el `ROLLBACK` deshace TODO, incluida la versión — nunca más
 * queda un registro a medio crear. La subida a OneDrive sigue ocurriendo
 * ANTES de llamar a esta función (ver newVersion.ts): una llamada HTTP
 * externa no puede ni debe vivir dentro de una transacción de base de datos.
 */
export async function createDocumentVersionAndStartWorkflow(
  params: CreateVersionAndStartWorkflowParams
): Promise<CreateVersionAndStartWorkflowResult> {
  const pool = await getPool();
  const { processId, taskIdByState } = await resolveWorkflowCatalog(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const versionInsert = await new sql.Request(transaction)
      .input('id_document', sql.Int, params.idDocument)
      .input('version_number', sql.Int, params.versionNumber)
      .input('status', sql.NVarChar(30), INITIAL_STATE)
      .input('onedrive_item_id', sql.NVarChar(300), params.onedriveItemId)
      .input('onedrive_path', sql.NVarChar(1000), params.onedrivePath)
      .input('created_by', sql.NVarChar(1000), params.createdBy)
      .input('comments', sql.NVarChar(1000), params.comments)
      .query(`
        INSERT INTO document_version
          (id_document, version_number, status, onedrive_item_id, onedrive_path, created_by, comments)
        OUTPUT INSERTED.id_document_version, INSERTED.created_at
        VALUES (@id_document, @version_number, @status, @onedrive_item_id, @onedrive_path, @created_by, @comments);
      `);
    const idDocumentVersion: number = versionInsert.recordset[0].id_document_version;
    const createdAt: Date = versionInsert.recordset[0].created_at;

    const reqInsert = await new sql.Request(transaction)
      .input('descripcion', sql.NVarChar(1000), params.subject)
      .input('subject', sql.NVarChar(255), params.subject)
      .input('company', sql.Int, params.idCompany)
      .input('requester', sql.NVarChar(1000), params.ownerUserId)
      .input('process', sql.Int, processId)
      .query(`
        INSERT INTO requests_general
          (description, subject_request, id_company, id_requester, id_process_category, status_req)
        OUTPUT INSERTED.id
        VALUES (@descripcion, @subject, @company, @requester, @process, 1);
      `);
    const idRequestGeneral: number = reqInsert.recordset[0].id;

    await new sql.Request(transaction)
      .input('id_request', sql.Int, idRequestGeneral)
      .input('process', sql.Int, processId)
      .query(`
        INSERT INTO process_category_request_general (id_request_general, id_process_category)
        VALUES (@id_request, @process);
      `);

    await new sql.Request(transaction)
      .input('id_request', sql.Int, idRequestGeneral)
      .input('id_task', sql.Int, taskIdByState[INITIAL_STATE])
      .input('id_user', sql.NVarChar(1000), params.ownerUserId)
      .query(`
        INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned)
        VALUES (@id_request, @id_task, 4, @id_user);
      `);

    await new sql.Request(transaction)
      .input('id_version', sql.Int, idDocumentVersion)
      .input('id_request', sql.Int, idRequestGeneral)
      .query(`UPDATE document_version SET id_request_general = @id_request WHERE id_document_version = @id_version`);

    await new sql.Request(transaction)
      .input('id_document', sql.Int, params.idDocument)
      .input('id_process', sql.Int, processId)
      .query(`UPDATE document SET id_process = @id_process WHERE id_document = @id_document AND id_process IS NULL`);

    await transaction.commit();
    return { idDocumentVersion, createdAt, idRequestGeneral };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export interface TransitionParams {
  idDocumentVersion: number;
  action: string;
  actorUserId: string;
  actorEmail: string;
  reason?: string | null;
}

export interface TransitionResult {
  fromState: DocumentWorkflowState | string;
  toState: DocumentWorkflowState | string;
  idDocument: number;
  idDocumentVersion: number;
}

/** Cierra la tarea abierta de un estado y abre la del estado destino. Núcleo de toda transición. */
async function moveTask(
  transaction: InstanceType<typeof sql.Transaction>,
  {
    idRequestGeneral,
    fromTaskId,
    toTaskId,
    closesAs,
    reason,
    actorUserId,
    assignToUserId,
  }: {
    idRequestGeneral: number;
    fromTaskId: number;
    toTaskId: number;
    closesAs: 2 | 3;
    reason: string | null;
    actorUserId: string;
    assignToUserId: string | null;
  }
): Promise<void> {
  await new sql.Request(transaction)
    .input('id_request', sql.Int, idRequestGeneral)
    .input('id_task', sql.Int, fromTaskId)
    .input('id_status', sql.Int, closesAs)
    .input('resolution', sql.NVarChar(sql.MAX), reason)
    .input('executor', sql.NVarChar(1000), actorUserId)
    .query(`
      UPDATE task_request_general
      SET id_status = @id_status, end_date = GETDATE(), date_resolution = GETDATE(),
          resolution = @resolution, id_executor_final = @executor
      WHERE id_request_general = @id_request AND id_task = @id_task AND id_status NOT IN (2, 3)
    `);

  await new sql.Request(transaction)
    .input('id_request', sql.Int, idRequestGeneral)
    .input('id_task', sql.Int, toTaskId)
    .input('id_user', sql.NVarChar(1000), assignToUserId)
    .query(`
      INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned)
      VALUES (@id_request, @id_task, 4, @id_user);
    `);
}

/** true si el estado se asigna siempre al dueño del documento (elaborar/reelaborar). */
function isOwnerAssignedState(state: string): boolean {
  return state === 'En elaboración' || state === 'Reelaboración';
}

/**
 * Ejecuta una transición de estado sobre una versión. Valida el grafo
 * (workflowStates.ts), cierra la tarea actual, abre la del estado destino,
 * deja nota en la bitácora, actualiza DocumentVersion/Document y notifica.
 *
 * El control de acceso (¿puede este usuario actuar?) se valida ANTES de
 * llamar a esta función, en la ruta API (mismo patrón que el resto del
 * módulo: la ruta resuelve permisos con lib/document-management/access.ts,
 * la lógica de negocio vive en lib/).
 */
export async function transitionDocumentVersion(params: TransitionParams): Promise<TransitionResult> {
  const version = await prisma.documentVersion.findUnique({
    where: { id_document_version: params.idDocumentVersion },
    include: { document: true },
  });
  if (!version) throw new WorkflowTransitionError('Versión no encontrada', 404);
  if (!version.id_request_general) {
    throw new WorkflowTransitionError('Esta versión no tiene un flujo de aprobación iniciado', 409);
  }

  const currentState = version.status;
  const isResume = params.action === RESUME_FROM_REASSIGNMENT_ACTION;

  const pool = await getPool();
  const { taskIdByState } = await resolveWorkflowCatalog(pool);

  let toState: string;
  let closesAs: 2 | 3;
  let requiresReason = false;

  if (isResume) {
    if (currentState !== 'Reasignación') {
      throw new WorkflowTransitionError('Solo se puede reanudar desde "Reasignación"', 409);
    }
    const prevResult = await pool
      .request()
      .input('id_request', sql.Int, version.id_request_general)
      .query(`
        SELECT TOP 1 tpc.task
        FROM task_request_general trg
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        WHERE trg.id_request_general = @id_request AND trg.id_status IN (2, 3) AND tpc.task <> N'Reasignación'
        ORDER BY trg.id DESC
      `);
    const previousState: string | undefined = prevResult.recordset[0]?.task;
    if (!previousState) {
      throw new WorkflowTransitionError('No se pudo determinar a qué estado reanudar', 409);
    }
    toState = previousState;
    closesAs = 2;
  } else {
    const def: WorkflowActionDef | undefined = findAction(currentState, params.action);
    if (!def) {
      throw new WorkflowTransitionError(
        `La acción "${params.action}" no es válida desde el estado "${currentState}"`,
        409
      );
    }
    toState = def.to;
    closesAs = def.closesTaskAs;
    requiresReason = !!def.requiresReason;
  }

  if (requiresReason && !params.reason?.trim()) {
    throw new WorkflowTransitionError('Esta acción exige registrar un motivo', 400);
  }

  const fromTaskId = taskIdByState[currentState];
  const toTaskId = taskIdByState[toState];
  if (!fromTaskId || !toTaskId) {
    throw new Error(`Estado sin tarea sembrada: ${!fromTaskId ? currentState : toState}`);
  }

  const assignToUserId = isOwnerAssignedState(toState) ? version.document.owner_user_id : null;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await moveTask(transaction, {
      idRequestGeneral: version.id_request_general,
      fromTaskId,
      toTaskId,
      closesAs,
      reason: params.reason?.trim() || null,
      actorUserId: params.actorUserId,
      assignToUserId,
    });

    await new sql.Request(transaction)
      .input('id_version', sql.Int, version.id_document_version)
      .input('status', sql.NVarChar(30), toState)
      .query(`UPDATE document_version SET status = @status WHERE id_document_version = @id_version`);

    // Si esta es la versión "actual" del documento, el estado del documento la sigue.
    if (version.document.current_version_id === version.id_document_version) {
      await new sql.Request(transaction)
        .input('id_document', sql.Int, version.id_document)
        .input('status', sql.NVarChar(30), toState)
        .query(`UPDATE document SET current_status = @status WHERE id_document = @id_document`);
    }

    let obsoletedVersionIds: number[] = [];
    if (toState === 'Vigente') {
      const othersResult = await new sql.Request(transaction)
        .input('id_document', sql.Int, version.id_document)
        .input('id_version', sql.Int, version.id_document_version)
        .query(`
          SELECT dv.id_document_version, dv.id_request_general
          FROM document_version dv
          WHERE dv.id_document = @id_document AND dv.status = N'Vigente' AND dv.id_document_version <> @id_version
        `);
      const others = othersResult.recordset as Array<{ id_document_version: number; id_request_general: number | null }>;
      for (const other of others) {
        await new sql.Request(transaction)
          .input('id_version', sql.Int, other.id_document_version)
          .query(`UPDATE document_version SET status = N'Obsoleto' WHERE id_document_version = @id_version`);
        if (other.id_request_general) {
          const obsoleteTaskId = taskIdByState['Obsoleto'];
          const vigenteTaskId = taskIdByState['Vigente'];
          await new sql.Request(transaction)
            .input('id_request', sql.Int, other.id_request_general)
            .input('id_task', sql.Int, vigenteTaskId)
            .query(`
              UPDATE task_request_general SET id_status = 2, end_date = GETDATE(), date_resolution = GETDATE(),
                     resolution = N'Reemplazada por una versión más nueva'
              WHERE id_request_general = @id_request AND id_task = @id_task AND id_status NOT IN (2, 3)
            `);
          await new sql.Request(transaction)
            .input('id_request', sql.Int, other.id_request_general)
            .input('id_task', sql.Int, obsoleteTaskId)
            .query(`
              INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned)
              VALUES (@id_request, @id_task, 2, NULL);
            `);
        }
      }
      obsoletedVersionIds = others.map((o) => o.id_document_version);

      await new sql.Request(transaction)
        .input('id_document', sql.Int, version.id_document)
        .input('id_version', sql.Int, version.id_document_version)
        .query(`UPDATE document SET current_version_id = @id_version, current_status = N'Vigente' WHERE id_document = @id_document`);
    }

    await insertNote(pool, {
      idRequestGeneral: version.id_request_general,
      note: `${currentState} → ${toState}${params.reason ? `: ${params.reason.trim()}` : ''}`,
      createdBy: params.actorUserId,
    });

    await transaction.commit();

    if (obsoletedVersionIds.length > 0) {
      // Fuera de la transacción (best-effort, no debe tumbar la transición ya confirmada).
      obsoletedVersionIds.forEach((idVersion) =>
        insertNote(pool, {
          idRequestGeneral: version.id_request_general!,
          note: `Versión ${idVersion} marcada como Obsoleta (reemplazada por la versión ${version.id_document_version})`,
          createdBy: params.actorUserId,
        })
      );
    }
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  fireAndForgetNotification(
    notifyDocumentTransition({
      idCompany: version.document.id_company,
      idDocument: version.id_document,
      code: version.document.code,
      title: version.document.title,
      versionNumber: version.version_number,
      ownerUserId: version.document.owner_user_id,
      fromState: currentState,
      toState,
      actorEmail: params.actorEmail,
    })
  );

  return {
    fromState: currentState,
    toState,
    idDocument: version.id_document,
    idDocumentVersion: version.id_document_version,
  };
}

interface NotifyTransitionParams {
  idCompany: number;
  idDocument: number;
  code: string;
  title: string;
  versionNumber: number;
  ownerUserId: string;
  fromState: string;
  toState: string;
  actorEmail: string;
}

/**
 * Notifica el cambio de estado (lib/notifications.js: fila en `notifications` + push).
 *   - Estado destino asignado al dueño (En elaboración / Reelaboración): solo al dueño.
 *   - Vigente u Obsoleto: al dueño del documento (interesado principal) + todos los
 *     usuarios con escritura en la empresa.
 *   - Cualquier otro estado (revisión/aprobación/calidad/divulgación/…): a todos los
 *     usuarios con escritura en la empresa, porque cualquiera de ellos puede tomar la
 *     tarea (no hay un revisor/aprobador fijo — ver la nota de control de acceso arriba).
 */
async function notifyDocumentTransition(params: NotifyTransitionParams): Promise<void> {
  const pool = await getPool();
  const owner = await prisma.user.findUnique({ where: { id: params.ownerUserId }, select: { email: true } });
  const url = documentDetailUrl(params.idDocument);
  const label = `${params.code} v${params.versionNumber} — ${params.title}`;

  const notifyOwnerOnly = isOwnerAssignedState(params.toState);
  const notifyStakeholders = params.toState === 'Vigente' || params.toState === 'Obsoleto';

  if (notifyOwnerOnly) {
    if (owner?.email) {
      await sendToEmails([owner.email], {
        title: 'Gestión Documental · tarea asignada',
        body: `${label}: pasó a "${params.toState}"`,
        url,
        tag: `doc-${params.idDocument}-${params.toState}`,
      });
    }
    return;
  }

  const writeEmails = await resolveWriteAccessEmails(pool, params.idCompany);
  const recipients = notifyStakeholders
    ? [...new Set([...(owner?.email ? [owner.email] : []), ...writeEmails])]
    : writeEmails;

  if (recipients.length === 0) return;

  await sendToEmails(recipients, {
    title: notifyStakeholders ? `Gestión Documental · documento ${params.toState.toLowerCase()}` : 'Gestión Documental · tarea pendiente',
    body: `${label}: pasó de "${params.fromState}" a "${params.toState}"`,
    url,
    tag: `doc-${params.idDocument}-${params.toState}`,
  });
}

export interface PendingDocumentTask {
  idDocument: number;
  idDocumentVersion: number;
  code: string;
  title: string;
  versionNumber: number;
  companyId: number;
  companyName: string;
  state: string;
  assignedToMe: boolean;
}

/**
 * Tareas documentales pendientes que el usuario puede accionar: las asignadas
 * directamente a él (dueño en En elaboración/Reelaboración) más las abiertas
 * sin responsable fijo (revisión/aprobación/calidad/divulgación/reasignación)
 * de cualquier empresa donde tenga permiso de ESCRITURA.
 */
export async function getPendingDocumentTasksForUser(
  userId: string,
  writableCompanyIds: number[]
): Promise<PendingDocumentTask[]> {
  if (writableCompanyIds.length === 0) return [];

  const pool = await getPool();
  const { processId } = await resolveWorkflowCatalog(pool);

  const result = await pool
    .request()
    .input('id_process', sql.Int, processId)
    .input('id_user', sql.NVarChar(1000), userId)
    .query(`
      SELECT
        d.id_document, d.code, d.title, d.id_company,
        c.company AS company_name,
        dv.id_document_version, dv.version_number, dv.status,
        trg.id_assigned
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task AND tpc.id_process_category = @id_process
      INNER JOIN document_version dv ON dv.id_request_general = trg.id_request_general AND dv.status = tpc.task
      INNER JOIN document d ON d.id_document = dv.id_document
      INNER JOIN company c ON c.id_company = d.id_company
      WHERE trg.id_status = 4 AND (trg.id_assigned IS NULL OR trg.id_assigned = @id_user)
    `);

  const rows = result.recordset as Array<{
    id_document: number;
    code: string;
    title: string;
    id_company: number;
    company_name: string;
    id_document_version: number;
    version_number: number;
    status: string;
    id_assigned: string | null;
  }>;

  return rows
    .filter((r) => r.id_assigned === userId || writableCompanyIds.includes(r.id_company))
    .map((r) => ({
      idDocument: r.id_document,
      idDocumentVersion: r.id_document_version,
      code: r.code,
      title: r.title,
      versionNumber: r.version_number,
      companyId: r.id_company,
      companyName: r.company_name,
      state: r.status,
      assignedToMe: r.id_assigned === userId,
    }));
}
