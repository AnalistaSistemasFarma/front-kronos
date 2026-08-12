import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/custom-views/catalog
 *
 * Devuelve el árbol del catálogo (Proceso → Fuente → Campos) desde
 * `catalog_source` + `catalog_field` (solo activos). Alimenta el explorador
 * visual del Constructor de Vistas. Ver propuesta técnica §4 / §5.1.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const sources = await prisma.catalogSource.findMany({
      where: { is_active: true },
      orderBy: { sort_order: 'asc' },
      include: {
        fields: {
          where: { is_active: true },
          orderBy: { sort_order: 'asc' },
          select: {
            column_name: true,
            label: true,
            data_type: true,
            is_pii: true,
            sort_order: true,
          },
        },
      },
    });

    // Mapa de nombres de proceso (id_process de las fuentes puede ser null).
    const processIds = [
      ...new Set(
        sources
          .map((s) => s.id_process)
          .filter((id): id is number => typeof id === 'number')
      ),
    ];
    const processes = processIds.length
      ? await prisma.process.findMany({
          where: { id_process: { in: processIds } },
          select: { id_process: true, process: true },
        })
      : [];
    const processName = new Map(processes.map((p) => [p.id_process, p.process]));

    const catalog = sources.map((s) => ({
      id_catalog_source: s.id_catalog_source,
      object_name: s.object_name,
      object_type: s.object_type,
      label: s.label,
      description: s.description,
      icon: s.icon,
      company_column: s.company_column,
      id_process: s.id_process,
      process: s.id_process != null ? processName.get(s.id_process) ?? null : null,
      sort_order: s.sort_order,
      fields: s.fields.map((f) => ({
        column_name: f.column_name,
        label: f.label,
        data_type: f.data_type,
        is_pii: f.is_pii,
      })),
    }));

    return NextResponse.json(
      { count: catalog.length, catalog },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error en /api/custom-views/catalog:', error);
    return NextResponse.json(
      { error: 'Error al cargar el catálogo de vistas' },
      { status: 500 }
    );
  }
}
