import { NextResponse } from 'next/server';
import { findAllowedCompany, loadAllowedCompanies } from '../../../../lib/it-dashboard/internetDb';
import { validateTelephonyInput } from '../../../../lib/it-dashboard/telephony';
import { createTelephony, loadTelephony } from '../../../../lib/it-dashboard/telephonyDb';
import { NO_STORE, itDashboardUser, positiveId } from '../_guard';

export const dynamic = 'force-dynamic';

/** GET /api/it-dashboard/telephony?company= — telephone services (one company or all) and the company list. */
export async function GET(req: Request) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const companyId = positiveId(new URL(req.url).searchParams.get('company'));
    const [items, companies] = await Promise.all([loadTelephony(companyId), loadAllowedCompanies()]);
    return NextResponse.json({ items, companies }, { headers: NO_STORE });
  } catch (err) {
    console.error('Error GET /api/it-dashboard/telephony:', err);
    return NextResponse.json({ error: 'No se pudieron cargar los datos de telefonía.' }, { status: 500 });
  }
}

/** POST { companyId, ...fields } — adds a telephone service to a company. */
export async function POST(req: Request) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const companyId = positiveId(String(body?.companyId ?? ''));
    if (companyId == null || (await findAllowedCompany(companyId)) == null) {
      return NextResponse.json({ error: 'Empresa no válida.' }, { status: 400 });
    }
    const v = validateTelephonyInput(body);
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos de telefonía.', fields: v.errors }, { status: 400 });
    const item = await createTelephony(companyId, v.value, user);
    return NextResponse.json({ item }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error('Error POST /api/it-dashboard/telephony:', err);
    return NextResponse.json({ error: 'No se pudo agregar el servicio de telefonía.' }, { status: 500 });
  }
}
