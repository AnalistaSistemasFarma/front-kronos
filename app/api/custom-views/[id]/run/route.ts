import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../lib/prisma';
import { assertReadOnlyAgainstCatalog } from '../../../../../lib/sql/readonly';
import { runReadOnlyQuery } from '../../../../../lib/custom-views/roDb';
import {
  canRunView,
  getUserCompanyIds,
  isValidColumnRef,
  MAX_VIEW_ROWS,
} from '../../../../../lib/custom-views/access';
import { buildFilterConditions, type FilterDef } from '../../../../../lib/custom-views/filters';

export const dynamic = 'force-dynamic';

/**
 * POST /api/custom-views/[id]/run
 *
 * Carga la vista PUBLICADA, revalida el candado de solo lectura + whitelist,
 * y la ejecuta con el usuario READ-ONLY, envolviendo:
 *   SELECT TOP (row_limit) * FROM ( <sql> ) AS _v WHERE <scope>
 * inyectando el alcance de empresa del consumidor según scope_mode. §4.2 / §5.3 / §7.
 *
 * El id puede ser el id numérico o el slug de la vista.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

    // Valores de filtros que envía el consumidor (opcional).
    let filterValues: Record<string, unknown> = {};
    try {
      const raw = (await req.json()) as { filterValues?: unknown } | null;
      if (raw && typeof raw.filterValues === 'object' && raw.filterValues !== null) {
        filterValues = raw.filterValues as Record<string, unknown>;
      }
    } catch {
      // Sin cuerpo o JSON inválido: se ejecuta sin valores (se aplican defaults).
    }

    const { id } = await params;
    const numeric = Number(id);
    const view = await prisma.savedView.findFirst({
      where: Number.isFinite(numeric) ? { id_saved_view: numeric } : { slug: id },
      include: { filters: { orderBy: { sort_order: 'asc' } } },
    });
    if (!view || view.visibility !== 'published') {
      return NextResponse.json(
        { error: 'Vista no encontrada o no publicada.' },
        { status: 404 }
      );
    }

    if (!(await canRunView(user.id, user.role ?? null, view.slug))) {
      return NextResponse.json(
        { error: 'No tiene permiso para consultar esta vista.' },
        { status: 403 }
      );
    }

    // Defensa en profundidad: revalidar el candado sobre el SQL guardado.
    try {
      await assertReadOnlyAgainstCatalog(view.sql_text, prisma);
    } catch (validationError) {
      return NextResponse.json(
        {
          error: 'La vista no pasó la revalidación de seguridad.',
          detail:
            validationError instanceof Error ? validationError.message : String(validationError),
        },
        { status: 400 }
      );
    }

    // Alcance de empresa (se une con AND a las condiciones de filtros).
    let scopeClause = '1 = 1';
    if (view.scope_mode === 'company' && view.company_column) {
      if (!isValidColumnRef(view.company_column)) {
        return NextResponse.json(
          { error: 'La columna de empresa de la vista no es válida.' },
          { status: 400 }
        );
      }
      const companyIds =
        user.role === 'admin' ? null : await getUserCompanyIds(user.id);
      if (companyIds && companyIds.length === 0) {
        scopeClause = '1 = 0';
      } else if (companyIds) {
        scopeClause = `${view.company_column} IN (${companyIds.join(',')})`;
      }
    }

    // Condiciones de filtros parametrizadas (solo desde las definiciones guardadas).
    const filterDefs = (view.filters ?? []) as FilterDef[];
    let filterClause = '';
    let filterParams: Record<string, unknown> = {};
    try {
      const built = buildFilterConditions(filterDefs, filterValues);
      filterClause = built.clause;
      filterParams = built.params;
    } catch (filterError) {
      return NextResponse.json(
        {
          error: 'Filtros inválidos.',
          detail: filterError instanceof Error ? filterError.message : String(filterError),
        },
        { status: 400 }
      );
    }

    const whereClause = [filterClause, scopeClause].filter((c) => c && c.length > 0).join(' AND ');

    const cap = Math.min(view.row_limit || 1000, MAX_VIEW_ROWS);
    const inner = view.sql_text.replace(/;\s*$/, '');
    const wrapped = `SELECT TOP (${cap}) * FROM (\n${inner}\n) AS _v WHERE ${whereClause}`;

    try {
      const { columns, rows, rowCount } = await runReadOnlyQuery(wrapped, filterParams);
      return NextResponse.json(
        {
          ok: true,
          view: { id: view.id_saved_view, slug: view.slug, name: view.name },
          filters: filterDefs.map((f) => ({
            id_saved_view_filter: f.id_saved_view_filter,
            column_name: f.column_name,
            label: f.label,
            filter_type: f.filter_type,
            operator: f.operator,
            options_json: f.options_json,
            default_value: f.default_value,
            required: f.required,
            sort_order: f.sort_order,
          })),
          columns,
          rows,
          rowCount,
          truncated: rowCount >= cap,
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    } catch (execError) {
      return NextResponse.json(
        {
          error: 'Error al ejecutar la vista.',
          detail: execError instanceof Error ? execError.message : String(execError),
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error en POST /api/custom-views/[id]/run:', error);
    return NextResponse.json({ error: 'Error del servidor al ejecutar la vista.' }, { status: 500 });
  }
}
