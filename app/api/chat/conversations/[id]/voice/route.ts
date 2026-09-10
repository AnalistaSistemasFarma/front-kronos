import { isVoiceOriginAllowed } from '../../../../../../lib/chat/voice-origin';
import { prisma } from '../../../../../../lib/prisma';
import { guardConversation, jsonNoStore } from '../../../../../../lib/chat/http';
import { closeVoiceCall, createVoiceCall, touchVoiceCall } from '../../../../../../lib/chat/voice-broker';
import { readClientOrigin } from '../../../../../../lib/chat/client-origin';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardConversation(id);
  if ('response' in guard) return guard.response;
  // Only the existing OpenClaw operator may delegate with its tool authority.
  if (guard.kind !== 'direct' || guard.user.email.toLowerCase() !== 'nicolas.rivera@gsslatam.com') return jsonNoStore({ error: 'Piloto de voz disponible solo para el operador de Duo.' }, { status: 403 });
  const agent = await prisma.agent.findUnique({ where: { id_agent: guard.idAgent }, select: { code: true } });
  if (agent?.code !== 'duo') return jsonNoStore({ error: 'Agente no habilitado para voz.' }, { status: 403 });
  if (!isVoiceOriginAllowed(request)) return jsonNoStore({ error: 'Origen no permitido.' }, { status: 403 });
  const reader = request.body?.getReader();
  if (!reader) return jsonNoStore({ error: 'Falta el cuerpo.' }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 64_000) { await reader.cancel(); return jsonNoStore({ error: 'Solicitud demasiado grande.' }, { status: 413 }); }
    chunks.push(value);
  }
  let body: { action?: string; callId?: string; sdp?: string };
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return jsonNoStore({ error: 'JSON inválido.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return jsonNoStore({ error: 'Solicitud inválida.' }, { status: 400 });
  if (body.action === 'offer' && typeof body.sdp === 'string' && body.sdp.startsWith('v=0')) {
    const callId = createVoiceCall(guard.idAgent, guard.conversationId, guard.user.id, body.sdp);
    if (callId) {
      const origin = readClientOrigin(request);
      try {
        await prisma.chatVoiceCall.create({ data: { id: callId, id_conversation: guard.conversationId,
          id_agent: guard.idAgent, id_user: guard.user.id, client_ip: origin.clientIp,
          user_agent: origin.userAgent, expires_at: new Date(Date.now() + 11 * 60_000) } });
      } catch {
        closeVoiceCall(callId, guard.user.id, guard.conversationId);
        return jsonNoStore({ error: 'No se pudo iniciar la auditoría de voz.' }, { status: 503 });
      }
    }
    return callId ? jsonNoStore({ callId }) : jsonNoStore({ error: 'Ya tiene una llamada activa o no hay capacidad.' }, { status: 429 });
  }
  if (typeof body.callId !== 'string') return jsonNoStore({ error: 'Falta llamada.' }, { status: 400 });
  if (body.action === 'close') { closeVoiceCall(body.callId, guard.user.id, guard.conversationId); return jsonNoStore({ ok: true }); }
  if (body.action !== 'poll') return jsonNoStore({ error: 'Acción inválida.' }, { status: 400 });
  const call = touchVoiceCall(body.callId, guard.user.id, guard.conversationId);
  return call ? jsonNoStore({ sdp: call.answer, error: call.error }) : jsonNoStore({ error: 'La llamada expiró.' }, { status: 410 });
}
