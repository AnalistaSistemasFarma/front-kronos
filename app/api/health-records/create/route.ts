import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import {
  crearRegistro,
  registroExiste,
  sanitizeRecord,
} from '../../../../lib/health-records/records';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Crea un registro sanitario en la base SAP de la empresa indicada.
 * El usuario debe tener permiso de ESCRITURA en esa empresa. El Login y la
 * creacion ocurren solo en el servidor.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userName = session.user.name || session.user.email;

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    if (!companyId) {
      return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en esta empresa o no esta configurada' },
        { status: 403 }
      );
    }

    const record = sanitizeRecord(body.record ?? {});
    if (!record.U_Registro_Sanitario) {
      return NextResponse.json({ error: 'El numero de registro sanitario es obligatorio' }, { status: 400 });
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      const existe = await registroExiste(
        sap,
        company.endpoint.healthRecordsEntity!,
        record.U_Registro_Sanitario
      );
      if (existe) {
        return NextResponse.json(
          { error: `Ya existe el registro sanitario ${record.U_Registro_Sanitario}` },
          { status: 409 }
        );
      }

      const docNum = await crearRegistro(
        sap,
        company.endpoint,
        record,
        userName,
        String(body.comentario ?? '').trim()
      );

      return NextResponse.json({ ok: true, docNum, companyId });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error creando registro sanitario:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
