import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { canReadLinkedSale } from '../../../../lib/sales/requestAccess';

/** Price update detail of a request (header and lines). GET ?requestId -> { update | null } */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const requestId = Number(new URL(request.url).searchParams.get('requestId'));
    if (!requestId) return NextResponse.json({ update: null });
    const pool = await sql.connect(sqlConfig);
    const h = await pool.request().input('r', sql.Int, requestId).query(`SELECT TOP 1 p.*, r.status_req FROM dbo.price_update p JOIN requests_general r ON r.id = p.id_request_general WHERE p.id_request_general = @r;`).catch(() => ({ recordset: [] }));
    const head = h.recordset[0];
    if (!head) return NextResponse.json({ update: null });
    if (!(await canReadLinkedSale(session.user.email, requestId, head.id_company))) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
    const l = await pool.request().input('id', sql.Int, head.id).query(
      `SELECT line_num, item_code, item_name, current_price, new_price, currency, mode, status, error FROM dbo.price_update_line WHERE id_price_update = @id ORDER BY line_num;`
    );
    return NextResponse.json({
      update: {
        companyId: head.id_company, cardCode: head.card_code, cardName: head.card_name, priceListNum: head.price_list_num, priceListName: head.price_list_name,
        sharedList: Boolean(head.shared_list),
        // Request closed without applying (approval denied or cancelled): shown as rejected.
        status: head.status === 'pending' && Number(head.status_req) === 3 ? 'rejected' : head.status, error: head.error, comment: head.comment, appliedAt: head.applied_at,
        lines: l.recordset.map((x) => ({ ...x, current_price: x.current_price == null ? null : Number(x.current_price), new_price: Number(x.new_price) })),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[prices/by-request]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
