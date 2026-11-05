import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { canReadLinkedSale } from '../../../../lib/sales/requestAccess';
import { runSapExecutors } from '../../../../lib/workflow-sap/engine';

/**
 * Reintenta las Tareas SAP en error de la oferta enlazada a una solicitud (botón
 * «Reintentar» del bloque de la oferta). Cada acción es idempotente.
 * POST { requestId } -> { executed, errors }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    if (!requestId) return NextResponse.json({ error: 'Falta requestId' }, { status: 400 });
    const pool = await sql.connect(sqlConfig);
    const r = await pool.request().input('r', sql.Int, requestId).query(`SELECT TOP 1 id_company FROM dbo.sales_authorization WHERE id_request_general = @r;`);
    const link = r.recordset[0];
    if (!link) return NextResponse.json({ error: 'La solicitud no es de una oferta de venta.' }, { status: 404 });
    if (!(await canReadLinkedSale(session.user.email, requestId, link.id_company))) {
      return NextResponse.json({ error: 'Sin acceso a esta oferta de venta' }, { status: 403 });
    }
    const result = await runSapExecutors(requestId, 'retry');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Error reintentando las tareas SAP de la oferta:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
