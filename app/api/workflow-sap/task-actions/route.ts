import sql from 'mssql';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { prisma } from '../../../../lib/prisma';
import { triggersFor, validateTaskAction, type TaskKind, type TriggerEvent } from '../../../../lib/workflow-sap/catalog';

/**
 * Configuracion SAP de las tareas de un flujo (pantalla «Ver flujos»).
 * GET ?processId=N           -> tareas del proceso con su tipo y sus acciones SAP.
 * PUT { taskId, taskKind, actions: [{ trigger, actionKey }] }
 *     -> guarda el tipo de la tarea y REEMPLAZA sus acciones (validadas contra el catalogo).
 * Acceso: administradores o quien tenga el subproceso de flujos de trabajo.
 */

const WORKFLOW_URLS = ['/process/request-general/workflows', '/process/request-general/admin-workflow'];

async function canManage(email: string): Promise<boolean> {
  if (await checkAdminPrivileges(email)) return true;
  const row = await prisma.subprocessUserCompany.findFirst({
    where: { companyUser: { user: { email } }, subprocess: { subprocess_url: { in: WORKFLOW_URLS } } },
    select: { id_subprocess_user_company: true },
  });
  return Boolean(row);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canManage(session.user.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const processId = Number(new URL(request.url).searchParams.get('processId'));
    if (!processId) return NextResponse.json({ error: 'Falta processId' }, { status: 400 });

    const pool = await sql.connect(sqlConfig);
    const [tasks, actions] = await Promise.all([
      pool.request().input('p', sql.Int, processId).query(`
        SELECT id, task, task_kind, is_authorization FROM task_process_category
        WHERE id_process_category = @p ORDER BY display_order, id;`),
      pool.request().input('p', sql.Int, processId).query(`
        SELECT tsa.id_task, tsa.trigger_event, tsa.action_key, tsa.display_order
        FROM dbo.task_sap_action tsa
        INNER JOIN task_process_category tpc ON tpc.id = tsa.id_task
        WHERE tpc.id_process_category = @p AND tsa.active = 1
        ORDER BY tsa.display_order, tsa.id;`),
    ]);
    const byTask = new Map<number, { trigger: string; actionKey: string }[]>();
    for (const a of actions.recordset) {
      const list = byTask.get(a.id_task) ?? [];
      list.push({ trigger: a.trigger_event, actionKey: a.action_key });
      byTask.set(a.id_task, list);
    }
    return NextResponse.json(
      {
        tasks: tasks.recordset.map((t) => ({
          id: t.id,
          task: t.task,
          taskKind: t.is_authorization ? 'authorization' : t.task_kind === 'sap_executor' ? 'sap_executor' : 'normal',
          actions: byTask.get(t.id) ?? [],
        })),
        usesDefaults: actions.recordset.length === 0,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error leyendo la configuración SAP del flujo:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canManage(session.user.email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const taskId = Number(body.taskId);
    const taskKind = body.taskKind as TaskKind;
    const actions: { trigger: TriggerEvent; actionKey: string }[] = Array.isArray(body.actions) ? body.actions : [];
    if (!taskId || !['normal', 'authorization', 'sap_executor'].includes(taskKind)) {
      return NextResponse.json({ error: 'Falta taskId o un tipo de tarea válido' }, { status: 400 });
    }

    const pool = await sql.connect(sqlConfig);
    const current = await pool
      .request()
      .input('id', sql.Int, taskId)
      .query(`SELECT id, is_authorization, type_authorization FROM task_process_category WHERE id = @id;`);
    const task = current.recordset[0];
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });

    // El tipo «autorización» lo define la propia tarea (is_authorization): aquí no se cambia.
    if ((taskKind === 'authorization') !== Boolean(task.is_authorization)) {
      return NextResponse.json(
        { error: 'Que una tarea sea de autorización se define al editar la tarea, no aquí.' },
        { status: 422 }
      );
    }

    const allowed = triggersFor(taskKind);
    const errors: string[] = [];
    for (const a of actions) {
      if (!allowed.includes(a.trigger)) errors.push(`El disparador ${a.trigger} no aplica a este tipo de tarea.`);
      errors.push(...validateTaskAction({ taskKind, actionKey: a.actionKey, trigger: a.trigger }));
    }
    if (taskKind === 'sap_executor' && actions.length === 0) {
      errors.push('Una tarea ejecutora SAP necesita al menos una acción.');
    }
    if (errors.length > 0) return NextResponse.json({ error: 'Configuración inválida', errors }, { status: 422 });

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input('id', sql.Int, taskId)
        .input('kind', sql.NVarChar(20), taskKind)
        .query(`UPDATE task_process_category SET task_kind = @kind WHERE id = @id;`);
      await new sql.Request(tx).input('id', sql.Int, taskId).query(`DELETE FROM dbo.task_sap_action WHERE id_task = @id;`);
      for (const [i, a] of actions.entries()) {
        await new sql.Request(tx)
          .input('id', sql.Int, taskId)
          .input('trigger', sql.NVarChar(20), a.trigger)
          .input('action', sql.NVarChar(50), a.actionKey)
          .input('order', sql.Int, i + 1)
          .query(`INSERT INTO dbo.task_sap_action (id_task, trigger_event, action_key, display_order)
                  VALUES (@id, @trigger, @action, @order);`);
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error guardando la configuración SAP de la tarea:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
