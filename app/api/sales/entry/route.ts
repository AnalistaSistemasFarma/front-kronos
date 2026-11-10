import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';

/**
 * ¿El proceso elegido en «Mis solicitudes» es de Ventas en esa empresa? La Oferta de venta
 * (id_process_category_oferta) y el Pedido directo (id_process_category_directa) se capturan con el
 * MISMO formulario de Ventas; el pedido directo llega con esa opción ya elegida.
 * GET ?companyId&processId -> { isSales, modo: 'enviar' | 'directo' | null }.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const processId = Number(sp.get('processId'));
    if (!companyId || !processId) return NextResponse.json({ isSales: false });
    const pool = await sql.connect(sqlConfig);
    const r = await pool.request().input('c', sql.Int, companyId).query(
      `SELECT TOP 1 id_process_category_oferta AS p, id_process_category_directa AS d FROM dbo.sales_company_config WHERE id_company = @c AND activo = 1;`
    );
    const row = r.recordset[0];
    const modo = Number(row?.p ?? 0) === processId ? 'enviar' : Number(row?.d ?? 0) === processId ? 'directo' : null;
    return NextResponse.json({ isSales: Boolean(modo), modo });
  } catch (error) {
    console.error('Error resolviendo el proceso de ventas:', error);
    return NextResponse.json({ isSales: false });
  }
}
