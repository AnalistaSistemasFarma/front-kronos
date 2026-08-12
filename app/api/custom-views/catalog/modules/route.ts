import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../lib/prisma';
import { canCreateViews } from '../../../../../lib/custom-views/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/custom-views/catalog/modules
 *
 * Lista los MÓDULOS de primer nivel existentes (tabla `process`) para el selector
 * "Ubicar en" del Constructor de Vistas. Una vista publicada cuelga su subproceso
 * de uno de estos módulos (por defecto "Vistas personalizadas", id 13).
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

    const modules = await prisma.process.findMany({
      orderBy: { process: 'asc' },
      select: { id_process: true, process: true, process_url: true },
    });

    return NextResponse.json(
      { count: modules.length, modules },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error en /api/custom-views/catalog/modules:', error);
    return NextResponse.json(
      { error: 'Error al cargar los módulos de primer nivel.' },
      { status: 500 }
    );
  }
}
