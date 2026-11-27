/**
 * chat_enviar_mensaje_usuario (WRITE, narrow) — 2026-11-24.
 *
 * Approved by Nicolás Rivera (SynerLink prod conv 1, msgs 38807–38809): an agent could not
 * proactively tell a person something (e.g. Paco/vega could not tell Mauricio Duque that he
 * now has SAP). Each SynerLink conversation is a separate agent session, so the agent needs a
 * way to post into the RECIPIENT's own direct conversation with that agent.
 *
 * What it does, in ONE transaction (src/write.ts), parameterized SQL only:
 *   1. The agent comes from the KEY (agentCode), never from the client.
 *   2. The recipient (email or user id) must be an ACTIVE SynerLink user with access to this
 *      agent: the agent's permission subprocess (subprocess_user_company) in a company the
 *      agent belongs to (agent_company) and that is inside the key's company scope, plus the
 *      chat module (/process/chat). Same rule as lib/chat/access.ts in the app.
 *   3. Rate limits counted on chat_agent_initiated_message (survive restarts), serialized per
 *      agent with sp_getapplock: per agent per 24 h and per (agent, recipient) per 24 h.
 *   4. Reuses the recipient's open direct conversation with this agent (kind='direct', not
 *      archived, newest first — like findOrCreateDirectConversation in the app) or creates it
 *      with the same columns the app uses (title = agent display name).
 *   5. Inserts the AGENT message (role 'agent', id_agent_author = agent, delivered_at = now,
 *      read_at NULL so it counts as unread) and bumps last_message_at.
 *   6. Inserts the audit/marker row (chat_agent_initiated_message): requester key, recipient,
 *      reason, message id. The app shows the «Mensaje iniciado por el asistente» badge from it
 *      and hands the message to the agent session as context when the person replies.
 *
 * After the commit, the push notification is requested from the app (POST
 * /api/chat/agent/initiated-notify, shared secret CHAT_MCP_NOTIFY_SECRET), which reuses
 * notifyAgentReply() — the same path as a normal agent reply. A failed push never undoes the
 * message (the in-app unread counter already shows it).
 *
 * Enabled per key ONLY: the tool is registered only when the key's allowedTools lists it
 * explicitly and the key has agentCode (keys without allowedTools never get it).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuditLogger } from '../audit.js';
import type { AuthScope } from '../auth.js';
import { Prisma } from '../db.js';
import { executeWrite, type TxClient } from '../write.js';

export const AGENT_MESSAGE_TOOL = 'chat_enviar_mensaje_usuario';
export const AGENT_MESSAGE_TOOLS = [AGENT_MESSAGE_TOOL] as const;

/** Same URL the app uses for the chat module permission (lib/chat/access.ts CHAT_MODULE_URL). */
export const CHAT_MODULE_URL = '/process/chat';
export const MAX_BODY_CHARS = 4000;
export const MAX_REASON_CHARS = 300;
export const DEFAULT_AGENT_DAILY_LIMIT = 20;
export const DEFAULT_RECIPIENT_DAILY_LIMIT = 5;
const WINDOW_HOURS = 24;

export class AgentMessageRejection extends Error {}

export interface AgentMessageLimits {
  perAgent: number;
  perRecipient: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadAgentMessageLimits(env: NodeJS.ProcessEnv = process.env): AgentMessageLimits {
  return {
    perAgent: positiveInt(env.MCP_AGENT_MESSAGE_DAILY_LIMIT, DEFAULT_AGENT_DAILY_LIMIT),
    perRecipient: positiveInt(env.MCP_AGENT_MESSAGE_RECIPIENT_DAILY_LIMIT, DEFAULT_RECIPIENT_DAILY_LIMIT),
  };
}

/** The tool exists for a key only if it is listed explicitly and the key names its agent. */
export function agentMessageEnabled(scope: AuthScope): boolean {
  return Boolean(scope.agentCode) && Array.isArray(scope.allowedTools) && scope.allowedTools.includes(AGENT_MESSAGE_TOOL);
}

export interface AgentMessageArgs {
  destinatario: string;
  texto: string;
  motivo: string;
}

export interface AgentMessageResult {
  status: 'enviado';
  id_mensaje: number;
  id_conversacion: number;
  conversacion_creada: boolean;
  destinatario: { nombre: string | null; email: string };
  limites: { usados_hoy_agente: number; tope_agente: number; usados_hoy_destinatario: number; tope_destinatario: number };
}

const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type RecipientRef = { kind: 'email'; value: string } | { kind: 'id'; value: string };

export function parseRecipient(raw: string): RecipientRef {
  const value = raw.trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AgentMessageRejection('el correo del destinatario no es válido');
    return { kind: 'email', value: email };
  }
  if (!USER_ID_RE.test(value)) throw new AgentMessageRejection('indique el correo o el id de usuario de SynerLink del destinatario');
  return { kind: 'id', value };
}

/** Normalizes the Markdown body: CRLF → LF, trimmed, no NUL characters. */
export function normalizeBody(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
}

/** Single-line reason for the audit row. */
export function normalizeReason(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS);
}

function isTrue(v: boolean | number | null | undefined): boolean {
  return v === true || v === 1;
}

export async function sendAgentInitiatedMessage(
  tx: TxClient,
  scope: AuthScope,
  args: AgentMessageArgs,
  limits: AgentMessageLimits
): Promise<AgentMessageResult> {
  const agentCode = scope.agentCode?.trim().toLowerCase();
  if (!agentCode) throw new AgentMessageRejection('esta llave no identifica a un agente (falta agentCode)');
  const body = normalizeBody(args.texto);
  if (!body) throw new AgentMessageRejection('el texto del mensaje está vacío');
  if (body.length > MAX_BODY_CHARS) {
    throw new AgentMessageRejection(`el texto supera ${MAX_BODY_CHARS} caracteres (tiene ${body.length})`);
  }
  const reason = normalizeReason(args.motivo);
  if (reason.length < 5) throw new AgentMessageRejection('indique el motivo del mensaje (mínimo 5 caracteres)');
  const ref = parseRecipient(args.destinatario);

  // 1. The key's agent.
  const agents = await tx.$queryRaw<{ id_agent: number; code: string; display_name: string; id_subprocess: number | null }[]>(Prisma.sql`
    SELECT TOP 1 a.id_agent, a.code, a.display_name, a.id_subprocess
    FROM agent a
    WHERE LOWER(a.code) = ${agentCode} AND a.is_active = 1
  `);
  const agent = agents[0];
  if (!agent || agent.id_subprocess == null) {
    throw new AgentMessageRejection(`el agente "${agentCode}" no existe, está inactivo o no tiene permiso asignable en SynerLink`);
  }
  const idAgent = Number(agent.id_agent);

  // 2. The recipient.
  const users = await tx.$queryRaw<{ id: string; name: string | null; email: string; isActive: boolean | number | null }[]>(
    ref.kind === 'email'
      ? Prisma.sql`SELECT u.id, u.name, u.email, u.isActive FROM [user] u WHERE LOWER(LTRIM(RTRIM(u.email))) = ${ref.value}`
      : Prisma.sql`SELECT u.id, u.name, u.email, u.isActive FROM [user] u WHERE u.id = ${ref.value}`
  );
  if (users.length === 0) throw new AgentMessageRejection('no existe un usuario de SynerLink con ese correo o id');
  if (users.length > 1) throw new AgentMessageRejection('hay más de un usuario con ese correo; debe revisarlo un administrador');
  const user = users[0]!;
  if (!isTrue(user.isActive)) throw new AgentMessageRejection('el destinatario está inactivo en SynerLink');
  const recipientEmail = String(user.email ?? '').trim().toLowerCase();

  // 3. Access to THIS agent (same rule as lib/chat/access.ts), inside the key's company scope.
  const grants = await tx.$queryRaw<{ id_company: number }[]>(Prisma.sql`
    SELECT DISTINCT cu.id_company
    FROM subprocess_user_company suc
    INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
    INNER JOIN agent_company ac ON ac.id_company = cu.id_company AND ac.id_agent = ${idAgent}
    WHERE cu.id_user = ${user.id} AND suc.id_subprocess = ${agent.id_subprocess}
  `);
  let companies = grants.map((g) => Number(g.id_company));
  if (!scope.allCompanies) {
    const allowed = new Set(scope.companyIds);
    companies = companies.filter((c) => allowed.has(c));
  }
  const module = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT COUNT(1) AS n
    FROM subprocess_user_company suc
    INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
    INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
    WHERE cu.id_user = ${user.id} AND s.subprocess_url = ${CHAT_MODULE_URL}
  `);
  if (companies.length === 0 || Number(module[0]?.n ?? 0) === 0) {
    throw new AgentMessageRejection(
      `el destinatario no tiene asignado el agente ${agent.display_name} en una empresa habilitada para esta llave; no se envió nada`
    );
  }

  // 4. Serialize per agent so the limits hold under concurrent calls.
  await tx.$executeRaw(Prisma.sql`
    DECLARE @r int;
    EXEC @r = sp_getapplock @Resource = ${`kronos-agent-message:${idAgent}`}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
    IF @r < 0 THROW 50011, 'ocupado', 1;
  `);

  // 5. Limits (rolling 24 h, database clock).
  const counts = await tx.$queryRaw<{ por_agente: number; por_destinatario: number }[]>(Prisma.sql`
    SELECT
      COUNT(1) AS por_agente,
      SUM(CASE WHEN m.id_user = ${user.id} THEN 1 ELSE 0 END) AS por_destinatario
    FROM chat_agent_initiated_message m
    WHERE m.id_agent = ${idAgent} AND m.created_at > DATEADD(HOUR, ${-WINDOW_HOURS}, SYSUTCDATETIME())
  `);
  const usedAgent = Number(counts[0]?.por_agente ?? 0);
  const usedRecipient = Number(counts[0]?.por_destinatario ?? 0);
  if (usedAgent >= limits.perAgent) {
    throw new AgentMessageRejection(
      `el agente ${agent.display_name} ya envió ${usedAgent} mensajes por iniciativa propia en las últimas 24 horas (tope ${limits.perAgent})`
    );
  }
  if (usedRecipient >= limits.perRecipient) {
    throw new AgentMessageRejection(
      `ya se le enviaron ${usedRecipient} mensajes por iniciativa propia a este destinatario en las últimas 24 horas (tope ${limits.perRecipient})`
    );
  }

  // 6. The recipient's open direct conversation with this agent, or a new one.
  const now = new Date();
  const existing = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT TOP 1 c.id
    FROM chat_conversation c
    WHERE c.kind = ${'direct'} AND c.id_user = ${user.id} AND c.id_agent = ${idAgent} AND c.archived = 0
    ORDER BY c.id DESC
  `);
  let idConversation = existing[0] ? Number(existing[0].id) : 0;
  const created = !idConversation;
  if (created) {
    const inserted = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
      INSERT INTO chat_conversation (id_user, id_agent, title, kind, created_at, updated_at, archived)
      OUTPUT INSERTED.id
      VALUES (${user.id}, ${idAgent}, ${agent.display_name}, ${'direct'}, ${now}, ${now}, 0)
    `);
    idConversation = Number(inserted[0]?.id ?? 0);
    if (!idConversation) throw new Error('no se pudo crear la conversación');
  }

  // 7. The agent message (unread for the person: read_at NULL).
  const msg = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    INSERT INTO chat_message (id_conversation, role, body, created_at, id_agent_author, delivered_at)
    OUTPUT INSERTED.id
    VALUES (${idConversation}, ${'agent'}, ${body}, ${now}, ${idAgent}, ${now})
  `);
  const idMessage = Number(msg[0]?.id ?? 0);
  if (!idMessage) throw new Error('no se pudo publicar el mensaje');
  await tx.$executeRaw(Prisma.sql`
    UPDATE chat_conversation SET last_message_at = ${now}, updated_at = ${now} WHERE id = ${idConversation}
  `);

  // 8. Audit + marker row.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO chat_agent_initiated_message (id_message, id_conversation, id_agent, id_user, reason, requested_by, conversation_created, created_at)
    VALUES (${idMessage}, ${idConversation}, ${idAgent}, ${user.id}, ${reason}, ${`key:${scope.agent}`.slice(0, 120)}, ${created ? 1 : 0}, ${now})
  `);

  return {
    status: 'enviado',
    id_mensaje: idMessage,
    id_conversacion: idConversation,
    conversacion_creada: created,
    destinatario: { nombre: user.name ?? null, email: recipientEmail },
    limites: {
      usados_hoy_agente: usedAgent + 1,
      tope_agente: limits.perAgent,
      usados_hoy_destinatario: usedRecipient + 1,
      tope_destinatario: limits.perRecipient,
    },
  };
}

export interface NotifyConfig {
  url: string;
  secret: string;
}

/** App endpoint + shared secret for the push. Missing or weak config = no push (the message stays). */
export function loadNotifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig | null {
  const base = (env.CHAT_MCP_APP_URL ?? '').trim().replace(/\/+$/, '');
  const secret = (env.CHAT_MCP_NOTIFY_SECRET ?? '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(base) || secret.length < 32) return null;
  return { url: `${base}/api/chat/agent/initiated-notify`, secret };
}

export type PushOutcome = 'enviado' | 'sin_configurar' | 'fallo';

export async function requestPush(
  idMessage: number,
  cfg: NotifyConfig | null = loadNotifyConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<PushOutcome> {
  if (!cfg) return 'sin_configurar';
  try {
    const resp = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chat-mcp-secret': cfg.secret },
      body: JSON.stringify({ idMessage }),
      signal: AbortSignal.timeout(10_000),
    });
    return resp.ok ? 'enviado' : 'fallo';
  } catch {
    return 'fallo';
  }
}

interface Ctx {
  scope: AuthScope;
  audit: AuditLogger;
}

export function registerAgentMessageTool(server: McpServer, ctx: Ctx): void {
  if (!agentMessageEnabled(ctx.scope)) return;
  server.tool(
    AGENT_MESSAGE_TOOL,
    'ESCRITURA acotada. Le envía un mensaje SUYO (como este asistente) a una persona en su chat de SynerLink con usted, por iniciativa propia: por ejemplo, para avisarle que ya quedó listo un acceso o un trámite que pidió. El mensaje queda en la conversación directa de esa persona con usted (si no existe, se crea), le llega la notificación y se marca como Mensaje iniciado por el asistente. Solo funciona si la persona está activa y tiene asignado este asistente en una empresa de su alcance. Úselo solo cuando haya un motivo concreto; tiene tope diario por asistente y por persona, y cada envío queda auditado con el motivo. No lo use para responder en la conversación que está atendiendo (para eso está su respuesta normal).',
    {
      destinatario: z.string().trim().min(3).max(255).describe('Correo de la persona en SynerLink (preferido) o su id de usuario.'),
      texto: z.string().min(1).max(MAX_BODY_CHARS).describe(`Mensaje en Markdown, escrito para la persona (máximo ${MAX_BODY_CHARS} caracteres). Sin HTML.`),
      motivo: z.string().min(5).max(MAX_REASON_CHARS).describe('Motivo breve del envío, para la auditoría (p. ej. Avisar que ya tiene acceso a SAP, pedido por Nicolás Rivera).'),
    },
    async (args) => {
      const base = {
        ts: new Date().toISOString(),
        agent: ctx.scope.agent,
        role: ctx.scope.role,
        companyIds: ctx.scope.companyIds,
        tool: AGENT_MESSAGE_TOOL,
        // The body is not written to the file log: it lives in the chat and the audit table.
        params: { destinatario: args.destinatario, motivo: args.motivo, caracteres: args.texto.length },
      };
      try {
        const limits = loadAgentMessageLimits();
        const result = await executeWrite((tx) => sendAgentInitiatedMessage(tx, ctx.scope, args, limits));
        const push = await requestPush(result.id_mensaje);
        await ctx.audit.log({ ...base, outcome: 'ok', rows: 1 });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ...result,
                  notificacion_push: push,
                  siguiente_paso: `Mensaje #${result.id_mensaje} publicado en el chat de ${result.destinatario.nombre ?? result.destinatario.email} con usted. Cuando la persona responda, su respuesta le llegará en esa conversación con este mensaje como contexto.`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const rejected = err instanceof AgentMessageRejection;
        await ctx.audit.log({ ...base, outcome: rejected ? 'denied' : 'error', error: (err as Error).message });
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: rejected ? `Rechazado: ${(err as Error).message}` : `Error: no se pudo enviar el mensaje (${(err as Error).message})`,
            },
          ],
        };
      }
    }
  );
}
