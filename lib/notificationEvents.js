import sql from 'mssql';
import sqlConfig from '../dbconfig.js';
import { createAndSendNotifications } from './notifications.js';

const HELP_DESK_SUBPROCESS_ID = 1;
/** Estados de ticket cerrados (Resuelto / Cancelado) */
const TICKET_CLOSED_STATUS_IDS = [2, 3];
/** Estado de actividad resuelta */
const ACTIVITY_RESOLVED_STATUS_ID = 2;

export function getAppBaseUrl() {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.MICROSOFTURI ||
    process.env.NEXTAUTH_URL ||
    '';
  return base.replace(/\/$/, '');
}

/** Ruta interna de la app (relativa). El cliente y el SW resuelven el origen al navegar. */
export function buildAppUrl(path) {
  return path.startsWith('/') ? path : `/${path}`;
}

/** URL absoluta solo para contextos externos (correo, enlaces fuera de la SPA). */
export function buildAbsoluteAppUrl(path) {
  const normalized = buildAppUrl(path);
  const base = getAppBaseUrl();
  return base ? `${base}${normalized}` : normalized;
}

/** No bloquea la respuesta HTTP si falla el envío. */
export function fireAndForgetNotification(promise) {
  Promise.resolve(promise).catch((err) => {
    console.error('[notificationEvents]', err);
  });
}

async function getPool() {
  return sql.connect(sqlConfig);
}

export async function resolveEmailByUserId(userId) {
  if (userId == null || userId === '') return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.NVarChar(255), String(userId))
    .query(`SELECT TOP 1 email FROM [user] WHERE id = @id AND email IS NOT NULL`);
  return result.recordset[0]?.email ?? null;
}

export async function resolveEmailByTechnicalId(technicalId) {
  if (technicalId == null || technicalId === '') return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, Number(technicalId))
    .query(`
      SELECT TOP 1 u.email
      FROM subprocess_user_company suc
      INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      INNER JOIN [user] u ON u.id = cu.id_user
      WHERE suc.id_subprocess_user_company = @id AND u.email IS NOT NULL
    `);
  return result.recordset[0]?.email ?? null;
}

export async function resolveHelpDeskTechnicianEmails() {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('subprocess', sql.Int, HELP_DESK_SUBPROCESS_ID)
    .query(`
      SELECT DISTINCT u.email
      FROM subprocess_user_company suc
      INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
      INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      INNER JOIN [user] u ON u.id = cu.id_user
      WHERE s.id_subprocess = @subprocess AND u.email IS NOT NULL
    `);
  return [...new Set(result.recordset.map((r) => r.email).filter(Boolean))];
}

async function sendToEmails(emails, payload) {
  const unique = [...new Set((emails || []).filter(Boolean))];
  if (unique.length === 0) return { saved: 0, pushed: 0 };
  return createAndSendNotifications(unique, payload);
}

export function isTicketClosedStatus(statusId) {
  return TICKET_CLOSED_STATUS_IDS.includes(Number(statusId));
}

export function isActivityResolvedStatus(statusId) {
  return Number(statusId) === ACTIVITY_RESOLVED_STATUS_ID;
}

async function resolveRequestStakeholderEmails(requestId, { excludeEmail } = {}) {
  if (!requestId) return [];
  const pool = await getPool();
  const result = await pool.request().input('id', sql.Int, Number(requestId)).query(`
    SELECT DISTINCT u.email
    FROM requests_general rg
    INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
    INNER JOIN user_process_category_request_general upcrg ON upcrg.id_process_category = pcrg.id_process_category
    INNER JOIN [user] u ON u.id = upcrg.id_user
    WHERE rg.id = @id AND u.email IS NOT NULL
    UNION
    SELECT ur.email
    FROM requests_general rg
    INNER JOIN [user] ur ON ur.id = rg.id_requester
    WHERE rg.id = @id AND ur.email IS NOT NULL
  `);
  return [...new Set(result.recordset.map((r) => r.email).filter(Boolean))].filter(
    (e) => !excludeEmail || e !== excludeEmail
  );
}

/**
 * Ticket nuevo o reasignado a un técnico.
 */
export async function notifyTicketToTechnicians({
  caseId,
  subject,
  technicianId,
  isReassignment = false,
}) {
  let emails = [];

  if (technicianId) {
    const techEmail = await resolveEmailByTechnicalId(technicianId);
    if (techEmail) emails.push(techEmail);
  } else {
    emails = await resolveHelpDeskTechnicianEmails();
  }

  const title = isReassignment
    ? 'Ticket reasignado · Mesa de ayuda'
    : 'Nuevo ticket · Mesa de ayuda';

  return sendToEmails(emails, {
    title,
    body: `#${caseId} — ${subject || 'Sin asunto'}`,
    url: buildAppUrl(`/process/help-desk/view-ticket?id=${caseId}`),
    tag: `ticket-${caseId}`,
  });
}

/**
 * Nueva solicitud: encargado de proceso + usuarios con tareas asignadas.
 */
export async function notifyNewRequest({
  requestId,
  subject,
  processEmail,
  taskEmails = [],
  requestUrl,
}) {
  const viewUrl =
    requestUrl && String(requestUrl).trim()
      ? String(requestUrl).trim()
      : buildAppUrl(`/process/request-general/view-request?id=${requestId}&from=general-requests`);

  const activitiesUrl = buildAppUrl(
    `/process/request-general/view-activities?id=${requestId}&from=assigned-activities`
  );

  const processList = processEmail ? [processEmail] : [];
  const taskList = [...new Set((taskEmails || []).filter(Boolean))].filter(
    (e) => !processList.includes(e)
  );

  const results = [];

  if (processList.length > 0) {
    results.push(
      await sendToEmails(processList, {
        title: 'Nueva solicitud · SynerLink',
        body: `#${requestId} — ${subject || 'Sin asunto'}`,
        url: viewUrl,
        tag: `request-${requestId}`,
      })
    );
  }

  if (taskList.length > 0) {
    results.push(
      await sendToEmails(taskList, {
        title: 'Actividad asignada · SynerLink',
        body: `Tienes una actividad en la solicitud #${requestId} — ${subject || 'Sin asunto'}`,
        url: activitiesUrl,
        tag: `task-${requestId}`,
      })
    );
  }

  return results;
}

/**
 * Actividad reasignada manualmente a otro usuario.
 */
export async function notifyActivityAssigned({ taskId, userId, requestId, subject, taskName }) {
  const email = await resolveEmailByUserId(userId);
  if (!email) return { saved: 0, pushed: 0 };

  let resolvedRequestId = requestId;
  let resolvedSubject = subject;
  let resolvedTaskName = taskName;

  if (!resolvedRequestId || !resolvedSubject) {
    const pool = await getPool();
    const info = await pool.request().input('id', sql.Int, Number(taskId)).query(`
      SELECT trg.id_request_general, rg.subject_request, tpc.task
      FROM task_request_general trg
      INNER JOIN requests_general rg ON rg.id = trg.id_request_general
      LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id = @id
    `);
    const row = info.recordset[0];
    if (row) {
      resolvedRequestId = resolvedRequestId ?? row.id_request_general;
      resolvedSubject = resolvedSubject ?? row.subject_request;
      resolvedTaskName = resolvedTaskName ?? row.task;
    }
  }

  const reqLabel = resolvedRequestId ? `#${resolvedRequestId}` : '';
  const taskLabel = resolvedTaskName ? ` · ${resolvedTaskName}` : '';

  return sendToEmails([email], {
    title: 'Actividad asignada · SynerLink',
    body: `${reqLabel}${taskLabel}${resolvedSubject ? ` — ${resolvedSubject}` : ''}`.trim(),
    url: resolvedRequestId
      ? buildAppUrl(
          `/process/request-general/view-activities?id=${resolvedRequestId}&from=assigned-activities`
        )
      : buildAppUrl('/process/request-general/assigned-activities'),
    tag: `activity-task-${taskId}`,
  });
}

/**
 * Ticket cerrado (Resuelto o Cancelado) — notifica al solicitante.
 */
export async function notifyTicketClosed({ caseId, subject, requesterUserId, statusId }) {
  const email = await resolveEmailByUserId(requesterUserId);
  if (!email) return { saved: 0, pushed: 0 };

  const isCancelled = Number(statusId) === 3;
  const title = isCancelled
    ? 'Ticket cancelado · Mesa de ayuda'
    : 'Ticket resuelto · Mesa de ayuda';
  const statusLabel = isCancelled ? 'cancelado' : 'resuelto';

  return sendToEmails([email], {
    title,
    body: `#${caseId} — ${subject || 'Sin asunto'} (${statusLabel})`,
    url: buildAppUrl(`/process/help-desk/view-ticket?id=${caseId}`),
    tag: `ticket-closed-${caseId}`,
  });
}

/**
 * Actividad marcada como resuelta — notifica creador de la solicitud y encargados del proceso.
 */
export async function notifyActivityResolved({
  taskId,
  requestId,
  subject,
  taskName,
  executorUserId,
}) {
  let resolvedRequestId = requestId;
  let resolvedSubject = subject;
  let resolvedTaskName = taskName;

  if (!resolvedRequestId || !resolvedSubject || !resolvedTaskName) {
    const pool = await getPool();
    const info = await pool.request().input('id', sql.Int, Number(taskId)).query(`
      SELECT trg.id_request_general, rg.subject_request, tpc.task
      FROM task_request_general trg
      INNER JOIN requests_general rg ON rg.id = trg.id_request_general
      LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id = @id
    `);
    const row = info.recordset[0];
    if (row) {
      resolvedRequestId = resolvedRequestId ?? row.id_request_general;
      resolvedSubject = resolvedSubject ?? row.subject_request;
      resolvedTaskName = resolvedTaskName ?? row.task;
    }
  }

  const executorEmail = executorUserId
    ? await resolveEmailByUserId(executorUserId)
    : null;

  const emails = await resolveRequestStakeholderEmails(resolvedRequestId, {
    excludeEmail: executorEmail,
  });

  if (emails.length === 0) return { saved: 0, pushed: 0 };

  const reqLabel = resolvedRequestId ? `#${resolvedRequestId}` : '';
  const taskLabel = resolvedTaskName ? ` · ${resolvedTaskName}` : '';

  return sendToEmails(emails, {
    title: 'Actividad resuelta · SynerLink',
    body: `${reqLabel}${taskLabel}${resolvedSubject ? ` — ${resolvedSubject}` : ''}`.trim(),
    url: resolvedRequestId
      ? buildAppUrl(
          `/process/request-general/view-request?id=${resolvedRequestId}&from=general-requests`
        )
      : buildAppUrl('/process/request-general/assigned-activities'),
    tag: `activity-resolved-${taskId}`,
  });
}
