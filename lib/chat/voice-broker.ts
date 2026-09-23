import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';

const expiry = () => new Date(Date.now() + 45_000);
const select = { id: true, id_agent: true, id_conversation: true, id_user: true, offer_sdp: true, answer_sdp: true, error: true, claimed: true, expires_at: true } as const;

export async function createVoiceCall(agent: number, conversation: number, user: string, offer: string) {
  const now = new Date();
  const [active, mine] = await Promise.all([
    prisma.chatVoiceCall.count({ where: { expires_at: { gt: now } } }),
    prisma.chatVoiceCall.count({ where: { id_user: user, expires_at: { gt: now } } }),
  ]);
  if (active >= 8 || mine > 0) return null;
  const id = randomUUID();
  await prisma.chatVoiceCall.create({ data: { id, id_conversation: conversation, id_agent: agent, id_user: user, offer_sdp: offer, expires_at: expiry() } });
  return id;
}

export async function getVoiceCall(id: string, user: string, conversation: number) {
  return prisma.chatVoiceCall.findFirst({ where: { id, id_user: user, id_conversation: conversation, expires_at: { gt: new Date() } }, select });
}

export async function touchVoiceCall(id: string, user: string, conversation: number) {
  const call = await getVoiceCall(id, user, conversation);
  if (!call) return null;
  return prisma.chatVoiceCall.update({ where: { id }, data: { expires_at: expiry() }, select });
}

export async function closeVoiceCall(id: string, user: string, conversation: number) {
  const call = await getVoiceCall(id, user, conversation);
  if (call) await prisma.chatVoiceCall.delete({ where: { id } });
}

export async function pollVoiceCalls(agent: number) {
  const own = await prisma.chatVoiceCall.findMany({ where: { id_agent: agent, expires_at: { gt: new Date() } }, orderBy: { created_at: 'asc' }, select });
  const offers = own.filter(c => !c.claimed);
  if (offers.length) await prisma.chatVoiceCall.updateMany({ where: { id: { in: offers.map(c => c.id) }, claimed: false }, data: { claimed: true } });
  return { active: own.map(c => c.id), offers: offers.map(c => ({ id: c.id, conversation: c.id_conversation, offer: c.offer_sdp })) };
}

export async function answerVoiceCall(agent: number, id: string, answer?: string) {
  const call = await prisma.chatVoiceCall.findFirst({ where: { id, id_agent: agent, claimed: true, expires_at: { gt: new Date() } }, select });
  if (!call) return false;
  await prisma.chatVoiceCall.update({ where: { id }, data: answer ? { answer_sdp: answer, offer_sdp: '' } : { error: 'OpenClaw no pudo conectar la voz. Revise Talk en el Gateway.', offer_sdp: '' } });
  return true;
}
