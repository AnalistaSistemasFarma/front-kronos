import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { confirmarPropuesta, rechazarPropuesta } from '../../../../../../lib/proyectos/propuestas';

export const dynamic = 'force-dynamic';

/**
 * POST { accion: 'confirmar' | 'rechazar' } — la persona decide sobre una
 * PROPUESTA de un asistente. Es la ÚNICA puerta que ejecuta lo propuesto, y lo
 * hace con la identidad y el rol de quien confirma (lib/proyectos/propuestas.ts).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  try {
    const { id, proposalId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const payload = await readJsonBody(request);
    const n = Number.parseInt(proposalId, 10);
    const idP = String(n) === proposalId.trim() ? n : -1;
    if (payload?.accion === 'confirmar') return jsonNoStore(await confirmarPropuesta(guard.user, guard.project, idP));
    if (payload?.accion === 'rechazar') {
      await rechazarPropuesta(guard.user, guard.project, idP);
      return jsonNoStore({ rechazada: true });
    }
    return badRequest("La acción debe ser 'confirmar' o 'rechazar'.");
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/propuestas/[proposalId]', error);
  }
}
