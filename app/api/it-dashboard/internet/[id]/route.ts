import { NextResponse } from 'next/server';
import { validateInternetInput } from '../../../../../lib/it-dashboard/internet';
import { deleteInternet, loadInternetById, updateInternet } from '../../../../../lib/it-dashboard/internetDb';
import { NO_STORE, itDashboardUser, positiveId } from '../../_guard';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/it-dashboard/internet/[id] — edits an internet channel. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const id = positiveId((await ctx.params).id);
    if (id == null) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    if (!(await loadInternetById(id))) return NextResponse.json({ error: 'Registro no encontrado.' }, { status: 404 });
    const v = validateInternetInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos de internet.', fields: v.errors }, { status: 400 });
    const item = await updateInternet(id, v.value, user);
    return NextResponse.json({ item }, { headers: NO_STORE });
  } catch (err) {
    console.error('Error PUT /api/it-dashboard/internet/[id]:', err);
    return NextResponse.json({ error: 'No se pudieron guardar los datos de internet.' }, { status: 500 });
  }
}

/** DELETE /api/it-dashboard/internet/[id] — removes an internet channel. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const id = positiveId((await ctx.params).id);
    if (id == null) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    if (!(await deleteInternet(id))) return NextResponse.json({ error: 'Registro no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error('Error DELETE /api/it-dashboard/internet/[id]:', err);
    return NextResponse.json({ error: 'No se pudo eliminar el canal.' }, { status: 500 });
  }
}
