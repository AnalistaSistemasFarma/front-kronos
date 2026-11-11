import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import { agregarLog, getRegistro } from '../../../../lib/health-records/records';
import { EMAIL_KEYS, notifyDivulgation } from '../../../../lib/health-records/notifications';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userName = session.user.name || session.user.email;

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
      const record = await getRegistro(sap, entity, docNum);
      const result = await notifyDivulgation(
        { companyId, companyName: company.companyName },
        record,
        userName
      );

      if (result.skipped.length > 0) {
        return NextResponse.json(
          {
            error: `${company.companyName} no tiene destinatarios activos de divulgación (${EMAIL_KEYS.divulgation}).`,
          },
          { status: 409 }
        );
      }
      if (result.errors.length > 0 || result.sent.length === 0) {
        return NextResponse.json(
          { error: `No se pudo enviar la divulgación (${result.errors.join('; ') || 'sin detalle'})` },
          { status: 502 }
        );
      }

      let logWarning: string | undefined;
      if (company.endpoint.healthRecordsLogCollection) {
        try {
          await agregarLog(
            sap,
            entity,
            company.endpoint.healthRecordsLogCollection,
            docNum,
            userName,
            'Registro enviado a divulgación por correo'
          );
        } catch (err) {
          console.error('No se pudo registrar la divulgación en la bitácora:', err);
          logWarning = 'La divulgación se envió, pero no quedó registrada en la bitácora.';
        }
      }

      return NextResponse.json({ ok: true, docNum, companyId, logWarning });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error enviando a divulgar el registro sanitario:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
