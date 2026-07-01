import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { eliminarRegistro } from '../../../../lib/health-records/records';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Elimina un registro sanitario (DELETE por DocNum). SOLO administradores.
 * Requiere ademas permiso de escritura en la empresa. La validacion de admin es
 * autoritativa aqui: aunque la UI oculte el boton, el servidor la reimpone.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPrivileges(session.user.email);
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Solo los administradores pueden eliminar registros sanitarios' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const docNum = Number(body.docNum);
    if (!companyId || !docNum) {
      return NextResponse.json({ error: 'Falta companyId o docNum' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en esta empresa o no esta configurada' },
        { status: 403 }
      );
    }
    const entity = company.endpoint.healthRecordsEntity!;

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      await eliminarRegistro(sap, entity, docNum);
      return NextResponse.json({ ok: true, docNum, companyId });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error eliminando registro sanitario:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
