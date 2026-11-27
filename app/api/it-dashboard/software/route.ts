import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../lib/it-dashboard/access';
import { findAllowedCompany } from '../../../../lib/it-dashboard/internetDb';
import { validateSoftwareInput } from '../../../../lib/it-dashboard/software';
import { createSoftware, loadSoftware } from '../../../../lib/it-dashboard/softwareDb';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

async function guard(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  if (!(await canViewItDashboard(email))) {
    return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
  }
  return email;
}

/** GET /api/it-dashboard/software?company= — software and certificates (one company or all). */
export async function GET(req: Request) {
  try {
    const g = await guard();
    if (g instanceof NextResponse) return g;
    const raw = new URL(req.url).searchParams.get('company') ?? '';
    const companyId = /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
    const items = await loadSoftware(companyId);
    return NextResponse.json({ items }, { headers: noStore });
  } catch (err) {
    console.error('Error GET /api/it-dashboard/software:', err);
    return NextResponse.json({ error: 'No se pudo cargar el software.' }, { status: 500 });
  }
}

/** POST /api/it-dashboard/software — registers a software or certificate. */
export async function POST(req: Request) {
  try {
    const g = await guard();
    if (g instanceof NextResponse) return g;
    const v = validateSoftwareInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos del software.', fields: v.errors }, { status: 400 });
    if ((await findAllowedCompany(v.value.companyId)) == null) {
      return NextResponse.json({ error: 'Empresa no encontrada.', fields: { companyId: 'Empresa no válida' } }, { status: 400 });
    }
    const item = await createSoftware(v.value, g);
    return NextResponse.json({ item }, { status: 201, headers: noStore });
  } catch (err) {
    console.error('Error POST /api/it-dashboard/software:', err);
    return NextResponse.json({ error: 'No se pudo registrar el software.' }, { status: 500 });
  }
}
