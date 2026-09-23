import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { assertValentineWallAccess } from '@/lib/valentine/access';
import { toggleValentineReaction } from '@/lib/valentine/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const session = await getServerSession(authOptions);
    const email = String(session?.user?.email || '')
      .trim()
      .toLowerCase();
    const userId = String(session?.user?.id || '').trim();
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const access = await assertValentineWallAccess(email);
    if (!access.ok) {
      return NextResponse.json({ error: 'Sin acceso', reason: access.reason }, { status: 403 });
    }

    const { id } = await ctx.params;
    const postId = Number(id);
    if (!Number.isFinite(postId) || postId <= 0) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }

    const body = (await req.json()) as { emoji?: string };
    const result = await withMssqlPool((pool) =>
      toggleValentineReaction(pool, {
        postId,
        userId,
        email,
        emoji: String(body.emoji || ''),
      })
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al reaccionar';
    console.error('[valentine-wall reactions]', err);
    const status = /inválida|no encontrado/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
