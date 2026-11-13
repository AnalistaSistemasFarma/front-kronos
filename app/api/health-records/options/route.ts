import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import { getFieldSizes, getNombresExistentes } from '../../../../lib/health-records/records';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Opciones para las listas seleccionables de Titular y Fabricante del
 * formulario: los valores DISTINTOS ya usados en los registros sanitarios de la
 * empresa (no hay tabla maestra en SAP) y el tamaño máximo de cada campo de
 * texto (EditSize del UDO, varía por empresa). Solo lectura.
 */
const NAME_FIELDS = ['U_Titular', 'U_Fabricante'];

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = Number(new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'read');
    if (!company || !company.endpoint) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }
    const entity = company.endpoint.healthRecordsEntity!;

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      const sizes = await getFieldSizes(sap, entity);
      const nombres = await getNombresExistentes(sap, entity, NAME_FIELDS);

      // Una sola opción por nombre normalizado (sin duplicados por tildes o
      // mayúsculas), ordenadas alfabéticamente.
      const distintos = (field: string) =>
        [...nombres[field].values()]
          .map((variantes) => [...variantes][0])
          .sort((a, b) => a.localeCompare(b, 'es'));

      return NextResponse.json({
        titulares: distintos('U_Titular'),
        fabricantes: distintos('U_Fabricante'),
        sizes,
      });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error cargando opciones de registros sanitarios:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
