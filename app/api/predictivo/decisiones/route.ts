import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { hasPrediccionesAccess } from '../../../../lib/predictivo/access';
import { aCsv, DECISIONES_EMPRESAS, parseFiltros } from '../../../../lib/predictivo/decisiones';
import { listarDecisiones } from '../../../../lib/predictivo/decisionesDb';

/**
 * GET /api/predictivo/decisiones?companyId=N — decisiones por artículo (F1) de
 * la última fecha de corte publicada, paginadas en el servidor.
 *
 * Filtros: decision (D1|D2|D3|D7), opcion, probMin (0-1), calidad
 * (alta|media|baja), q (código o nombre), accionables=1, page, pageSize (máx. 200).
 * formato=csv descarga todas las filas que cumplen los filtros (máx. 20.000).
 *
 * Acceso: el mismo subproceso de Predicciones, por empresa (hasPrediccionesAccess).
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const parsed = parseFiltros(new URL(request.url).searchParams);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { filtros } = parsed;
    const allowed = await hasPrediccionesAccess(session.user.email, filtros.companyId);
    if (!allowed) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }
    if (!DECISIONES_EMPRESAS.includes(filtros.companyId)) {
      return NextResponse.json({ error: 'Esta empresa todavía no tiene decisiones por artículo' }, { status: 404 });
    }
    const pagina = await listarDecisiones(filtros);
    if (filtros.csv) {
      const nombre = `decisiones-${filtros.companyId}-${pagina.fecha_corte ?? 'sin-datos'}.csv`;
      return new NextResponse(aCsv(pagina.filas), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${nombre}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json(pagina);
  } catch (error) {
    console.error('Error entregando decisiones por artículo:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
