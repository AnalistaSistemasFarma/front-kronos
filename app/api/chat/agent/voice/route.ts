import { authenticateAgent } from '../../../../../lib/chat/agent-auth';
import { jsonNoStore, unauthorized } from '../../../../../lib/chat/http';
import { answerVoiceCall, pollVoiceCalls } from '../../../../../lib/chat/voice-broker';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent || agent.code !== 'duo') return unauthorized();
  return jsonNoStore(pollVoiceCalls(agent.idAgent));
}
export async function POST(request: Request) {
  const agent = await authenticateAgent(request);
  if (!agent || agent.code !== 'duo') return unauthorized();
  const reader = request.body?.getReader();
  if (!reader) return jsonNoStore({ error: 'Falta cuerpo.' }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 300_000) { await reader.cancel(); return jsonNoStore({ error: 'Solicitud demasiado grande.' }, { status: 413 }); } chunks.push(value); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return jsonNoStore({ error: 'JSON inválido.' }, { status: 400 }); }
  if (!body || typeof body.callId !== 'string' || (body.sdp !== undefined && (typeof body.sdp !== 'string' || body.sdp.length > 262144 || !body.sdp.startsWith('v=0')))) return jsonNoStore({ error: 'Respuesta inválida.' }, { status: 400 });
  return jsonNoStore({ ok: answerVoiceCall(agent.idAgent, body.callId, body.sdp) });
}
