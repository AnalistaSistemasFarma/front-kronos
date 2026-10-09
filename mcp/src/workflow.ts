/**
 * Instanciación de tareas de una solicitud recién creada, IGUAL que la app.
 *
 * Réplica fiel de la parte de tareas de `lib/requests-general/createGeneralRequest.js`
 * (flujo interno POST /api/requests-general/create-request y formulario público):
 *
 *  - Solo plantillas activas (task_process_category.active = 1), ordenadas por
 *    display_order y luego id. LEFT JOIN a los responsables: una tarea puede
 *    no tener responsable.
 *  - Condiciones por opción (task_condition_option): una tarea condicionada solo
 *    se instancia si se eligió alguna de sus opciones; sin condiciones, siempre.
 *  - CREACIÓN DIFERIDA (lazy) de secuenciales: al crear la solicitud solo se
 *    instancian las NO secuenciales + la PRIMERA del orden. Las siguientes las
 *    crea el avance del flujo al cerrar la anterior (app:
 *    lib/workflow/advanceSequentialTask.js; MCP: kronos_resolve_task).
 *  - Tarea normal sin responsable: se omite. Autorización sin responsable: se
 *    crea con id_assigned = NULL (la toma el pool por tipo de autorización).
 *  - Estado inicial id_status = 4 (Sin Empezar).
 *
 * Antes, kronos_create_request instanciaba TODAS las tareas del flujo de una
 * vez (INNER JOIN, sin active, sin lazy ni condiciones), distinto de la app.
 */
import { Prisma } from './db.js';
import type { TxClient } from './write.js';

export interface TaskTemplateRow {
  id_task: number;
  task?: string | null;
  is_sequential: boolean | number | null;
  display_order: number | null;
  is_authorization: boolean | number | null;
  id_user: string | null;
  email: string | null;
  name?: string | null;
}

export interface CreatedTask {
  id_task: number;
  task: string | null;
  id_assigned: string | null;
  email: string | null;
  name: string | null;
  is_authorization: boolean;
}

/**
 * Decide (función pura) qué filas de plantilla se instancian al crear la
 * solicitud. Exportada para probar la regla sin base de datos.
 */
export function selectInitialTasks(
  rows: TaskTemplateRow[],
  conditions: { id_task: number; id_option: number }[],
  selectedOptionIds: number[] = []
): TaskTemplateRow[] {
  const taskConditions = new Map<number, number[]>();
  for (const c of conditions) {
    const list = taskConditions.get(c.id_task) ?? [];
    list.push(Number(c.id_option));
    taskConditions.set(c.id_task, list);
  }
  const selected = new Set(selectedOptionIds.map(Number));
  const eligible = rows.filter((r) => {
    const conds = taskConditions.get(r.id_task);
    return !conds || conds.length === 0 || conds.some((o) => selected.has(o));
  });

  let first: TaskTemplateRow | null = null;
  for (const r of eligible) {
    if (!first) {
      first = r;
      continue;
    }
    const ra = r.display_order ?? 0;
    const ma = first.display_order ?? 0;
    if (ra < ma || (ra === ma && r.id_task < first.id_task)) first = r;
  }
  const firstTaskId = first ? first.id_task : null;

  return eligible.filter((r) => {
    if (r.is_sequential && r.id_task !== firstTaskId) return false;
    const hasAssignee = r.id_user != null;
    if (!hasAssignee && !r.is_authorization) return false;
    return true;
  });
}

/** Instancia las tareas iniciales de la solicitud dentro de la transacción. */
export async function instantiateInitialTasks(
  tx: TxClient,
  requestId: number,
  processId: number,
  selectedOptionIds: number[] = []
): Promise<CreatedTask[]> {
  const rows = await tx.$queryRaw<TaskTemplateRow[]>(Prisma.sql`
    SELECT tpc.id AS id_task, tpc.task, tpc.is_sequential, tpc.display_order,
           tpc.is_authorization, utrg.id_user, u.email, u.name
    FROM task_process_category tpc
    LEFT JOIN user_task_request_general utrg ON utrg.id_task = tpc.id
    LEFT JOIN [user] u ON u.id = utrg.id_user
    WHERE tpc.id_process_category = ${processId}
      AND tpc.active = 1
    ORDER BY tpc.display_order, tpc.id
  `);
  const conditions = await tx.$queryRaw<{ id_task: number; id_option: number }[]>(Prisma.sql`
    SELECT tco.id_task, tco.id_option
    FROM task_condition_option tco
    INNER JOIN task_process_category tpc ON tpc.id = tco.id_task
    WHERE tpc.id_process_category = ${processId} AND tpc.active = 1
  `);

  const toCreate = selectInitialTasks(rows, conditions, selectedOptionIds);
  const created: CreatedTask[] = [];
  for (const r of toCreate) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned)
      VALUES (${requestId}, ${r.id_task}, 4, ${r.id_user ?? null})
    `);
    created.push({
      id_task: r.id_task,
      task: typeof r.task === 'string' ? r.task.trim() : null,
      id_assigned: r.id_user ?? null,
      email: r.email ? String(r.email).trim().toLowerCase() : null,
      name: r.name ?? null,
      is_authorization: Boolean(r.is_authorization),
    });
  }
  return created;
}

/** Correos de los encargados del proceso (como la app: DISTINCT, sin vacíos). */
export async function processOwnerEmails(tx: TxClient, processId: number): Promise<string[]> {
  const rows = await tx.$queryRaw<{ email: string | null }[]>(Prisma.sql`
    SELECT DISTINCT u.email
    FROM user_process_category_request_general upcrg
    INNER JOIN [user] u ON u.id = upcrg.id_user
    WHERE upcrg.id_process_category = ${processId}
      AND u.email IS NOT NULL
      AND LTRIM(RTRIM(u.email)) <> N''
  `);
  return [
    ...new Set(rows.map((r) => String(r.email ?? '').trim().toLowerCase()).filter(Boolean)),
  ];
}

/**
 * Persiste las notificaciones de campana (tabla notifications) igual que
 * notifyNewRequest de la app: confirmación al creador, "Nueva solicitud" a los
 * encargados del proceso y "Actividad asignada" a los responsables de las
 * tareas creadas (sin duplicar al creador ni a los encargados). El push del
 * navegador lo envía la app; aquí se guarda la parte durable.
 */
export async function insertNewRequestNotifications(
  tx: TxClient,
  opts: {
    requestId: number;
    subject: string;
    creatorEmail: string | null;
    processEmails: string[];
    taskEmails: string[];
    url?: string | null;
  }
): Promise<{ creator: string | null; process: string[]; tasks: string[] }> {
  const { requestId, subject } = opts;
  const viewUrl =
    opts.url && opts.url.trim()
      ? opts.url.trim()
      : `/process/request-general/view-request?id=${requestId}&from=general-requests`;
  const creatorUrl = `/process/request-general/view-request?id=${requestId}&from=create-request`;
  const activitiesUrl = `/process/request-general/view-activities?requestId=${requestId}&from=assigned-activities`;
  const creator = opts.creatorEmail ? opts.creatorEmail.trim().toLowerCase() : null;
  const processList = [...new Set(opts.processEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const taskList = [...new Set(opts.taskEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))].filter(
    (e) => !processList.includes(e)
  );

  if (creator) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO notifications (email, title, body, url)
      VALUES (${creator}, ${'Solicitud creada · SynerLink'}, ${`Tu solicitud #${requestId} — ${subject} fue registrada correctamente.`}, ${creatorUrl})
    `);
  }
  const processNotify = processList.filter((e) => e !== creator);
  for (const email of processNotify) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO notifications (email, title, body, url)
      VALUES (${email}, ${'Nueva solicitud · SynerLink'}, ${`#${requestId} — ${subject}`}, ${viewUrl})
    `);
  }
  const taskNotify = taskList.filter((e) => e !== creator);
  for (const email of taskNotify) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO notifications (email, title, body, url)
      VALUES (${email}, ${'Actividad asignada · SynerLink'}, ${`Tienes una actividad en la solicitud #${requestId} — ${subject}`}, ${activitiesUrl})
    `);
  }
  return { creator, process: processNotify, tasks: taskNotify };
}
