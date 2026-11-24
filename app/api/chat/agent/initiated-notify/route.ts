import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { notifyAgentReply } from '../../../../../lib/chat/notifyAgentReply';
import {
  initiatedTableMissing,
  mcpNotifySecret,
  verifyMcpNotifySecret,
} from '../../../../../lib/chat/agent-initiated';
import { badRequest, jsonNoStore, serverError } from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/** Only a message this recent can be pushed (the MCP calls right after the commit). */
const PUSH_WINDOW_MS = 15 * 60 * 1000;

/**
 * PUSH OF AN AGENT-INITIATED MESSAGE (2026-11-24, msgs 38807–38809).
 *
 *   POST /api/chat/agent/initiated-notify
 *   x-chat-mcp-secret: <CHAT_MCP_NOTIFY_SECRET>
 *   { "idMessage": 7001 }
 *
 * The kronos-mcp tool chat_enviar_mensaje_usuario already wrote the message and its row in
 * chat_agent_initiated_message (in-app unread counter included). This endpoint only sends the push,
 * through notifyAgentReply() — the exact path of a normal agent reply — so the MCP does not duplicate
 * the web-push code nor hold the VAPID keys.
 *
 * SECURITY: shared secret, compared in constant time; without CHAT_MCP_NOTIFY_SECRET the endpoint does
 * not exist (404). It takes ONLY a message id: recipient, agent and text come from the database. The
 * push is claimed atomically (push_sent_at) and only within 15 minutes of the message, so a leaked
 * secret can at most re-send nothing: each message is pushed once.
 */
export async function POST(request: NextRequest) {
  try {
    const secret = mcpNotifySecret();
    if (!secret) return jsonNoStore({ error: 'No encontrado.' }, { status: 404 });
    if (!verifyMcpNotifySecret(request.headers.get('x-chat-mcp-secret'), secret)) {
      return jsonNoStore({ error: 'No autorizado.' }, { status: 401 });
    }

    const raw = await request.text();
    if (raw.length > 1024) return badRequest('Cuerpo demasiado grande.');
    let idMessage = 0;
    try {
      idMessage = Number((JSON.parse(raw) as { idMessage?: unknown })?.idMessage);
    } catch {
      idMessage = 0;
    }
    if (!Number.isInteger(idMessage) || idMessage <= 0) return badRequest('idMessage inválido.');

    const now = new Date();
    let claimed = 0;
    try {
      const r = await prisma.chatAgentInitiatedMessage.updateMany({
        where: { id_message: idMessage, push_sent_at: null, created_at: { gte: new Date(now.getTime() - PUSH_WINDOW_MS) } },
        data: { push_sent_at: now },
      });
      claimed = r.count;
    } catch (error) {
      if (initiatedTableMissing(error)) return jsonNoStore({ error: 'No disponible.' }, { status: 503 });
      throw error;
    }
    if (claimed === 0) return jsonNoStore({ pushed: false, reason: 'ya enviado, vencido o inexistente' }, { status: 409 });

    const row = await prisma.chatAgentInitiatedMessage.findUnique({
      where: { id_message: idMessage },
      select: {
        id_agent: true,
        message: {
          select: {
            role: true,
            body: true,
            id_agent_author: true,
            conversation: { select: { id: true, kind: true, id_user: true, id_agent: true } },
            agentAuthor: { select: { code: true, display_name: true, avatar_url: true } },
          },
        },
      },
    });
    const msg = row?.message;
    const conv = msg?.conversation;
    if (
      !row ||
      !msg ||
      !conv ||
      msg.role !== 'agent' ||
      msg.id_agent_author !== row.id_agent ||
      conv.kind !== 'direct' ||
      conv.id_agent !== row.id_agent ||
      !msg.agentAuthor
    ) {
      return jsonNoStore({ pushed: false, reason: 'mensaje no válido para aviso' }, { status: 409 });
    }

    await notifyAgentReply({
      idConversation: conv.id,
      idUser: conv.id_user,
      agentCode: msg.agentAuthor.code,
      agentName: msg.agentAuthor.display_name,
      agentAvatarUrl: msg.agentAuthor.avatar_url ?? null,
      body: msg.body,
      attachmentCount: 0,
    });
    return jsonNoStore({ pushed: true });
  } catch (error) {
    return serverError('POST /api/chat/agent/initiated-notify', error);
  }
}
