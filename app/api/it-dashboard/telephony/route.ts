import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../lib/it-dashboard/access';
import { loadCompanyTelephony } from '../../../../lib/it-dashboard/telephonyDb';

export const dynamic = 'force-dynamic';

/** GET /api/it-dashboard/telephony — telephone service of every company. Requires the Dashboard TI subprocess. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    if (!(await canViewItDashboard(email))) {
      return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
    }
    const companies = await loadCompanyTelephony();
    return NextResponse.json({ companies }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error GET /api/it-dashboard/telephony:', err);
    return NextResponse.json({ error: 'No se pudieron cargar los datos de telefonía.' }, { status: 500 });
  }
}
