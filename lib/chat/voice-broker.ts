import { randomUUID } from 'node:crypto';
type Call = { id: string; agent: number; conversation: number; user: string; offer: string; answer?: string; error?: string; claimed: boolean; expires: number };
const state = globalThis as typeof globalThis & { synerlinkVoiceCalls?: Map<string, Call> };
const calls = state.synerlinkVoiceCalls ??= new Map<string, Call>();
function sweep() { for (const [id, call] of calls) if (call.expires < Date.now()) calls.delete(id); }
export function createVoiceCall(agent: number, conversation: number, user: string, offer: string) {
  sweep();
  if (calls.size >= 8 || [...calls.values()].some(c => c.user === user)) return null;
  const id = randomUUID();
  calls.set(id, { id, agent, conversation, user, offer, claimed: false, expires: Date.now() + 45_000 });
  return id;
}
export function getVoiceCall(id: string, user: string, conversation: number) {
  sweep(); const call = calls.get(id);
  return call?.user === user && call.conversation === conversation ? call : undefined;
}
export function touchVoiceCall(id: string, user: string, conversation: number) {
  const call = getVoiceCall(id, user, conversation);
  if (call) call.expires = Date.now() + 45_000;
  return call;
}
export function closeVoiceCall(id: string, user: string, conversation: number) {
  if (getVoiceCall(id, user, conversation)) calls.delete(id);
}
export function pollVoiceCalls(agent: number) {
  sweep(); const own = [...calls.values()].filter(c => c.agent === agent);
  const offers = own.filter(c => !c.claimed); offers.forEach(c => { c.claimed = true; });
  return { active: own.map(c => c.id), offers: offers.map(c => ({ id: c.id, conversation: c.conversation, offer: c.offer })) };
}
export function answerVoiceCall(agent: number, id: string, answer?: string) {
  sweep(); const call = calls.get(id);
  if (!call || call.agent !== agent || !call.claimed) return false;
  if (answer) call.answer = answer;
  else call.error = 'OpenClaw no pudo conectar la voz. Revise Talk en el Gateway.';
  call.offer = ''; return true;
}
