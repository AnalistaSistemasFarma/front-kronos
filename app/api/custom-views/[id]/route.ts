import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { assertReadOnlyAgainstCatalog } from '../../../../lib/sql/readonly';
import {
  canCreateViews,
  isValidColumnRef,
  viewSubprocessUrl,
  CUSTOM_VIEWS_PROCESS_ID,
  MAX_VIEW_ROWS,
} from '../../../../lib/custom-views/access';

export const dynamic = 'force-dynamic';

async function requireCreator(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  if (!user) return { error: 'Usuario no encontrado', status: 404 as const };
  if (!(await canCreateViews(user.id, user.role ?? null))) {
    return { error: 'No tiene permiso para gestionar vistas.', status: 403 as const };
  }
  return { user };
}

/** Elimina el subprocess-módulo de una vista (por su url). Cascada limpia asignaciones. */
async function removeViewSubprocess(slug: string): Promise<void> {
  await prisma.subprocess.deleteMany({ where: { subprocess_url: viewSubprocessUrl(slug) } });
}

/** GET /api/custom-views/[id] → detalle de la vista. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const { id } = await params;
    const view = await prisma.savedView.findUnique({
      where: { id_saved_view: Number(id) },
      include: { columns: { orderBy: { sort_order: 'asc' } } },
    });
    if (!view) {
      return NextResponse.json({ error: 'Vista no encontrada' }, { status: 404 });
    }
    return NextResponse.json(
      { view },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error en GET /api/custom-views/[id]:', error);
    return NextResponse.json({ error: 'Error al cargar la vista.' }, { status: 500 });
  }
}

/**
 * PUT /api/custom-views/[id] → editar vista.
 * Si cambia visibility a 'archived', elimina el subprocess asociado.
 * Si pasa/permanece 'published', garantiza (idempotente) el subprocess.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const guard = await requireCreator(session.user.email);
    if ('error' in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const { id } = await params;
    const viewId = Number(id);
    const current = await prisma.savedView.findUnique({ where: { id_saved_view: viewId } });
    if (!current) {
      return NextResponse.json({ error: 'Vista no encontrada' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'JSON inválido en el cuerpo.' }, { status: 400 });
    }

    const data: Record<string, unknown> = {};

    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if ('description' in body) {
      data.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null;
    }
    if (typeof body.icon === 'string') data.icon = body.icon.trim() || null;
    if (Number.isFinite(Number(body.sort_order))) data.sort_order = Number(body.sort_order);
    if (Number.isFinite(Number(body.row_limit))) {
      data.row_limit = Math.min(Math.max(1, Number(body.row_limit)), MAX_VIEW_ROWS);
    }

    const nextScope =
      body.scope_mode === 'all' || body.scope_mode === 'company'
        ? (body.scope_mode as string)
        : current.scope_mode;
    const nextColumn =
      'company_column' in body
        ? typeof body.company_column === 'string' && body.company_column.trim()
          ? body.company_column.trim()
          : null
        : current.company_column;

    if ('scope_mode' in body || 'company_column' in body) {
      data.scope_mode = nextScope;
      data.company_column = nextScope === 'company' ? nextColumn : null;
      if (nextScope === 'company') {
        if (!nextColumn) {
          return NextResponse.json(
            { error: 'Con alcance por empresa debe indicar la columna de empresa.' },
            { status: 400 }
          );
        }
        if (!isValidColumnRef(nextColumn)) {
          return NextResponse.json(
            { error: 'La columna de empresa no es un identificador SQL válido.' },
            { status: 400 }
          );
        }
      }
    }

    if (typeof body.sql_text === 'string' && body.sql_text.trim()) {
      const sqlText = body.sql_text.trim();
      try {
        await assertReadOnlyAgainstCatalog(sqlText, prisma);
      } catch (validationError) {
        return NextResponse.json(
          {
            error: 'La consulta no pasó la validación de seguridad.',
            detail:
              validationError instanceof Error ? validationError.message : String(validationError),
          },
          { status: 400 }
        );
      }
      data.sql_text = sqlText;
    }

    let nextVisibility = current.visibility;
    if (
      body.visibility === 'draft' ||
      body.visibility === 'published' ||
      body.visibility === 'archived'
    ) {
      nextVisibility = body.visibility;
      data.visibility = nextVisibility;
      if (nextVisibility === 'published' && !current.published_at) {
        data.published_at = new Date();
      }
    }

    const updated = await prisma.savedView.update({
      where: { id_saved_view: viewId },
      data,
    });

    // Reconciliar el subprocess-módulo con la visibilidad resultante.
    if (nextVisibility === 'archived') {
      await removeViewSubprocess(updated.slug);
    } else if (nextVisibility === 'published') {
      const url = viewSubprocessUrl(updated.slug);
      const existing = await prisma.subprocess.findFirst({
        where: { subprocess_url: url },
        select: { id_subprocess: true },
      });
      if (!existing) {
        await prisma.subprocess.create({
          data: {
            subprocess: updated.name,
            id_process: CUSTOM_VIEWS_PROCESS_ID,
            subprocess_url: url,
          },
        });
      } else if (typeof data.name === 'string') {
        await prisma.subprocess.update({
          where: { id_subprocess: existing.id_subprocess },
          data: { subprocess: updated.name },
        });
      }
    }

    return NextResponse.json({ ok: true, view: updated });
  } catch (error) {
    console.error('Error en PUT /api/custom-views/[id]:', error);
    return NextResponse.json({ error: 'Error al actualizar la vista.' }, { status: 500 });
  }
}

/**
 * DELETE /api/custom-views/[id] → archivar (soft): visibility='archived' y
 * elimina el subprocess-módulo asociado. No borra la fila (histórico).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const guard = await requireCreator(session.user.email);
    if ('error' in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const { id } = await params;
    const viewId = Number(id);
    const current = await prisma.savedView.findUnique({ where: { id_saved_view: viewId } });
    if (!current) {
      return NextResponse.json({ error: 'Vista no encontrada' }, { status: 404 });
    }

    await prisma.savedView.update({
      where: { id_saved_view: viewId },
      data: { visibility: 'archived' },
    });
    await removeViewSubprocess(current.slug);

    return NextResponse.json({ ok: true, archived: viewId });
  } catch (error) {
    console.error('Error en DELETE /api/custom-views/[id]:', error);
    return NextResponse.json({ error: 'Error al archivar la vista.' }, { status: 500 });
  }
}
