import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '../../../lib/prisma';
import { assertReadOnlyAgainstCatalog } from '../../../lib/sql/readonly';
import {
  canCreateViews,
  uniqueSlug,
  isValidColumnRef,
  viewSubprocessUrl,
  MAX_VIEW_ROWS,
} from '../../../lib/custom-views/access';
import { normalizeFilterDefs, type FilterDef } from '../../../lib/custom-views/filters';
import { resolveModuleProcessId } from '../../../lib/custom-views/modules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/custom-views  → lista de vistas (todas, para el administrador del módulo).
 * Incluye borradores y publicadas para poder gestionarlas desde el constructor.
 * Se puede filtrar por ?visibility=published para la galería.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const visibility = searchParams.get('visibility');
    const where = visibility ? { visibility } : {};

    const views = await prisma.savedView.findMany({
      where,
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: {
        id_saved_view: true,
        name: true,
        slug: true,
        description: true,
        icon: true,
        id_process: true,
        scope_mode: true,
        company_column: true,
        visibility: true,
        sort_order: true,
        row_limit: true,
        published_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json(
      { count: views.length, views },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error en GET /api/custom-views:', error);
    return NextResponse.json({ error: 'Error al listar las vistas.' }, { status: 500 });
  }
}

/**
 * POST /api/custom-views  → crear vista (borrador o publicada).
 *
 * Valida el SQL con el candado + whitelist del catálogo (reusa lib/sql/readonly.ts),
 * inserta en saved_view con slug único autogenerado, y —si visibility='published'—
 * crea de forma idempotente un subprocess bajo id_process 13 con url
 * /process/custom-views/v/<slug> para que la vista aparezca como módulo asignable
 * en /process/administration/users. Ver propuesta técnica §4 / §7.
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
      return NextResponse.json(
        { error: 'No tiene permiso para crear vistas. Requiere el módulo "Constructor de Vistas".' },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'JSON inválido en el cuerpo.' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const sqlText = typeof body.sql_text === 'string' ? body.sql_text.trim() : '';
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null;
    const scopeMode = body.scope_mode === 'all' ? 'all' : 'company';
    const companyColumn =
      typeof body.company_column === 'string' && body.company_column.trim()
        ? body.company_column.trim()
        : null;
    const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : null;
    const visibility = body.visibility === 'published' ? 'published' : 'draft';
    const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0;
    const rowLimit = Math.min(
      Math.max(1, Number.isFinite(Number(body.row_limit)) ? Number(body.row_limit) : 1000),
      MAX_VIEW_ROWS
    );

    if (!name) {
      return NextResponse.json({ error: 'El nombre de la vista es obligatorio.' }, { status: 400 });
    }
    if (!sqlText) {
      return NextResponse.json({ error: 'La consulta SQL es obligatoria.' }, { status: 400 });
    }
    if (scopeMode === 'company') {
      if (!companyColumn) {
        return NextResponse.json(
          {
            error:
              'Con alcance por empresa debe indicar la columna de empresa (company_column) que expone su consulta.',
          },
          { status: 400 }
        );
      }
      if (!isValidColumnRef(companyColumn)) {
        return NextResponse.json(
          { error: 'La columna de empresa no es un identificador SQL válido.' },
          { status: 400 }
        );
      }
    }

    // Candado + whitelist del catálogo (misma guarda del preview / MCP).
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

    // Definiciones de filtros parametrizables (Incremento 3).
    let filterDefs: FilterDef[];
    try {
      filterDefs = normalizeFilterDefs(body.filters);
    } catch (filterError) {
      return NextResponse.json(
        {
          error: 'Definición de filtros inválida.',
          detail: filterError instanceof Error ? filterError.message : String(filterError),
        },
        { status: 400 }
      );
    }

    // Módulo de primer nivel donde se ubica la vista (existente, nuevo o default).
    let idProcess: number;
    try {
      idProcess = await resolveModuleProcessId(prisma, {
        targetProcessId: body.targetProcessId,
        newCategoryName: body.newCategoryName,
      });
    } catch (moduleError) {
      return NextResponse.json(
        {
          error: 'No se pudo resolver el módulo destino.',
          detail: moduleError instanceof Error ? moduleError.message : String(moduleError),
        },
        { status: 400 }
      );
    }

    const slug = await uniqueSlug(name);

    const created = await prisma.savedView.create({
      data: {
        name,
        slug,
        description,
        sql_text: sqlText,
        id_process: idProcess,
        scope_mode: scopeMode,
        company_column: scopeMode === 'company' ? companyColumn : null,
        icon,
        sort_order: sortOrder,
        owner_user_id: user.id,
        row_limit: rowLimit,
        visibility,
        published_at: visibility === 'published' ? new Date() : null,
        filters: {
          create: filterDefs.map((f, i) => ({
            column_name: f.column_name,
            label: f.label,
            filter_type: f.filter_type,
            operator: f.operator,
            options_json: f.options_json,
            default_value: f.default_value,
            required: f.required,
            sort_order: Number.isFinite(f.sort_order) ? f.sort_order : i,
          })),
        },
      },
      include: { filters: { orderBy: { sort_order: 'asc' } } },
    });

    // Al publicar: crear (idempotente) el subprocess-módulo de la vista.
    let subprocessId: number | null = null;
    if (visibility === 'published') {
      const url = viewSubprocessUrl(slug);
      const existingSub = await prisma.subprocess.findFirst({
        where: { subprocess_url: url },
        select: { id_subprocess: true },
      });
      if (existingSub) {
        subprocessId = existingSub.id_subprocess;
      } else {
        const sub = await prisma.subprocess.create({
          data: {
            subprocess: name,
            id_process: idProcess,
            subprocess_url: url,
          },
          select: { id_subprocess: true },
        });
        subprocessId = sub.id_subprocess;
      }
    }

    return NextResponse.json({ ok: true, view: created, subprocessId }, { status: 201 });
  } catch (error) {
    console.error('Error en POST /api/custom-views:', error);
    return NextResponse.json({ error: 'Error al crear la vista.' }, { status: 500 });
  }
}
