import { NextResponse } from 'next/server';
import { validateTelephonyInput } from '../../../../../lib/it-dashboard/telephony';
import { deleteTelephony, loadTelephonyById, updateTelephony } from '../../../../../lib/it-dashboard/telephonyDb';
import { NO_STORE, itDashboardUser, positiveId } from '../../_guard';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/it-dashboard/telephony/[id] — edits a telephone service. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const id = positiveId((await ctx.params).id);
    if (id == null) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    if (!(await loadTelephonyById(id))) return NextResponse.json({ error: 'Registro no encontrado.' }, { status: 404 });
    const v = validateTelephonyInput(await req.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: 'Revise los datos de telefonía.', fields: v.errors }, { status: 400 });
    const item = await updateTelephony(id, v.value, user);
    return NextResponse.json({ item }, { headers: NO_STORE });
  } catch (err) {
    console.error('Error PUT /api/it-dashboard/telephony/[id]:', err);
    return NextResponse.json({ error: 'No se pudieron guardar los datos de telefonía.' }, { status: 500 });
  }
}

/** DELETE /api/it-dashboard/telephony/[id] — removes a telephone service. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await itDashboardUser();
    if (user instanceof NextResponse) return user;
    const id = positiveId((await ctx.params).id);
    if (id == null) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    if (!(await deleteTelephony(id))) return NextResponse.json({ error: 'Registro no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error('Error DELETE /api/it-dashboard/telephony/[id]:', err);
    return NextResponse.json({ error: 'No se pudo eliminar el servicio.' }, { status: 500 });
  }
}
