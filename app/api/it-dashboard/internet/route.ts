import { NextResponse } from 'next/server';
import { validateInternetInput } from '../../../../lib/it-dashboard/internet';
import {
  createInternet,
  findAllowedCompany,
  loadAllowedCompanies,
  loadInternet,
} from '../../../../lib/it-dashboard/internetDb';
import { NO_STORE, itDashboardUser, positiveId } from '../_guard';

export const dynamic = 'force-dynamic';

/** GET /api/it-dashboard/internet?company= — internet channels (one company or all) and the company list. */
export async function GET(req: Request) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const companyId = positiveId(new URL(req.url).searchParams.get('company'));
    const [items, companies] = await Promise.all([loadInternet(companyId), loadAllowedCompanies()]);
    return NextResponse.json({ items, companies }, { headers: NO_STORE });
  } catch (err) {
    console.error('Error GET /api/it-dashboard/internet:', err);
    return NextResponse.json({ error: 'No se pudieron cargar los datos de internet.' }, { status: 500 });
  }
}

/** POST { companyId, ...fields } — adds an internet channel to a company. */
export async function POST(req: Request) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const companyId = positiveId(String(body?.companyId ?? ''));
    if (companyId == null || (await findAllowedCompany(companyId)) == null) {
      return NextResponse.json({ error: 'Empresa no válida.' }, { status: 400 });
    }
    const v = validateInternetInput(body);
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos de internet.', fields: v.errors }, { status: 400 });
    const item = await createInternet(companyId, v.value, user);
    return NextResponse.json({ item }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error('Error POST /api/it-dashboard/internet:', err);
    return NextResponse.json({ error: 'No se pudo agregar el canal de internet.' }, { status: 500 });
  }
}
