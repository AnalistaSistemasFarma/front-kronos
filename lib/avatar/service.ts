import 'server-only';
import { checkAdminPrivileges } from '../access-control';
import { getChatAccess, type ChatAgentAccess } from '../chat/access';
import { prisma } from '../prisma';
import {
  agentAvatarNotionUrl,
  isNotionAvatarUrl,
  parseAvatarConfig,
  serializeAvatarConfig,
  userAvatarUrl,
} from './compose';
import {
  AvatarStoreUnavailableError,
  deleteAvatarConfig,
  readAvatarConfig,
  readAvatarConfigs,
  upsertAvatarConfig,
  type AvatarConfigRow,
} from './store';
import { esFigura, parseAgentAvatarConfig, serializeAgentAvatarConfig, type AgentAvatarConfig } from './agente';
import type { AvatarConfig } from './types';

/**
 * Reglas del avatar estilo Notion: quién edita qué y cómo se refleja en la
 * imagen que ya usa toda la aplicación.
 *
 * TRUCO PARA NO TOCAR EL RESTO DE LA APP: al guardar, `user.image` (o
 * `agent.avatar_url`) pasa a apuntar a /api/avatar/…?v=<fecha>. Esa columna ya
 * la pintan el encabezado, el chat, los grupos y las menciones, así que el
 * avatar nuevo aparece en todas partes sin cambiar esas pantallas. La imagen
 * anterior se guarda en la fila del avatar para que "Quitar avatar" la
 * devuelva tal cual.
 */

/* ─────────────────────────────── Personas ─────────────────────────────── */

export interface UserAvatarState {
  config: AvatarConfig | null;
  image: string | null;
}

export async function getUserAvatar(userId: string): Promise<UserAvatarState> {
  const [fila, user] = await Promise.all([
    readAvatarConfig('user', userId),
    prisma.user.findUnique({ where: { id: userId }, select: { image: true } }),
  ]);
  return { config: fila ? parseAvatarConfig(fila.configJson, 'user') : null, image: user?.image ?? null };
}

export async function saveUserAvatar(userId: string, email: string, config: AvatarConfig): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } });
  if (!user) throw new Error('Usuario no encontrado.');
  const ahora = new Date();
  const anterior = isNotionAvatarUrl(user.image) ? null : user.image ?? null;
  // Primero la configuración: si la tabla no existe, falla aquí y la foto
  // de la persona queda intacta.
  await upsertAvatarConfig('user', userId, serializeAvatarConfig(config), anterior, email, ahora);
  const image = userAvatarUrl(userId, ahora.getTime());
  await prisma.user.update({ where: { id: userId }, data: { image } });
  await prisma.userAuditLog.create({
    data: {
      user_id: userId,
      action: 'PROFILE_UPDATE',
      performed_by: email,
      details: `Updated: avatar estilo Notion (${user.image ?? 'sin imagen'} -> ${image})`,
    },
  });
  return image;
}

/** Quita el avatar y devuelve la foto que tenía antes (o null). */
export async function removeUserAvatar(userId: string, email: string): Promise<string | null> {
  const [fila, user] = await Promise.all([
    readAvatarConfig('user', userId),
    prisma.user.findUnique({ where: { id: userId }, select: { image: true } }),
  ]);
  if (!user) throw new Error('Usuario no encontrado.');
  let image = user.image ?? null;
  // Solo se restaura si la imagen actual SIGUE siendo el avatar: si la persona
  // ya puso otra foto por URL, esa manda y no se pisa.
  if (isNotionAvatarUrl(user.image)) {
    image = fila?.previousImage ?? null;
    await prisma.user.update({ where: { id: userId }, data: { image } });
  }
  await deleteAvatarConfig('user', userId);
  await prisma.userAuditLog.create({
    data: {
      user_id: userId,
      action: 'PROFILE_UPDATE',
      performed_by: email,
      details: `Updated: avatar estilo Notion retirado (${user.image ?? 'sin imagen'} -> ${image ?? 'sin imagen'})`,
    },
  });
  return image;
}

/* ──────────────────────────────── Agentes ──────────────────────────────── */

export type MotivoGestion = 'responsable' | 'administrador';

export interface ManagedAgent {
  idAgent: number;
  code: string;
  displayName: string;
  avatarUrl: string | null;
  avatarVersion: number | null;
  motivo: MotivoGestion;
  /** Persona Lorelei (v3) o figura (v4: animal, planeta, constelación, estrella, robot). */
  config: AgentAvatarConfig | null;
}

/**
 * Agentes cuyo avatar puede cambiar la persona. Regla (pendiente de
 * confirmar con Nicolás, ver el PR):
 *   - tiene que VER el agente en el chat (getChatAccess), y además
 *   - ser su RESPONSABLE en la hoja de vida (agent_profile.owner_email), o
 *   - ser administrador (la misma reja que ya protege "cambiar la foto").
 * Tener permiso para CHATEAR con un agente no basta: su cara la ve toda la
 * empresa, así que no la puede cambiar cualquiera que hable con él.
 */
export async function listManagedAgents(email: string): Promise<ManagedAgent[]> {
  const access = await getChatAccess(email);
  if (!access.canUseChat || access.agents.length === 0) return [];

  const esAdmin = await checkAdminPrivileges(email);
  const responsables = await prisma.agentProfile.findMany({
    where: { id_agent: { in: access.agents.map((a) => a.idAgent) }, owner_email: email.trim() },
    select: { id_agent: true },
  });
  const propios = new Set(responsables.map((r) => r.id_agent));

  const gestionables: Array<ChatAgentAccess & { motivo: MotivoGestion }> = [];
  for (const a of access.agents) {
    if (propios.has(a.idAgent)) gestionables.push({ ...a, motivo: 'responsable' });
    else if (esAdmin) gestionables.push({ ...a, motivo: 'administrador' });
  }
  // Primero los suyos; luego los demás en el orden del chat.
  gestionables.sort((x, y) => (x.motivo === y.motivo ? 0 : x.motivo === 'responsable' ? -1 : 1));

  let filas = new Map<string, AvatarConfigRow>();
  try {
    filas = await readAvatarConfigs('agent', gestionables.map((a) => String(a.idAgent)));
  } catch (error) {
    // Sin la tabla, la lista igual sirve (el Perfil avisa que falta habilitarla).
    if (!(error instanceof AvatarStoreUnavailableError)) throw error;
  }
  return gestionables.map((a) => {
    const fila = filas.get(String(a.idAgent));
    return {
      idAgent: a.idAgent,
      code: a.code,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      avatarVersion: a.avatarVersion,
      motivo: a.motivo,
      config: fila ? parseAgentAvatarConfig(fila.configJson) : null,
    };
  });
}

/** El agente, si la persona lo puede gestionar; null si no. */
export async function findManagedAgent(email: string, code: string): Promise<ManagedAgent | null> {
  const lista = await listManagedAgents(email);
  return lista.find((a) => a.code === code) ?? null;
}

export async function saveAgentAvatar(agent: ManagedAgent, email: string, config: AgentAvatarConfig): Promise<string> {
  const fila = await prisma.agent.findUnique({ where: { id_agent: agent.idAgent }, select: { avatar_url: true } });
  const ahora = new Date();
  const anterior = isNotionAvatarUrl(fila?.avatar_url) ? null : fila?.avatar_url ?? null;
  // Regla: la semilla de una persona Lorelei de un asistente es SU NOMBRE (se fuerza aquí, no se
  // confía en el cliente). Las figuras no usan semilla.
  const final: AgentAvatarConfig = esFigura(config) ? config : { ...config, seed: agent.displayName.slice(0, 64) };
  await upsertAvatarConfig('agent', String(agent.idAgent), serializeAgentAvatarConfig(final), anterior, email, ahora);
  const url = agentAvatarNotionUrl(agent.code, ahora.getTime());
  await prisma.agent.update({ where: { id_agent: agent.idAgent }, data: { avatar_url: url } });
  console.info(`[avatar] ${email} cambió el avatar del agente ${agent.code} -> ${url}`);
  return url;
}

export async function removeAgentAvatar(agent: ManagedAgent, email: string): Promise<string | null> {
  const [fila, actual] = await Promise.all([
    readAvatarConfig('agent', String(agent.idAgent)),
    prisma.agent.findUnique({ where: { id_agent: agent.idAgent }, select: { avatar_url: true } }),
  ]);
  let url = actual?.avatar_url ?? null;
  if (isNotionAvatarUrl(url)) {
    url = fila?.previousImage ?? null;
    await prisma.agent.update({ where: { id_agent: agent.idAgent }, data: { avatar_url: url } });
  }
  await deleteAvatarConfig('agent', String(agent.idAgent));
  console.info(`[avatar] ${email} retiró el avatar estilo Notion del agente ${agent.code}`);
  return url;
}
