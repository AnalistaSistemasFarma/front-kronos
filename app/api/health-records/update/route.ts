import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import { agregarLog, sanitizeRecord } from '../../../../lib/health-records/records';
import { sapLogin, sapLogout, sapPatch, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Edita un registro sanitario existente (PATCH por DocNum) y, si se envia
 * comentario, agrega una linea de bitacora. Requiere permiso de escritura.
 *
 * Se hace el PATCH de los campos editados SIN B1S-ReplaceCollectionsOnPatch
 * (no toca la coleccion de logs) y luego un append del log, evitando la
 * condicion de carrera del modulo original de SAPSEND.
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

    const changes = sanitizeRecord(body.changes ?? {});
    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 });
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      await sapPatch(sap, `${entity}(${docNum})`, changes);

      const comentario = String(body.comentario ?? '').trim();
      if (comentario && company.endpoint.healthRecordsLogCollection) {
        await agregarLog(
          sap,
          entity,
          company.endpoint.healthRecordsLogCollection,
          docNum,
          userName,
          comentario
        );
      }

      return NextResponse.json({ ok: true, docNum, companyId });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error editando registro sanitario:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
