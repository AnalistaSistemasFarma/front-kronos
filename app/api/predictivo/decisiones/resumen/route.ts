import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { hasPrediccionesAccess } from '../../../../../lib/predictivo/access';
import { DECISIONES_EMPRESAS } from '../../../../../lib/predictivo/decisiones';
import { resumenDecisiones } from '../../../../../lib/predictivo/decisionesDb';

/**
 * GET /api/predictivo/decisiones/resumen?companyId=N — conteos por decisión y
 * opción, accionables e impacto en pesos de la última fecha de corte (tarjetas
 * de la sub-pestaña "Decisiones por artículo").
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const companyId = Number(new URL(request.url).searchParams.get('companyId'));
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'companyId inválido' }, { status: 400 });
    }
    const allowed = await hasPrediccionesAccess(session.user.email, companyId);
    if (!allowed) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }
    if (!DECISIONES_EMPRESAS.includes(companyId)) {
      return NextResponse.json({ error: 'Esta empresa todavía no tiene decisiones por artículo' }, { status: 404 });
    }
    return NextResponse.json(await resumenDecisiones(companyId));
  } catch (error) {
    console.error('Error entregando el resumen de decisiones:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
