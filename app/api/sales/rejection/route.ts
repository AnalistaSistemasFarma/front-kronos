import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { canReadLinkedSale } from '../../../../lib/sales/requestAccess';
import { CANCEL_REASONS, rejectionAction } from '../../../../lib/sales/rejection';
import { SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Retomar o cancelar una oferta desde su solicitud (ciclo de rechazo de SAPSEND).
 * GET -> { motivos }
 * POST { requestId, accion: 'retomar' | 'cancelar', motivo?, comentario? }
 * Requiere «Ventas · Gestionar ofertas» en la empresa y acceso a la solicitud.
 */
export async function GET() {
  return NextResponse.json({ motivos: Object.entries(CANCEL_REASONS).map(([value, label]) => ({ value, label })) });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const accion = body.accion === 'retomar' || body.accion === 'cancelar' ? body.accion : null;
    if (!requestId || !accion) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    const pool = await sql.connect(sqlConfig);
    // La oferta de la solicitud: enlace del flujo (rechazada) o borrador (sales_offer_draft).
    const r = await pool.request().input('r', sql.Int, requestId).query(`
      SELECT TOP 1 id_company, doc_entry FROM (
        SELECT id_company, doc_entry, 1 AS o FROM dbo.sales_authorization WHERE id_request_general = @r
        UNION ALL SELECT id_company, doc_entry, 2 FROM dbo.sales_offer_draft WHERE id_request_general = @r) x ORDER BY o;`);
    const link = r.recordset[0];
    if (!link) return NextResponse.json({ error: 'La solicitud no es de una oferta de venta.' }, { status: 404 });
    const write = await salesEndpointForUser(email, link.id_company, 'write');
    if (!write?.endpoint || !(await canReadLinkedSale(email, requestId, link.id_company))) {
      return NextResponse.json({ error: 'No tiene permiso para gestionar esta oferta («Ventas · Gestionar ofertas»).' }, { status: 403 });
    }
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 401 });
    const res = await rejectionAction({
      companyId: link.id_company, docEntry: link.doc_entry, idRequest: requestId, userId: user.id, userName: user.name ?? email,
      accion, motivo: body.motivo, comentario: body.comentario,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json(res);
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error retomando o cancelando la oferta:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
