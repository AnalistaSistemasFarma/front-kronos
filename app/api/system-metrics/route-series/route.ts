import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { hasSystemMetricsAccess } from '../../../../lib/system-metrics/access';
import { isMissingTableError, parseRange, readRouteSeries } from '../../../../lib/system-metrics/store';

/**
 * GET /api/system-metrics/route-series?range=6h&direction=in|out&key=GET%20/api/x
 *
 * Historia de una sola ruta (entrante) o servicio externo (saliente) para la hoja de detalle
 * del Monitor del sistema.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await hasSystemMetricsAccess(session.user.email))) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }

    const params = new URL(request.url).searchParams;
    const range = parseRange(params.get('range'));
    const direction = params.get('direction') === 'out' ? 'out' : 'in';
    const key = (params.get('key') ?? '').trim();
    if (!key) {
      return NextResponse.json({ error: 'Falta la ruta' }, { status: 400 });
    }

    try {
      const series = await withMssqlPool((pool) => readRouteSeries(pool, range, direction, key));
      return NextResponse.json({ range, direction, key, series });
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      return NextResponse.json({ range, direction, key, series: [] });
    }
  } catch (error) {
    console.error('Error consultando la historia de una ruta:', error);
    return NextResponse.json({ error: 'No se pudo cargar la historia' }, { status: 500 });
  }
}
