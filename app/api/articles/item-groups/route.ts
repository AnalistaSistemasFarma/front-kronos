import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/articles/access';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Lista los grupos de articulos (ItemGroups) REALES de una empresa, para el
 * dropdown del formulario. Los numeros de grupo varian por base, por eso se
 * leen en runtime y no se asume una lista fija. Requiere lectura en la empresa.
 */
interface SapItemGroup {
  Number: number;
  GroupName: string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });

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
      const data = await sapGet<{ value?: SapItemGroup[] }>(
        sap,
        'ItemGroups?$select=Number,GroupName&$orderby=GroupName'
      );
      const groups = (data.value ?? []).map((g) => ({ number: g.Number, name: g.GroupName }));
      return NextResponse.json({ groups });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error listando grupos de articulos:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
