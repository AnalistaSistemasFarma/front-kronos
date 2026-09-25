import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { hasPrediccionesAccess, PREDICCIONES_COMPANY_ID } from '../../../lib/predictivo/access';
import { getPrediccion } from '../../../lib/predictivo/snapshot';

/**
 * GET /api/predictivo — pronóstico precalculado de Farmalógica (piloto).
 *
 * El JSON lo genera analytics/predictivo/generar_farmalogica.py a partir de
 * las listas SharePoint FAR-VENTAS / FAR-INVENTARIO / FAR-LOTES / FAR-REGISTRO
 * SANITARIO (ventas desde SAP). Se lee el último snapshot publicado en la
 * tabla predictivo_snapshots; si no hay, el JSON del repo.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const allowed = await hasPrediccionesAccess(session.user.email);
    if (!allowed) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }
    const { data, origen } = await getPrediccion(PREDICCIONES_COMPANY_ID);
    return NextResponse.json({ data, origen });
  } catch (error) {
    console.error('Error entregando Predicciones:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
