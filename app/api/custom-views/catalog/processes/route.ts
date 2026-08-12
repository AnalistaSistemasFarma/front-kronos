import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../lib/prisma';
import { canCreateViews, getUserCompanyIds } from '../../../../../lib/custom-views/access';
import { runReadOnlyQuery } from '../../../../../lib/custom-views/roDb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/custom-views/catalog/processes
 *
 * Lista los FLUJOS DE TRABAJO ACTIVOS (process_category.active = 1) para poblar el
 * selector "Flujo de trabajo" del Constructor de Vistas. Devuelve id + nombre +
 * empresa(s), acotado al alcance de empresa del usuario (salvo admin, que ve todo).
 *
 * Se lee del MISMO motor read-only (VIEWS_DATABASE_URL) donde se EJECUTA el pivote,
 * para que los ids de flujo/campo coincidan con la base de datos de ejecución.
 * Requiere el permiso de creación de vistas (§7).
 */
export async function GET() {
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
        {
          error:
            'No tiene permiso para el Constructor de Vistas. Requiere el módulo "Constructor de Vistas".',
        },
        { status: 403 }
      );
    }

    const isAdmin = user.role === 'admin';
    const companyIds = isAdmin ? [] : await getUserCompanyIds(user.id);

    // Flujos activos con sus empresas (flujo → categoría → empresa).
    const { rows } = await runReadOnlyQuery(`
      SELECT pc.id AS id_process_category, pc.process, c.id_company, c.company
      FROM process_category pc
      INNER JOIN category_request cr ON cr.id = pc.id_category_request
      INNER JOIN company_category_request ccr ON ccr.id_category_request = cr.id
      INNER JOIN company c ON c.id_company = ccr.id_company
      WHERE pc.active = 1
      ORDER BY pc.process, pc.id
    `);

    const allowed = new Set(companyIds);
    const byFlow = new Map<
      number,
      { id_process_category: number; process: string; companies: string[]; companyIds: number[] }
    >();

    for (const row of rows as Array<Record<string, unknown>>) {
      const id = Number(row.id_process_category);
      const idCompany = Number(row.id_company);
      if (!Number.isFinite(id)) continue;
      if (!isAdmin && !allowed.has(idCompany)) continue; // alcance por empresa

      const process = String(row.process ?? '').trim() || `Flujo #${id}`;
      const company = String(row.company ?? '').trim();

      const entry =
        byFlow.get(id) ??
        { id_process_category: id, process, companies: [], companyIds: [] };
      if (company && !entry.companies.includes(company)) entry.companies.push(company);
      if (Number.isFinite(idCompany) && !entry.companyIds.includes(idCompany)) {
        entry.companyIds.push(idCompany);
      }
      byFlow.set(id, entry);
    }

    const processes = [...byFlow.values()].sort((a, b) =>
      a.process.localeCompare(b.process, 'es')
    );

    return NextResponse.json(
      { count: processes.length, processes },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error en /api/custom-views/catalog/processes:', error);
    return NextResponse.json(
      { error: 'Error al cargar los flujos de trabajo.' },
      { status: 500 }
    );
  }
}
