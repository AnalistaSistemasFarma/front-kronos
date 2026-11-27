import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../../../lib/it-dashboard/access';
import { isDvrType, validateCameraInput } from '../../../../../../lib/it-dashboard/cameras';
import { createCamera, deleteCamera, loadCameras, updateCamera } from '../../../../../../lib/it-dashboard/camerasDb';
import { loadAssetTypeName } from '../../../../../../lib/it-dashboard/serverDb';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

type Ctx = { params: Promise<{ id: string }> };

const parseId = (raw: string | null | undefined) => (/^\d+$/.test(raw ?? '') && Number(raw) > 0 ? Number(raw) : null);

/** Session + subprocess + an existing DVR asset. */
async function guard(ctx: Ctx): Promise<{ email: string; dvrId: number } | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  if (!(await canViewItDashboard(email))) {
    return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
  }
  const dvrId = parseId((await ctx.params).id);
  if (dvrId == null) return NextResponse.json({ error: 'Activo inválido.' }, { status: 400 });
  const asset = await loadAssetTypeName(dvrId);
  if (!asset) return NextResponse.json({ error: 'Activo no encontrado.' }, { status: 404 });
  if (!isDvrType(asset.type)) return NextResponse.json({ error: 'El activo no es un DVR.' }, { status: 400 });
  return { email, dvrId };
}

/** GET /api/it-dashboard/assets/[id]/cameras — cameras of a DVR. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    return NextResponse.json({ cameras: await loadCameras(g.dvrId) }, { headers: noStore });
  } catch (err) {
    console.error('Error GET cameras:', err);
    return NextResponse.json({ error: 'No se pudieron cargar las cámaras.' }, { status: 500 });
  }
}

/** POST { name, location, brand, status } — registers a camera in the DVR. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    const v = validateCameraInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos de la cámara.', fields: v.errors }, { status: 400 });
    await createCamera(g.dvrId, v.value, g.email);
    return NextResponse.json({ cameras: await loadCameras(g.dvrId) }, { status: 201, headers: noStore });
  } catch (err) {
    console.error('Error POST cameras:', err);
    return NextResponse.json({ error: 'No se pudo registrar la cámara.' }, { status: 500 });
  }
}

/** PUT ?camera=<id> { name, location, brand, status } — edits a camera of the DVR. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    const cameraId = parseId(new URL(req.url).searchParams.get('camera'));
    if (cameraId == null) return NextResponse.json({ error: 'Cámara inválida.' }, { status: 400 });
    const v = validateCameraInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos de la cámara.', fields: v.errors }, { status: 400 });
    if (!(await updateCamera(g.dvrId, cameraId, v.value, g.email))) {
      return NextResponse.json({ error: 'Cámara no encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ cameras: await loadCameras(g.dvrId) }, { headers: noStore });
  } catch (err) {
    console.error('Error PUT cameras:', err);
    return NextResponse.json({ error: 'No se pudo guardar la cámara.' }, { status: 500 });
  }
}

/** DELETE ?camera=<id> — removes a camera of the DVR. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    const cameraId = parseId(new URL(req.url).searchParams.get('camera'));
    if (cameraId == null) return NextResponse.json({ error: 'Cámara inválida.' }, { status: 400 });
    if (!(await deleteCamera(g.dvrId, cameraId))) return NextResponse.json({ error: 'Cámara no encontrada.' }, { status: 404 });
    return NextResponse.json({ cameras: await loadCameras(g.dvrId) }, { headers: noStore });
  } catch (err) {
    console.error('Error DELETE cameras:', err);
    return NextResponse.json({ error: 'No se pudo eliminar la cámara.' }, { status: 500 });
  }
}
