import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import { escapeOData } from '../../../../lib/health-records/records';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Autocompletado de articulos (entidad estandar Items de SAP) para el formulario
 * de creacion: al elegir uno se llenan Referencia (ItemCode), Descripcion
 * (ItemName) y Codigo CUM (U_IT_CUM). Requiere lectura en la empresa.
 */
interface SapItem {
  ItemCode: string;
  ItemName: string;
  U_IT_CUM?: string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const q = (searchParams.get('q') ?? '').trim();
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    if (q.length < 2) return NextResponse.json({ items: [] });

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'read');
    if (!company || !company.endpoint) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      const e = escapeOData(q);
      const filter = encodeURIComponent(
        `(contains(ItemName,'${e}') or contains(ItemCode,'${e}')) and Frozen eq 'tNO' and InventoryItem eq 'tYES' and SalesItem eq 'tYES'`
      );
      const data = await sapGet<{ value?: SapItem[] }>(
        sap,
        `Items?$filter=${filter}&$select=ItemCode,ItemName,U_IT_CUM&$top=15`
      );
      const items = (data.value ?? []).map((it) => ({
        itemCode: it.ItemCode,
        itemName: it.ItemName,
        cum: it.U_IT_CUM ?? '',
      }));
      return NextResponse.json({ items });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error buscando articulos:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
