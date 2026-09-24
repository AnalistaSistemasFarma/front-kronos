import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  assertValentineWallAccess,
  userCanModerateValentineWall,
} from '@/lib/valentine/access';
import { softDeleteValentinePost } from '@/lib/valentine/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions);
    const email = String(session?.user?.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const access = await assertValentineWallAccess(email);
    if (!access.ok) {
      return NextResponse.json({ error: 'Sin acceso', reason: access.reason }, { status: 403 });
    }

    const canModerate = await userCanModerateValentineWall(email);
    if (!canModerate) {
      return NextResponse.json(
        { error: 'Solo un administrador puede borrar mensajes' },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const postId = Number(id);
    if (!Number.isFinite(postId) || postId <= 0) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }

    const deleted = await withMssqlPool((pool) => softDeleteValentinePost(pool, postId));
    if (!deleted) {
      return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[valentine-wall DELETE]', err);
    return NextResponse.json({ error: 'Error al borrar el mensaje' }, { status: 500 });
  }
}
