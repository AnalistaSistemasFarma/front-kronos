/**
 * Núcleo de «Consultar a un agente» en kronos-mcp (sin dependencias del SDK de MCP ni de zod):
 * resolución y validación de la CONCESIÓN, propuestas y auditoría. Lo usan las herramientas
 * (src/tools/correoAgente.ts) y la prueba de integración contra SQL Server
 * (tests/integration/correo/agente.integration.test.ts).
 */
import { Prisma, queryReadOnly } from '../db.js';
import { executeWrite, type TxClient } from '../write.js';
import { codificarAdjunto, limpiarTexto, type MensajeTexto } from './graph.js';
import type { AuthScope } from '../auth.js';

/** Topes. */
export const MAX_TEXTO_MENSAJE = 6_000;
export const MAX_TEXTO_HILO = 40_000;
export const MAX_ADJUNTO_BYTES = 5 * 1024 * 1024;
export const MAX_ADJUNTO_IMAGEN_BYTES = 3_500_000;
export const MAX_ADJUNTO_TEXTO_CHARS = 100_000;
export const MAX_CUERPO_RESPUESTA = 20_000;
export const MAX_NOTA = 4_000;
export const MAX_PENDIENTES_POR_CONCESION = 10;

export const RECHAZO_CONCESION =
  'La concesión no existe, venció, fue revocada o no corresponde a este agente. Pídale a la persona que vuelva a compartir el hilo desde el Correo de SynerLink.';

export class CorreoAgenteRechazo extends Error {}

export interface AgenteFila {
  id_agent: number;
  code: string;
  display_name: string;
  id_subprocess: number | null;
}

export interface Concesion {
  id: number;
  token: string;
  idUser: string;
  mailbox: string;
  conversationId: string;
  asunto: string;
  idAgent: number;
  idChat: number;
  venceEn: string;
  persona: string;
}

const TOKEN_RE = /^cs_[A-Za-z0-9_-]{16,60}$/;

/** El agente de la LLAVE (agentCode; si la llave no lo trae, su nombre = agent.code). */
export function codigoAgente(scope: AuthScope): string {
  return String(scope.agentCode ?? scope.agent ?? '').trim().toLowerCase();
}

export type Lector = Pick<TxClient, '$queryRaw'>;

async function insertarAuditoria(
  tx: Pick<TxClient, '$executeRaw'>,
  e: { idUser: string; mailbox: string; accion: string; conversationId: string; detalle: string; idRequest?: number | null }
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO email_audit (id_user, mailbox, accion, conversation_id, id_request, detalle, created_at)
    VALUES (${e.idUser}, ${e.mailbox.slice(0, 320)}, ${e.accion}, ${e.conversationId.slice(0, 512)}, ${e.idRequest ?? null}, ${e.detalle.slice(0, 1000)}, SYSUTCDATETIME())
  `);
}

/** Auditoría de una lectura o un rechazo (no tumba la respuesta si falla). */
export async function auditarFuera(e: Parameters<typeof insertarAuditoria>[1]): Promise<void> {
  try {
    await executeWrite((tx) => insertarAuditoria(tx, e));
  } catch (err) {
    console.error('[correo-agente] no se pudo auditar:', (err as Error).message);
  }
}

/**
 * Resuelve y VALIDA la concesión para el agente de la llave. Cualquier falla → mismo rechazo.
 * `db` es el cliente de lectura (queryReadOnly) o la transacción de escritura.
 */
export async function resolverConcesion(
  scope: AuthScope,
  shareId: string,
  db?: Lector
): Promise<{ agente: AgenteFila; concesion: Concesion }> {
  const q = <T>(sql: Prisma.Sql) => (db ? (db.$queryRaw<T[]>(sql) as Promise<T[]>) : queryReadOnly<T>(sql));
  const code = codigoAgente(scope);
  if (!code) throw new CorreoAgenteRechazo('Esta llave no identifica a un agente de SynerLink.');
  const agentes = await q<AgenteFila>(Prisma.sql`
    SELECT TOP 1 a.id_agent, a.code, a.display_name, a.id_subprocess
    FROM agent a
    WHERE LOWER(a.code) = ${code} AND a.is_active = 1
  `);
  const agente = agentes[0];
  if (!agente) throw new CorreoAgenteRechazo('Esta llave no identifica a un agente activo de SynerLink.');
  const token = String(shareId ?? '').trim();
  if (!TOKEN_RE.test(token)) throw new CorreoAgenteRechazo(RECHAZO_CONCESION);

  const filas = await q<{
    id: number;
    token: string;
    id_user: string;
    mailbox: string;
    conversation_id: string;
    asunto: string | null;
    id_agent: number;
    id_chat_conversation: number;
    expires_at: Date;
    vigente: number | boolean;
    email: string | null;
    name: string | null;
    isActive: number | boolean | null;
  }>(Prisma.sql`
    SELECT TOP 1 s.id, s.token, s.id_user, s.mailbox, s.conversation_id, s.asunto, s.id_agent, s.id_chat_conversation, s.expires_at,
      CASE WHEN s.revoked_at IS NULL AND s.expires_at > SYSUTCDATETIME() THEN 1 ELSE 0 END AS vigente,
      u.email, u.name, u.isActive
    FROM email_agent_share s
    INNER JOIN [user] u ON u.id = s.id_user
    WHERE s.token = ${token}
  `);
  const s = filas[0];
  if (!s) throw new CorreoAgenteRechazo(RECHAZO_CONCESION);
  const negar = async (motivo: string): Promise<never> => {
    await auditarFuera({
      idUser: s.id_user,
      mailbox: s.mailbox,
      accion: 'AGENTE_DENEGADO',
      conversationId: s.conversation_id,
      detalle: `Agente ${agente.code} intentó usar la concesión #${s.id}: ${motivo}`,
    });
    throw new CorreoAgenteRechazo(RECHAZO_CONCESION);
  };
  if (Number(s.id_agent) !== Number(agente.id_agent)) return negar('la concesión es de otro agente');
  if (!(s.vigente === 1 || s.vigente === true)) return negar('concesión vencida o revocada');
  if (s.isActive === false || s.isActive === 0) return negar('la persona está inactiva');
  if (String(s.email ?? '').trim().toLowerCase() !== String(s.mailbox).trim().toLowerCase()) return negar('el buzón ya no es el de la persona');
  if (agente.id_subprocess == null) return negar('el agente no tiene permiso asignable');
  // La persona todavía tiene este agente asignado (mismo permiso del chat: subproceso + empresa del agente).
  const permiso = await q<{ n: number }>(Prisma.sql`
    SELECT COUNT(1) AS n
    FROM subprocess_user_company suc
    INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
    INNER JOIN agent_company ac ON ac.id_company = cu.id_company AND ac.id_agent = ${agente.id_agent}
    WHERE cu.id_user = ${s.id_user} AND suc.id_subprocess = ${agente.id_subprocess}
  `);
  if (!(Number(permiso[0]?.n) > 0)) return negar('la persona ya no tiene asignado este agente');
  const chat = await q<{ id: number }>(Prisma.sql`
    SELECT TOP 1 c.id FROM chat_conversation c
    WHERE c.id = ${s.id_chat_conversation} AND c.kind = ${'direct'} AND c.id_agent = ${agente.id_agent} AND c.id_user = ${s.id_user}
  `);
  if (!chat[0]) return negar('el chat de la concesión ya no existe');
  return {
    agente,
    concesion: {
      id: Number(s.id),
      token: s.token,
      idUser: s.id_user,
      mailbox: String(s.mailbox).toLowerCase(),
      conversationId: s.conversation_id,
      asunto: s.asunto ?? '',
      idAgent: Number(s.id_agent),
      idChat: Number(s.id_chat_conversation),
      venceEn: new Date(s.expires_at).toISOString(),
      persona: s.name?.trim() || String(s.email ?? ''),
    },
  };
}

const dir = (x: { nombre: string; correo: string }) => (x.nombre && x.nombre.toLowerCase() !== x.correo ? `${x.nombre} <${x.correo}>` : x.correo);

/** Hilo para el agente: texto saneado (sin historial citado), con topes, y adjuntos con su attachment_id. */
export function hiloParaAgente(mensajes: MensajeTexto[]) {
  let total = 0;
  let recortados = 0;
  const out = mensajes.map((m, i) => {
    const restante = Math.max(300, Math.min(MAX_TEXTO_MENSAJE, MAX_TEXTO_HILO - total));
    const { texto, recortado } = limpiarTexto(m.texto, restante);
    total += texto.length;
    if (recortado) recortados++;
    return {
      n: i + 1,
      fecha: m.fecha,
      de: dir(m.de),
      para: m.para.map(dir),
      cc: m.cc.map(dir),
      asunto: m.asunto,
      texto,
      adjuntos: m.adjuntos.map((a) => ({ attachment_id: codificarAdjunto(m.id, a.id), nombre: a.nombre, tipo: a.tipo, tamano_bytes: a.tamano })),
    };
  });
  return { mensajes: out, recortados };
}

/** Destinatarios de la respuesta (como el front: al remitente del último, o a todos sin la persona). */
export function destinatarios(ultimo: MensajeTexto, propio: string, todos: boolean): string[] {
  const base = todos ? [ultimo.de, ...ultimo.para, ...ultimo.cc] : [ultimo.de];
  return [...new Set(base.map((x) => x.correo.trim().toLowerCase()).filter((c) => c && c !== propio))];
}

export function citar(t: string, max: number): string {
  const s = t.length > max ? `${t.slice(0, max - 1)}…` : t;
  return s
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

export type TipoPropuesta = 'RESPUESTA' | 'SOLICITUD' | 'NOTA';

/**
 * Registra una PROPUESTA (nunca la ejecuta): la acción PENDIENTE, su mensaje en el chat de la
 * concesión (la tarjeta) y la auditoría, en UNA transacción. La concesión se revalida DENTRO.
 */
export async function proponer(
  scope: AuthScope,
  shareId: string,
  tipo: TipoPropuesta,
  armar: (c: Concesion, tx: TxClient) => Promise<{ payload: Record<string, unknown>; chat: string; detalle: string; idRequest?: number | null }>
): Promise<{ propuesta_id: number; id_mensaje_chat: number; concesion: Concesion; agente: AgenteFila; payload: Record<string, unknown> }> {
  return executeWrite(async (tx) => {
    const { agente, concesion } = await resolverConcesion(scope, shareId, tx);
    const pend = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(1) AS n FROM email_agent_action WHERE id_share = ${concesion.id} AND estado = ${'PENDIENTE'}
    `);
    if (Number(pend[0]?.n) >= MAX_PENDIENTES_POR_CONCESION) {
      throw new CorreoAgenteRechazo(`Ya hay ${MAX_PENDIENTES_POR_CONCESION} propuestas pendientes en este hilo: espere a que la persona decida.`);
    }
    const a = await armar(concesion, tx);
    const ahora = new Date();
    const accion = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
      INSERT INTO email_agent_action (id_share, id_agent, tipo, estado, payload, created_at)
      OUTPUT INSERTED.id
      VALUES (${concesion.id}, ${agente.id_agent}, ${tipo}, ${'PENDIENTE'}, ${JSON.stringify(a.payload)}, ${ahora})
    `);
    const idAccion = Number(accion[0]?.id);
    const msg = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
      INSERT INTO chat_message (id_conversation, role, body, created_at, id_agent_author, delivered_at)
      OUTPUT INSERTED.id
      VALUES (${concesion.idChat}, ${'agent'}, ${a.chat}, ${ahora}, ${agente.id_agent}, ${ahora})
    `);
    const idMensaje = Number(msg[0]?.id);
    await tx.$executeRaw(Prisma.sql`UPDATE email_agent_action SET id_chat_message = ${idMensaje} WHERE id = ${idAccion}`);
    await tx.$executeRaw(Prisma.sql`UPDATE chat_conversation SET last_message_at = ${ahora} WHERE id = ${concesion.idChat}`);
    await insertarAuditoria(tx, {
      idUser: concesion.idUser,
      mailbox: concesion.mailbox,
      accion: 'AGENTE_PROPONER',
      conversationId: concesion.conversationId,
      idRequest: a.idRequest ?? null,
      detalle: `Agente ${agente.code} propuso #${idAccion} (${tipo}) en la concesión #${concesion.id}: ${a.detalle}. Pendiente de confirmación de la persona.`,
    });
    return { propuesta_id: idAccion, id_mensaje_chat: idMensaje, concesion, agente, payload: a.payload };
  });
}

/** Solicitud vinculada ACTIVA del hilo de la persona (o null). */
export async function vinculoActivo(tx: Lector, c: Concesion): Promise<number | null> {
  const r = await tx.$queryRaw<{ id_request: number | null }[]>(Prisma.sql`
    SELECT TOP 1 l.id_request FROM email_thread_link l
    WHERE l.id_user = ${c.idUser} AND l.conversation_id = ${c.conversationId} AND l.estado = ${'ACTIVO'}
  `);
  return r[0]?.id_request ? Number(r[0].id_request) : null;
}

