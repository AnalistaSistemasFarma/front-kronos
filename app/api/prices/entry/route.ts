import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';

/** ¿El proceso elegido en «Mis solicitudes» es la Actualización de lista de precios de esa empresa? GET ?companyId&processId -> { isPrices } */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const processId = Number(sp.get('processId'));
    if (!companyId || !processId) return NextResponse.json({ isPrices: false });
    const pool = await sql.connect(sqlConfig);
    const r = await pool.request().input('c', sql.Int, companyId).query(
      `SELECT TOP 1 id_process_category_precios_lista AS p FROM dbo.sales_company_config WHERE id_company = @c AND activo = 1;`
    );
    return NextResponse.json({ isPrices: Number(r.recordset[0]?.p ?? 0) === processId });
  } catch (error) {
    console.error('[prices/entry]', error);
    return NextResponse.json({ isPrices: false });
  }
}
