import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getDashboardsPermitidos } from '../../../../lib/dashboards/acceso';

/**
 * GET /api/dashboards/acceso -> { dashboards: DashboardKey[] }
 * Claves del registro (lib/dashboards/registro.ts) que la sesión puede ver en el
 * menú «Dashboard». Solo lectura; 401 sin sesión.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const dashboards = await getDashboardsPermitidos(session.user.email);
    return NextResponse.json({ dashboards }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error consultando acceso a dashboards:', error);
    return NextResponse.json({ dashboards: [] }, { status: 500 });
  }
}
