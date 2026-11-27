import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../../lib/it-dashboard/access';
import { findAllowedCompany } from '../../../../../lib/it-dashboard/internetDb';
import { validateTelephonyInput } from '../../../../../lib/it-dashboard/telephony';
import { saveCompanyTelephony } from '../../../../../lib/it-dashboard/telephonyDb';

export const dynamic = 'force-dynamic';

/** PUT /api/it-dashboard/telephony/[companyId] — saves the telephone service of a company. */
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
    if (!Number.isSafeInteger(companyId) || companyId <= 0) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    if ((await findAllowedCompany(companyId)) == null) return NextResponse.json({ error: 'Empresa no encontrada.' }, { status: 404 });

    const v = validateTelephonyInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos de telefonía.', fields: v.errors }, { status: 400 });

    const telephony = await saveCompanyTelephony(companyId, v.value, email);
    return NextResponse.json({ telephony }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error PUT /api/it-dashboard/telephony/[companyId]:', err);
    return NextResponse.json({ error: 'No se pudieron guardar los datos de telefonía.' }, { status: 500 });
  }
}
