import { prisma } from '../../../../../../lib/prisma';
import { parseAgentTasks } from '../../../../../../lib/chat/status-tasks';
import { guardConversation, jsonNoStore, serverError } from '../../../../../../lib/chat/http';

/**
 * Estado en vivo del agente en una conversación — lo que alimenta el indicador
 * de "qué está haciendo" ("Pensando…", "Consultando SAP…").
 *
 *   GET /api/chat/conversations/12/status
 *
 * Devuelve `{ status: null }` cuando el agente nunca ha publicado un estado en
 * ese hilo; la interfaz lo trata como 'idle'.
 *
 * En un GRUPO no hay "el" estado: hay uno por agente. `status` viene en null y
 * el desglose va en `statuses`, uno por agente que haya publicado algo. Se
 * devuelven las dos formas para que el cliente del hilo directo no cambie.
 *
 * Este endpoint es solo de LECTURA. Quien escribe el estado es el agente, por
 * su propia API (POST /api/chat/agent/status) autenticada con su llave: el
 * usuario no puede fabricar el estado de un bot.
 *
 * Seguridad: guardConversation() valida sesión + propiedad + permiso vigente.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const filas = await prisma.chatAgentStatus.findMany({
      where: { id_conversation: guard.conversationId },
      include: { agent: { select: { display_name: true, avatar_url: true } } },
    });

    const statuses = filas.map((f) => ({
      idAgent: f.id_agent,
      agentName: f.agent.display_name,
      agentAvatarUrl: f.agent.avatar_url,
      state: f.state,
      label: f.label,
      tasks: parseAgentTasks(f.tasks),
      updatedAt: f.updated_at.toISOString(),
    }));

    // En el hilo directo, "el" estado es el del agente del hilo.
    const delHilo =
      guard.kind === 'direct' ? statuses.find((s) => s.idAgent === guard.idAgent) ?? null : null;

    return jsonNoStore({
      status: delHilo
        ? {
            state: delHilo.state,
            label: delHilo.label,
            tasks: delHilo.tasks,
            updatedAt: delHilo.updatedAt,
          }
        : null,
      statuses,
    });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]/status', error);
  }
}
