import { prisma } from '../prisma';
import { getChatAccess, getChatAgentAccess, type ChatAgentAccess } from './access';
import { badRequest, forbidden, guardConversation, type ChatSessionUser } from './http';
import type { DestinoReenvio } from './compartir';

/**
 * FORWARD A CHAT MESSAGE TO AN AGENT (2026-11-18).
 *
 * Request from Nicolás Rivera (SynerLink prod msg 35511): «intenté reenviar un
 * mensaje a un agente y no me dejó». The message lands in the user's DIRECT
 * conversation with that agent; if it does not exist yet, it is created exactly
 * like when the user opens a chat with the agent (POST /api/chat/conversations).
 *
 * The forwarded message is published as a regular user message
 * (`role = 'user'`, `delivered_at = null`), so the agent's inbox
 * (GET /api/chat/agent/inbox, direct threads) picks it up as if the user had
 * typed it.
 *
 * Permissions: only agents the user has assigned in the chat
 * (getChatAccess / getChatAgentAccess, the same list as the chat sidebar).
 */

/** The user's active direct conversation with an agent, creating it if missing. */
export async function findOrCreateDirectConversation(
  userId: string,
  agent: Pick<ChatAgentAccess, 'idAgent' | 'displayName'>
): Promise<{ id: number; created: boolean }> {
  // Only `kind = 'direct'`: a group also stores id_user/id_agent (creator and
  // host), see the note in app/api/chat/conversations/route.ts.
  const existing = await prisma.chatConversation.findFirst({
    where: { kind: 'direct', id_user: userId, id_agent: agent.idAgent, archived: false },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await prisma.chatConversation.create({
    data: { kind: 'direct', id_user: userId, id_agent: agent.idAgent, title: agent.displayName },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Agents the user can forward to: the agents of their chat, with the existing
 * direct conversation when there is one. The origin conversation is skipped
 * (forwarding a message to the thread it already lives in makes no sense).
 */
export async function agentForwardDestinations(user: ChatSessionUser, originId: number | null): Promise<DestinoReenvio[]> {
  const access = await getChatAccess(user.email);
  if (!access.canUseChat || access.agents.length === 0) return [];

  const threads = await prisma.chatConversation.findMany({
    where: {
      kind: 'direct',
      id_user: user.id,
      archived: false,
      id_agent: { in: access.agents.map((a) => a.idAgent) },
    },
    orderBy: { id: 'desc' },
    select: { id: true, id_agent: true, last_message_at: true },
  });
  // Newest first: the first row per agent is the one POST /api/chat/conversations reuses.
  const threadByAgent = new Map<number, (typeof threads)[number]>();
  for (const t of threads) if (!threadByAgent.has(t.id_agent)) threadByAgent.set(t.id_agent, t);

  const destinations: DestinoReenvio[] = [];
  for (const agent of access.agents) {
    const thread = threadByAgent.get(agent.idAgent) ?? null;
    if (thread && thread.id === originId) continue;
    destinations.push({
      idConversation: thread?.id ?? null,
      idAgent: agent.idAgent,
      tipo: 'agente',
      titulo: agent.displayName?.trim() || agent.code,
      detalle: agent.handle ? `@${agent.handle}` : null,
      lastMessageAt: thread?.last_message_at ? thread.last_message_at.toISOString() : null,
    });
  }
  return destinations;
}

/**
 * DESTINATION gate when forwarding to an agent: the user must have the agent
 * assigned; then the direct conversation is found or created and goes through
 * the regular conversation gate (ownership + current permission).
 */
export async function agentForwardGate(user: ChatSessionUser, idAgent: number, originId: number) {
  const agent = await getChatAgentAccess(user.email, idAgent);
  if (!agent) return { response: forbidden('No tiene permiso para hablar con este agente.') };

  const thread = await findOrCreateDirectConversation(user.id, agent);
  if (thread.id === originId) return { response: badRequest('El mensaje ya está en esta conversación.') };

  const guard = await guardConversation(String(thread.id));
  if ('response' in guard) return guard;
  if (guard.kind !== 'direct') return { response: forbidden('No tiene permiso para hablar con este agente.') };
  return guard;
}
