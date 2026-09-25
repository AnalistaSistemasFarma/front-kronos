import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { hasPrediccionesAccess } from '../../../lib/predictivo/access';
import farmalogica from '../../../lib/predictivo/farmalogica.json';

/**
 * GET /api/predictivo — pronóstico precalculado de Farmalógica (piloto).
 *
 * El JSON lo genera analytics/predictivo/generar_farmalogica.py a partir de
 * las listas SharePoint FAR-VENTAS / FAR-INVENTARIO / FAR-LOTES / FAR-REGISTRO
 * SANITARIO. Aquí solo se valida el acceso y se entrega tal cual.
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
    return NextResponse.json({ data: farmalogica });
  } catch (error) {
    console.error('Error entregando Predicciones:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
