import sql from 'mssql';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getPurchasesAccess } from '../../../../lib/purchases/access';
import { companySap } from '../../../../lib/purchases/authorization';
import { prisma } from '../../../../lib/prisma';
import { sapGet, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Detalle de la solicitud de compra enlazada a una solicitud de «Mis solicitudes»
 * (requests_general.id -> purchase_authorization -> borrador en SAP), para mostrarla
 * con el diseño de SAPSEND dentro del detalle de la solicitud.
 *
 * Acceso: el solicitante, quien tenga o haya tenido una tarea de esa solicitud
 * (autorizadores), o quien lea Compras en esa empresa. La lectura en SAP usa la
 * conexion de la empresa porque un autorizador no necesita permiso de Compras.
 * GET ?requestId=N -> { purchase: null } si la solicitud no es de compras.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const requestId = Number(new URL(request.url).searchParams.get('requestId'));
    if (!requestId) return NextResponse.json({ purchase: null });

    const link = await prisma.purchaseAuthorization.findUnique({ where: { id_request_general: requestId } });
    if (!link) return NextResponse.json({ purchase: null });

    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const pool = await sql.connect(sqlConfig);
    const involved = await pool
      .request()
      .input('req', sql.Int, requestId)
      .input('u', sql.NVarChar(50), user.id)
      .query(`
        SELECT TOP 1 1 AS ok FROM requests_general rg
        WHERE rg.id = @req AND (
          rg.id_requester = @u
          OR EXISTS (SELECT 1 FROM task_request_general t
                     WHERE t.id_request_general = rg.id AND (t.id_assigned = @u OR t.id_executor_final = @u))
        );`);
    const canRead =
      involved.recordset.length > 0 ||
      (await getPurchasesAccess(session.user.email)).some((a) => a.idCompany === link.id_company && a.canRead);
    if (!canRead) return NextResponse.json({ error: 'Sin acceso a esta solicitud de compra' }, { status: 403 });

    const sap = await companySap(link.id_company);
    try {
      const draft = await sapGet<Record<string, unknown>>(sap, `Drafts(${link.doc_entry})`);
      let firmDocNum: number | null = null;
      const solCom = String(draft.U_SEND_SolCom ?? '').trim();
      if (/^\d+$/.test(solCom)) {
        const firm = await sapGet<{ DocNum?: number }>(sap, `PurchaseRequests(${solCom})?$select=DocNum`).catch(() => null);
        firmDocNum = firm?.DocNum ?? null;
      }
      return NextResponse.json({
        purchase: {
          companyId: link.id_company,
          docEntry: link.doc_entry,
          firmDocEntry: /^\d+$/.test(solCom) ? Number(solCom) : null,
          firmDocNum,
          authorizationStatus: link.status,
          draft,
        },
      });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error consultando la solicitud de compra de la solicitud general:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
