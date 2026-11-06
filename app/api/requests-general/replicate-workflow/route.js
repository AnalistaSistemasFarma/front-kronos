import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { checkAdminPrivileges } from '../../../../lib/access-control';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const esAdmin = await checkAdminPrivileges(String(session.user.email));
    if (!esAdmin) {
      return NextResponse.json(
        { error: 'No tiene permisos para replicar flujos' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { id_origen, empresas, ensayo } = body;

    const idOrigen = Number(id_origen);
    if (!Number.isInteger(idOrigen) || idOrigen <= 0) {
      return NextResponse.json(
        { error: 'Debe seleccionar un proceso a replicar' },
        { status: 400 }
      );
    }

    const empresasCsv = (Array.isArray(empresas) ? empresas : [])
      .map((e) => Number(e))
      .filter((e) => Number.isInteger(e) && e > 0)
      .join(',');

    if (!empresasCsv) {
      return NextResponse.json(
        { error: 'Debe seleccionar al menos una empresa destino' },
        { status: 400 }
      );
    }

    const esEnsayo = ensayo ? 1 : 0;

    const result = await withMssqlPool(async (pool) => {
      return pool
        .request()
        .input('id_origen', sql.Int, idOrigen)
        .input('empresas', sql.NVarChar(sql.MAX), empresasCsv)
        .input('ensayo', sql.Bit, esEnsayo)
        .execute('dbo.sp_replicar_flujo');
    });

    return NextResponse.json(
      {
        success: true,
        ensayo: Boolean(ensayo),
        recordsets: result.recordsets,
        returnValue: result.returnValue,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Error al replicar el flujo:', err);
    return NextResponse.json(
      {
        error: 'No se pudo replicar el flujo',
        technical: err.message,
      },
      { status: 500 }
    );
  }
}
