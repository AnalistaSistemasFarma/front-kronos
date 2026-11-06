import { NextRequest } from 'next/server';
import { jsonNoStore, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { cuotasDelProyecto } from '../../../../../lib/proyectos/consumo-anthropic-servidor';

export const dynamic = 'force-dynamic';

/**
 * CONSUMO DE ANTHROPIC de los agentes de un proyecto (2026-10-22): el cupo
 * semanal y la ventana de 5 h que reportó el puente de cada agente designado.
 *
 *   GET /api/proyectos/<id>/consumo  → { agents: CuotaAgenteDto[] }
 *
 * Sesión + MIEMBRO del proyecto (guardProject: 404 si no puede entrar). Vale para
 * todos los roles y también para un proyecto archivado que su dueño consulta:
 * es solo lectura. Sin dato (o sin la tabla todavía) responde una lista vacía y
 * la interfaz no pinta el medidor.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const agents = await cuotasDelProyecto(guard.project.idProject);
    return jsonNoStore({ agents });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/consumo', error);
  }
}
