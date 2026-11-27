import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../../../lib/it-dashboard/access';
import { isComputerType, validateMaintenanceInput } from '../../../../../../lib/it-dashboard/maintenance';
import { createMaintenance, loadMaintenance } from '../../../../../../lib/it-dashboard/maintenanceDb';
import { loadAssetTypeName } from '../../../../../../lib/it-dashboard/serverDb';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

type Ctx = { params: Promise<{ id: string }> };

/** Session + subprocess + an existing computer asset. */
async function guard(ctx: Ctx): Promise<{ email: string; assetId: number } | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  if (!(await canViewItDashboard(email))) {
    return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
  }
  const raw = (await ctx.params).id;
  const assetId = /^\d+$/.test(raw ?? '') && Number(raw) > 0 ? Number(raw) : null;
  if (assetId == null) return NextResponse.json({ error: 'Activo inválido.' }, { status: 400 });
  const asset = await loadAssetTypeName(assetId);
  if (!asset) return NextResponse.json({ error: 'Activo no encontrado.' }, { status: 404 });
  if (!isComputerType(asset.type)) return NextResponse.json({ error: 'El activo no es un computador.' }, { status: 400 });
  return { email, assetId };
}

/** GET /api/it-dashboard/assets/[id]/maintenance — maintenance log of a computer. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    return NextResponse.json({ logs: await loadMaintenance(g.assetId) }, { headers: noStore });
  } catch (err) {
    console.error('Error GET maintenance:', err);
    return NextResponse.json({ error: 'No se pudo cargar el registro de mantenimientos.' }, { status: 500 });
  }
}

/** POST { date, kind, notes } — registers a maintenance (one log row). */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    const v = validateMaintenanceInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos del mantenimiento.', fields: v.errors }, { status: 400 });
    await createMaintenance(g.assetId, v.value, g.email);
    return NextResponse.json({ logs: await loadMaintenance(g.assetId) }, { status: 201, headers: noStore });
  } catch (err) {
    console.error('Error POST maintenance:', err);
    return NextResponse.json({ error: 'No se pudo registrar el mantenimiento.' }, { status: 500 });
  }
}
