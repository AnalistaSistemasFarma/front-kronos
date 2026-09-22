import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getDocumentManagementAccess } from '../../../../lib/document-management/access';
import { getPool, sql } from '../../../../lib/mssqlPool';
import { resolveWorkflowCatalog, WorkflowNotSeededError } from '../../../../lib/document-management/workflowEngine';

/**
 * Tareas sembradas (task_process_category) del proceso "Gestión Documental —
 * Ciclo de vida del documento", en orden de `display_order`. Reutiliza
 * `resolveWorkflowCatalog` (misma resolución por NOMBRE que usa
 * workflowEngine.transitionDocumentVersion, nunca un id hardcodeado — ver la
 * nota de módulo en workflowEngine.ts) en vez de duplicar la consulta.
 *
 * Usada por el componente de diagrama (components/workflow/WorkflowDiagram)
 * en la página de detalle de un documento (app/(hub)/process/document-management/[id]),
 * donde —a diferencia de la pantalla de administración de flujos, que ya
 * conoce el id_process_category del flujo seleccionado— no se tiene ese id de
 * antemano.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getDocumentManagementAccess(session.user.email);
    if (!access.some((a) => a.canRead)) {
      return NextResponse.json({ error: 'Sin acceso al módulo' }, { status: 403 });
    }

    const pool = await getPool();
    let catalog;
    try {
      catalog = await resolveWorkflowCatalog(pool);
    } catch (err) {
      if (err instanceof WorkflowNotSeededError) {
        return NextResponse.json({ tasks: [] });
      }
      throw err;
    }

    const tasksResult = await pool
      .request()
      .input('id_process', sql.Int, catalog.processId)
      .query(`
        SELECT id, task, display_order
        FROM task_process_category
        WHERE id_process_category = @id_process AND active = 1
        ORDER BY display_order, id
      `);

    return NextResponse.json({ tasks: tasksResult.recordset });
  } catch (error) {
    console.error('Error listando tareas del flujo de Gestión Documental:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
