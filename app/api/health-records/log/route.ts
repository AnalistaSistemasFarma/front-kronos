import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import { OBSERVATION_MAX_LENGTH } from '../../../../lib/health-records/fields';
import { agregarLog, getRegistro } from '../../../../lib/health-records/records';
import { notifyObservation, toNotifyWarning } from '../../../../lib/health-records/notifications';
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
    const comentario = String(body.comentario ?? '').trim();
    const notify = body.notify === true;

    if (!companyId || !docNum) {
      return NextResponse.json({ error: 'Falta companyId o docNum' }, { status: 400 });
    }
    if (!comentario) {
      return NextResponse.json({ error: 'Escriba la observación' }, { status: 400 });
    }
    if (comentario.length > OBSERVATION_MAX_LENGTH) {
      return NextResponse.json(
        { error: `La observación supera el máximo de ${OBSERVATION_MAX_LENGTH} caracteres` },
        { status: 400 }
      );
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en esta empresa o no esta configurada' },
        { status: 403 }
      );
    }
    const entity = company.endpoint.healthRecordsEntity!;
    const logCollection = company.endpoint.healthRecordsLogCollection;
    if (!logCollection) {
      return NextResponse.json(
        { error: 'Esta empresa no tiene configurada la bitácora de registros sanitarios' },
        { status: 409 }
      );
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      await agregarLog(sap, entity, logCollection, docNum, userName, comentario);

      let notifyWarning: string | undefined;
      if (notify) {
        const record = await getRegistro(sap, entity, docNum);
        const notified = await notifyObservation(
          { companyId, companyName: company.companyName },
          record,
          comentario
        );
        notifyWarning = toNotifyWarning(notified);
      }

      return NextResponse.json({ ok: true, docNum, companyId, notifyWarning });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error agregando observación al registro sanitario:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
