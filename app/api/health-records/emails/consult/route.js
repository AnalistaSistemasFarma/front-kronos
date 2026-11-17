import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../../lib/mssqlPool';

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const companyIdParam = searchParams.get('companyId');
    const companyId = companyIdParam ? Number.parseInt(companyIdParam, 10) : null;
    if (companyIdParam && (!Number.isInteger(companyId) || companyId <= 0)) {
      return NextResponse.json({ error: 'companyId inválido' }, { status: 400 });
    }

    const emailsHealthRecordRes = await withMssqlPool(async (pool) => {
      const request = pool.request();
      let query = `
        SELECT
            ehr.id, ehr.value_email, ehr.email_to_send, ehr.active, c.id_company, c.company
        FROM
            emails_health_record ehr
            INNER JOIN company c ON c.id_company = ehr.id_company
      `;
      if (companyId) {
        query += ` WHERE ehr.id_company = @companyId`;
        request.input('companyId', sql.Int, companyId);
      }
      query += ` ORDER BY c.company, ehr.value_email`;
      return request.query(query);
    });

    return NextResponse.json(
      {
        emails: emailsHealthRecordRes.recordset,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('abort')) {
      return NextResponse.json({ error: 'Solicitud cancelada', code: 'ABORTED' }, { status: 499 });
    }
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
