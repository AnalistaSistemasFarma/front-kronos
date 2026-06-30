import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/articles/access';
import { leerHistorialArticulo } from '../../../../lib/articles/log';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Historial de cambios de un artículo (bitácora ART_CHG_LOG por empresa).
 * GET ?companyId=&itemCode= -> { logs: ArticleLogEntry[] }.
 * Requiere permiso de LECTURA en la empresa. Devuelve [] si la empresa no
 * tiene bitácora configurada.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const itemCode = String(searchParams.get('itemCode') ?? '').trim();
    if (!companyId || !itemCode) {
      return NextResponse.json({ error: 'Falta companyId o itemCode' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'read');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene acceso a esta empresa o no está configurada' },
        { status: 403 }
      );
    }

    // La empresa no registra bitácora: respuesta vacía (no es error).
    if (!company.endpoint.logObject) {
      return NextResponse.json({ logs: [], enabled: false });
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      const logs = await leerHistorialArticulo(sap, company.endpoint.logObject, itemCode);
      return NextResponse.json({ logs, enabled: true });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error leyendo historial de articulo:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
