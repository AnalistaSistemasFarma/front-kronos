import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../lib/it-dashboard/access';
import { loadCompanyInternet } from '../../../../lib/it-dashboard/internetDb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/it-dashboard/internet
 * Internet channel of every company (Dashboard TI «Internet» card).
 * Requires the Dashboard TI subprocess.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    if (!(await canViewItDashboard(email))) {
      return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
    }
    const companies = await loadCompanyInternet();
    return NextResponse.json({ companies }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error GET /api/it-dashboard/internet:', err);
    return NextResponse.json({ error: 'No se pudieron cargar los datos de internet.' }, { status: 500 });
  }
}
