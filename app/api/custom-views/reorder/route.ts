import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { canCreateViews } from '../../../../lib/custom-views/access';

export const dynamic = 'force-dynamic';

/**
 * POST /api/custom-views/reorder  body: [{ id, sort_order }, ...]
 * Persiste el nuevo orden (drag & drop) de las vistas. §5.4.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }
    if (!(await canCreateViews(user.id, user.role ?? null))) {
      return NextResponse.json({ error: 'No tiene permiso para reordenar vistas.' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido en el cuerpo.' }, { status: 400 });
    }
    const items = Array.isArray(body) ? body : (body as { items?: unknown })?.items;
    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Se espera un arreglo [{ id, sort_order }].' },
        { status: 400 }
      );
    }

    const updates = items
      .map((it) => ({
        id: Number((it as Record<string, unknown>).id),
        sort_order: Number((it as Record<string, unknown>).sort_order),
      }))
      .filter((it) => Number.isFinite(it.id) && Number.isFinite(it.sort_order));

    await prisma.$transaction(
      updates.map((u) =>
        prisma.savedView.update({
          where: { id_saved_view: u.id },
          data: { sort_order: u.sort_order },
        })
      )
    );

    return NextResponse.json({ ok: true, updated: updates.length });
  } catch (error) {
    console.error('Error en POST /api/custom-views/reorder:', error);
    return NextResponse.json({ error: 'Error al reordenar las vistas.' }, { status: 500 });
  }
}
