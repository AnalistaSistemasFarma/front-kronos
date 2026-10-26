import { NextRequest } from 'next/server';
import { jsonNoStore, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { cronogramaDelProyecto } from '../../../../../lib/proyectos/cronograma';
import { propuestasPendientes } from '../../../../../lib/proyectos/propuestas';

export const dynamic = 'force-dynamic';

/**
 * CRONOGRAMA del proyecto (lib/proyectos/cronograma.ts): tareas, solicitudes
 * vinculadas con sus fechas reales y estado vivo (y sus actividades), miembros
 * que pueden ser responsables y propuestas pendientes de los asistentes.
 * Cualquier miembro (un archivado, solo su dueño, en solo lectura).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const cronograma = await cronogramaDelProyecto(guard.user, guard.project, { propuestas: propuestasPendientes });
    return jsonNoStore({ cronograma });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/cronograma', error);
  }
}
