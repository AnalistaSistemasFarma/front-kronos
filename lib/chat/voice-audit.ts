import { createHash } from 'node:crypto';
import { prisma } from '../prisma';

// Gateway and Windows clocks are independent (observed skew ~39 s in testing).
const MAX_CLOCK_SKEW_MS = 2 * 60_000;
export type VoiceTranscript = { eventId: string; role: 'user' | 'assistant'; text: string; timestamp: string };
export function parseVoiceTranscript(value: unknown): VoiceTranscript | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.eventId !== 'string' || !/^[\w:-]{1,180}$/.test(v.eventId) ||
      (v.role !== 'user' && v.role !== 'assistant') || typeof v.text !== 'string' ||
      !v.text.trim() || v.text.length > 40_000 || typeof v.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(v.timestamp))) return null;
  return { eventId: v.eventId, role: v.role, text: v.text.trim(), timestamp: v.timestamp };
}

export async function saveVoiceTranscript(agent: number, callId: string, event: VoiceTranscript) {
  const call = await prisma.chatVoiceCall.findUnique({ where: { id: callId } });
  if (!call || call.id_agent !== agent) return null;
  // The existing conversation must still belong to the server-bound operator
  // and agent. No user id, conversation id or client IP comes from the bridge.
  const conversation = await prisma.chatConversation.findFirst({ where: {
    id: call.id_conversation, id_user: call.id_user, id_agent: agent, kind: 'direct',
  }, select: { id: true } });
  if (!conversation) return null;
  const occurred = new Date(event.timestamp);
  if (occurred.getTime() < call.created_at.getTime() - MAX_CLOCK_SKEW_MS ||
      occurred.getTime() > call.expires_at.getTime() + MAX_CLOCK_SKEW_MS || occurred.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) return null;
  const eventKey = createHash('sha256').update(`${callId}:${event.eventId}`).digest('hex');
  const existing = () => prisma.chatVoiceEvent.findUnique({ where: { event_key: eventKey } });
  const prior = await existing();
  if (prior) return { id: prior.id_message, duplicate: true };
  try {
    return await prisma.$transaction(async tx => {
      const message = await tx.chatMessage.create({ data: {
        id_conversation: call.id_conversation,
        role: event.role === 'user' ? 'user' : 'agent', body: event.text,
        id_user_author: event.role === 'user' ? call.id_user : null,
        id_agent_author: event.role === 'assistant' ? agent : null,
        client_ip: event.role === 'user' ? call.client_ip : null,
        user_agent: event.role === 'user' ? call.user_agent : null,
        created_at: occurred,
        // Voice already invoked the agent. Never put it in the text inbox.
        delivered_at: occurred,
      }, select: { id: true } });
      await tx.chatVoiceEvent.create({ data: { event_key: eventKey, call_id: callId, id_message: message.id } });
      await tx.chatConversation.updateMany({ where: { id: call.id_conversation,
        OR: [{ last_message_at: null }, { last_message_at: { lt: occurred } }],
      }, data: { last_message_at: occurred } });
      return { id: message.id, duplicate: false };
    });
  } catch (error) {
    // The unique receipt arbitrates concurrent retries across processes. The
    // losing transaction rolls its message back, rather than leaving a twin.
    if ((error as { code?: string }).code === 'P2002') {
      const receipt = await existing();
      if (receipt) return { id: receipt.id_message, duplicate: true };
    }
    throw error;
  }
}
