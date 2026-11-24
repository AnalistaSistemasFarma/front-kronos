import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '../prisma';
import { buildInitiatedContextPrefix, type InitiatedContextItem } from './agent-initiated-rules';

/**
 * AGENT-INITIATED MESSAGES (2026-11-24, approved by Nicolás Rivera, conv 1 msgs 38807–38809).
 *
 * The kronos-mcp tool chat_enviar_mensaje_usuario (mcp/src/tools/agentMessage.ts) posts an agent
 * message in a person's direct conversation and writes its row in chat_agent_initiated_message.
 * This module is the app side:
 *
 *  - agentInitiatedIds(): which messages of a page carry the «Mensaje iniciado por el asistente» badge.
 *  - withInitiatedContext(): when the person REPLIES, the agent session that serves that conversation
 *    did not write the message (each SynerLink conversation is its own session on openclaw, and the
 *    tool may have been called from another conversation). The inbox therefore prepends the
 *    agent-initiated message(s) sent since the person's previous message to the FIRST pending message
 *    of that conversation. Done server-side on purpose: every bridge (synerlink channel, openclaw
 *    bridges) already forwards `body`, so no bridge needs an in-place patch.
 *  - verifyMcpNotifySecret(): the push endpoint (app/api/chat/agent/initiated-notify) is called by
 *    the MCP with a shared secret (CHAT_MCP_NOTIFY_SECRET, ≥ 32 characters; missing = endpoint off).
 *
 * Every read tolerates the table not existing yet (code deployed before the DDL): the chat keeps
 * working exactly as before.
 */

/** The table does not exist in this database yet (Prisma P2021 or SQL Server 208). */
export function initiatedTableMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: string; number?: number; message?: string };
  const message = e.message ?? '';
  return (
    e.code === 'P2021' ||
    e.number === 208 ||
    (/chat_agent_initiated_message/i.test(message) && /Invalid object name|does not exist/i.test(message))
  );
}

export async function agentInitiatedIds(messageIds: number[]): Promise<Set<number>> {
  if (messageIds.length === 0) return new Set();
  try {
    const rows = await prisma.chatAgentInitiatedMessage.findMany({
      where: { id_message: { in: messageIds } },
      select: { id_message: true },
    });
    return new Set(rows.map((r) => r.id_message));
  } catch (error) {
    if (initiatedTableMissing(error)) return new Set();
    throw error;
  }
}

/** Only agent-initiated messages this recent are handed over as context. */
export const CONTEXT_WINDOW_DAYS = 30;
/** At most this many agent-initiated messages per reply. */
export const CONTEXT_MAX_ITEMS = 3;

interface PendingDirect {
  id: number;
  id_conversation: number;
  body: string;
  conversation: { kind: string };
}

/**
 * Prepends, to the FIRST pending person message of each direct conversation, the agent-initiated
 * messages posted after that person's previous message. Never throws: on any error the messages go
 * out unchanged (the context is a convenience; the delivery is what matters).
 */
export async function withInitiatedContext<T extends PendingDirect>(pending: T[]): Promise<T[]> {
  const direct = pending.filter((m) => m.conversation.kind === 'direct');
  if (direct.length === 0) return pending;
  try {
    const firstByConversation = new Map<number, T>();
    for (const m of [...direct].sort((a, b) => a.id - b.id)) {
      if (!firstByConversation.has(m.id_conversation)) firstByConversation.set(m.id_conversation, m);
    }
    const since = new Date(Date.now() - CONTEXT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // One indexed query; in the usual case (no agent-initiated messages) it ends here.
    const candidates = await prisma.chatAgentInitiatedMessage.findMany({
      where: { id_conversation: { in: [...firstByConversation.keys()] }, created_at: { gte: since } },
      select: { id_message: true, id_conversation: true, reason: true },
      orderBy: { id_message: 'asc' },
    });
    if (candidates.length === 0) return pending;

    const prefixById = new Map<number, string>();
    for (const [idConversation, first] of firstByConversation) {
      const own = candidates.filter((c) => c.id_conversation === idConversation && c.id_message < first.id);
      if (own.length === 0) continue;
      const previousUser = await prisma.chatMessage.findFirst({
        where: { id_conversation: idConversation, role: 'user', id: { lt: first.id } },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      const fresh = own.filter((c) => !previousUser || c.id_message > previousUser.id).slice(-CONTEXT_MAX_ITEMS);
      if (fresh.length === 0) continue;
      const messages = await prisma.chatMessage.findMany({
        where: { id: { in: fresh.map((c) => c.id_message) } },
        select: { id: true, body: true, created_at: true },
        orderBy: { id: 'asc' },
      });
      const items: InitiatedContextItem[] = messages.map((msg) => ({
        body: msg.body,
        createdAt: msg.created_at,
        reason: fresh.find((c) => c.id_message === msg.id)?.reason ?? null,
      }));
      const prefix = buildInitiatedContextPrefix(items);
      if (prefix) prefixById.set(first.id, prefix);
    }
    if (prefixById.size === 0) return pending;
    return pending.map((m) => (prefixById.has(m.id) ? { ...m, body: `${prefixById.get(m.id)}${m.body}` } : m));
  } catch (error) {
    if (!initiatedTableMissing(error)) console.error('[chat/agent-initiated] context for the inbox', error);
    return pending;
  }
}

/** The configured secret, or null when the push endpoint is off (missing or shorter than 32). */
export function mcpNotifySecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = (env.CHAT_MCP_NOTIFY_SECRET ?? '').trim();
  return secret.length >= 32 ? secret : null;
}

/** Constant-time comparison of the presented header with the configured secret. */
export function verifyMcpNotifySecret(presented: string | null | undefined, secret: string | null): boolean {
  if (!secret || !presented) return false;
  const a = createHash('sha256').update(presented.trim(), 'utf8').digest();
  const b = createHash('sha256').update(secret, 'utf8').digest();
  return timingSafeEqual(a, b);
}
