import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../../../lib/it-dashboard/access';
import { isServerType, validateNetworkInput } from '../../../../../../lib/it-dashboard/server';
import {
  loadAssetTypeName,
  loadServerNetwork,
  loadServerPerformance,
  saveServerNetwork,
} from '../../../../../../lib/it-dashboard/serverDb';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

type Ctx = { params: Promise<{ id: string }> };

/** Session + subprocess + a valid server asset. Returns a Response on failure. */
async function guard(ctx: Ctx): Promise<{ email: string; assetId: number } | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  if (!(await canViewItDashboard(email))) {
    return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
  }
  const raw = (await ctx.params).id;
  const assetId = /^\d+$/.test(raw ?? '') ? Number(raw) : NaN;
  if (!Number.isSafeInteger(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'Activo inválido.' }, { status: 400 });
  }
  const asset = await loadAssetTypeName(assetId);
  if (!asset) return NextResponse.json({ error: 'Activo no encontrado.' }, { status: 404 });
  if (!isServerType(asset.type)) {
    return NextResponse.json({ error: 'El activo no es un servidor.' }, { status: 400 });
  }
  return { email, assetId };
}

/**
 * GET /api/it-dashboard/assets/[id]/server
 * Network data and performance of a server asset. Requires the Dashboard TI subprocess.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    const network = await loadServerNetwork(g.assetId);
    const performance = await loadServerPerformance(network.hostname);
    return NextResponse.json({ network, performance }, { headers: noStore });
  } catch (err) {
    console.error('Error GET /api/it-dashboard/assets/[id]/server:', err);
    return NextResponse.json({ error: 'No se pudo cargar la información del servidor.' }, { status: 500 });
  }
}

/**
 * PUT /api/it-dashboard/assets/[id]/server  { hostname, ipAddress, subnetMask, gateway, dnsServers, vlan, macAddress, notes }
 * Saves the «Datos de red» of a server asset.
 */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    const body = await req.json().catch(() => null);
    const v = validateNetworkInput(body);
    if (!v.ok) {
      return NextResponse.json({ error: 'Revise los datos de red.', fields: v.errors }, { status: 400 });
    }
    const network = await saveServerNetwork(g.assetId, v.value, g.email);
    const performance = await loadServerPerformance(network.hostname);
    return NextResponse.json({ network, performance }, { headers: noStore });
  } catch (err) {
    console.error('Error PUT /api/it-dashboard/assets/[id]/server:', err);
    return NextResponse.json({ error: 'No se pudieron guardar los datos de red.' }, { status: 500 });
  }
}
