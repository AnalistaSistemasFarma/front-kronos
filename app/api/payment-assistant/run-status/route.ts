import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { userCanAccessCompany } from '../../../../lib/payment-assistant/access';
import { getPool, sql } from '../../../../lib/mssqlPool';
import { mapAuthStatusToRunStatus } from '../../../../lib/payment-assistant/paymentRun';

/**
 * ESTADO de una corrida de pago (Asistente de Pagos).
 *
 * GET /api/payment-assistant/run-status?companyId=<id>[&runId=<id>]
 *
 * Devuelve la ÚLTIMA corrida de la empresa (o la del `runId` indicado) con su estado REAL,
 * consultando el `id_status` de la tarea de autorización de su solicitud
 * (2 -> 'aprobada', 3 -> 'rechazada', 4/otro -> 'pendiente'). Sincroniza `payment_run.auth_status`
 * con ese estado y lo devuelve. Si la empresa no tiene ninguna corrida, responde `run: null`.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = session.user.email;

    const companyIdRaw = request.nextUrl.searchParams.get('companyId');
    const companyId = Number(companyIdRaw);
    if (!companyIdRaw || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
    }

    const canAccess = await userCanAccessCompany(userEmail, companyId);
    if (!canAccess) {
      return NextResponse.json({ error: 'No tiene acceso a esta empresa.' }, { status: 403 });
    }

    const runIdRaw = request.nextUrl.searchParams.get('runId');
    const runId = runIdRaw ? Number(runIdRaw) : null;

    const pool = await getPool();

    // 1) Localizar la corrida: por runId (validando empresa) o la última de la empresa.
    const runReq = pool.request().input('companyId', sql.Int, companyId);
    let runQuery = `
      SELECT TOP 1 pr.id, pr.id_request_general, pr.total, pr.auth_status, pr.created_at
      FROM payment_run pr
      WHERE pr.id_company = @companyId`;
    if (runId != null && Number.isFinite(runId)) {
      runReq.input('runId', sql.Int, runId);
      runQuery += ` AND pr.id = @runId`;
    }
    runQuery += ` ORDER BY pr.id DESC`;
    const runResult = await runReq.query(runQuery);
    const run = runResult.recordset[0];

    if (!run) {
      return NextResponse.json({ run: null });
    }

    // 2) Estado real desde la tarea de autorización de esa solicitud.
    let idStatus: number | null = null;
    if (run.id_request_general != null) {
      const taskResult = await pool
        .request()
        .input('rid', sql.Int, run.id_request_general)
        .query(`
          SELECT TOP 1 trg.id_status
          FROM task_request_general trg
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          WHERE trg.id_request_general = @rid AND tpc.is_authorization = 1
          ORDER BY trg.id DESC
        `);
      idStatus = taskResult.recordset[0]?.id_status ?? null;
    }

    const status = mapAuthStatusToRunStatus(idStatus);

    // 3) Sincronizar payment_run.auth_status si cambió.
    if (status !== run.auth_status) {
      await pool
        .request()
        .input('id', sql.Int, run.id)
        .input('status', sql.VarChar(20), status)
        .query(`UPDATE payment_run SET auth_status = @status WHERE id = @id`);
    }

    return NextResponse.json({
      run: {
        runId: run.id,
        requestId: run.id_request_general,
        total: run.total,
        status,
        idStatus,
        createdAt: run.created_at,
      },
    });
  } catch (error) {
    console.error('Error consultando el estado de la corrida de pago:', error);
    const message = error instanceof Error ? error.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
