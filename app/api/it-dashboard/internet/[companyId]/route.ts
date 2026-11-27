import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../../lib/it-dashboard/access';
import { validateInternetInput } from '../../../../../lib/it-dashboard/internet';
import { findAllowedCompany, saveCompanyInternet } from '../../../../../lib/it-dashboard/internetDb';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/it-dashboard/internet/[companyId]
 * { provider, publicIp, subnetMask, gateway, dnsServers, bandwidth, channelType, connectionType, notes }
 * Saves the internet channel of a company. Requires the Dashboard TI subprocess.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    if (!(await canViewItDashboard(email))) {
      return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
    }

    const raw = (await params).companyId;
    const companyId = /^\d+$/.test(raw ?? '') ? Number(raw) : NaN;
    if (!Number.isSafeInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    if ((await findAllowedCompany(companyId)) == null) {
      return NextResponse.json({ error: 'Empresa no encontrada.' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const v = validateInternetInput(body);
    if (!v.ok) {
      return NextResponse.json({ error: 'Revise los datos de internet.', fields: v.errors }, { status: 400 });
    }

    const internet = await saveCompanyInternet(companyId, v.value, email);
    return NextResponse.json({ internet }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error PUT /api/it-dashboard/internet/[companyId]:', err);
    return NextResponse.json({ error: 'No se pudieron guardar los datos de internet.' }, { status: 500 });
  }
}
