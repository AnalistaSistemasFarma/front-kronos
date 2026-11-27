import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../../../../lib/it-dashboard/access';
import { parsePhotoDataUrl } from '../../../../../../lib/it-dashboard/photo';
import { assetExists, deleteAssetPhoto, loadAssetPhoto, saveAssetPhoto } from '../../../../../../lib/it-dashboard/photoDb';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function guard(ctx: Ctx): Promise<{ email: string; assetId: number } | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  if (!(await canViewItDashboard(email))) {
    return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
  }
  const raw = (await ctx.params).id;
  const assetId = /^\d+$/.test(raw ?? '') ? Number(raw) : NaN;
  if (!Number.isSafeInteger(assetId) || assetId <= 0) return NextResponse.json({ error: 'Activo inválido.' }, { status: 400 });
  return { email, assetId };
}

/** GET /api/it-dashboard/assets/[id]/photo — the picture (404 when the asset has none). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    const photo = await loadAssetPhoto(g.assetId);
    if (!photo) return NextResponse.json({ error: 'El activo no tiene imagen.' }, { status: 404 });
    return new NextResponse(new Uint8Array(photo.content), {
      status: 200,
      headers: {
        'Content-Type': photo.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Error GET /api/it-dashboard/assets/[id]/photo:', err);
    return NextResponse.json({ error: 'No se pudo cargar la imagen.' }, { status: 500 });
  }
}

/** PUT { image: "data:image/jpeg;base64,..." } — sets or replaces the picture. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    if (!(await assetExists(g.assetId))) return NextResponse.json({ error: 'Activo no encontrado.' }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { image?: unknown } | null;
    const p = parsePhotoDataUrl(body?.image);
    if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
    await saveAssetPhoto(g.assetId, p.mime, p.bytes, g.email);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error PUT /api/it-dashboard/assets/[id]/photo:', err);
    return NextResponse.json({ error: 'No se pudo guardar la imagen.' }, { status: 500 });
  }
}

/** DELETE — removes the picture. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx);
    if (g instanceof NextResponse) return g;
    await deleteAssetPhoto(g.assetId);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Error DELETE /api/it-dashboard/assets/[id]/photo:', err);
    return NextResponse.json({ error: 'No se pudo quitar la imagen.' }, { status: 500 });
  }
}
