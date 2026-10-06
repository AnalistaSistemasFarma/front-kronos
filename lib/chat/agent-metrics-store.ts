import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { canConfigureAgents } from './audit-access';
import type { AgentMetricsDto, MetricsInput, SubagenteMetricaDto } from './agent-metrics';

/**
 * Lectura/escritura de dbo.chat_agent_metrics (prisma/manual/2026-10-06-chat-agent-metrics.sql)
 * y la regla de QUIÉN ve las métricas.
 *
 * Sin modelo Prisma, a propósito (mismo patrón que el Monitor del sistema, #512): así el pase
 * no cambia schema.prisma ni exige `prisma generate`, y si la tabla todavía no existe el chat
 * sigue funcionando — la lectura devuelve null y la escritura responde 503 — en vez de tumbar
 * el sondeo que alimenta el indicador de "trabajando".
 */

/* ───────────────────────── Visibilidad (UN solo lugar) ───────────────────────── */

/**
 * QUIÉN VE LAS MÉTRICAS EN EL CHAT. Decisión pendiente de Nicolás (2026-10-06): por ahora
 * solo administradores. Se cambia aquí o, sin desplegar, con la variable de entorno
 * CHAT_AGENT_METRICS_VISIBILITY:
 *   - 'admins' (por defecto): quien tenga el permiso de configurar agentes (canConfigureAgents).
 *   - 'todos': cualquiera que ya tenga acceso a la conversación con el agente.
 *   - 'nadie': apagado (el endpoint del agente sigue guardando).
 */
export type MetricsVisibility = 'admins' | 'todos' | 'nadie';
export const METRICS_VISIBILITY_DEFAULT: MetricsVisibility = 'admins';

export function metricsVisibility(): MetricsVisibility {
  const v = (process.env.CHAT_AGENT_METRICS_VISIBILITY ?? '').trim().toLowerCase();
  return v === 'todos' || v === 'nadie' || v === 'admins' ? v : METRICS_VISIBILITY_DEFAULT;
}

/** canConfigureAgents son 2–3 consultas: en el sondeo (cada 1 s) se recuerda un minuto. */
const PERMISO_TTL_MS = 60_000;
const permisoCache = new Map<string, { puede: boolean; hasta: number }>();

export async function canViewAgentMetrics(userEmail: string, ahora = Date.now()): Promise<boolean> {
  const modo = metricsVisibility();
  if (modo === 'nadie') return false;
  if (modo === 'todos') return true;
  const clave = userEmail.trim().toLowerCase();
  if (!clave) return false;
  const enCache = permisoCache.get(clave);
  if (enCache && enCache.hasta > ahora) return enCache.puede;
  const puede = await canConfigureAgents(userEmail);
  if (permisoCache.size > 2_000) permisoCache.clear();
  permisoCache.set(clave, { puede, hasta: ahora + PERMISO_TTL_MS });
  return puede;
}

/* ───────────────────────────── Tabla ausente ───────────────────────────── */

/** Error 208 de SQL Server: el objeto no existe (la tabla aún no se creó). */
export function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { number?: number }).number === 208;
}

/** Si falta la tabla, no se vuelve a preguntar durante un minuto (ni se llena el log). */
let tablaAusenteHasta = 0;

/* ───────────────────────────── Escritura ───────────────────────────── */

/** Upsert de la foto actual por (conversación, agente). No es un histórico. */
export async function upsertAgentMetrics(
  idConversation: number,
  idAgent: number,
  m: MetricsInput
): Promise<Date> {
  const ahora = new Date();
  await withMssqlPool((pool) =>
    pool
      .request()
      .input('id_conversation', sql.Int, idConversation)
      .input('id_agent', sql.Int, idAgent)
      .input('session_id', sql.NVarChar(120), m.sessionId)
      .input('model', sql.NVarChar(120), m.model)
      .input('state', sql.NVarChar(16), m.state)
      .input('tool_label', sql.NVarChar(120), m.toolLabel)
      .input('context_tokens', sql.Int, m.context.tokens)
      .input('context_window', sql.Int, m.context.window)
      .input('context_pct', sql.Decimal(5, 2), m.context.percent)
      .input('turn_input', sql.BigInt, m.turn.input)
      .input('turn_output', sql.BigInt, m.turn.output)
      .input('turn_cache_read', sql.BigInt, m.turn.cacheRead)
      .input('turn_cache_creation', sql.BigInt, m.turn.cacheCreation)
      .input('session_input', sql.BigInt, m.session.input)
      .input('session_output', sql.BigInt, m.session.output)
      .input('session_cache_read', sql.BigInt, m.session.cacheRead)
      .input('session_cache_creation', sql.BigInt, m.session.cacheCreation)
      .input('subagent_input', sql.BigInt, m.subagentTokens.input)
      .input('subagent_output', sql.BigInt, m.subagentTokens.output)
      .input('cost_usd', sql.Decimal(12, 4), m.costUsd)
      .input('subagent_count', sql.Int, m.subagentCount)
      .input('subagents_json', sql.NVarChar(sql.MAX), m.subagents.length ? JSON.stringify(m.subagents) : null)
      .input('reported_at', sql.DateTime2(0), m.reportedAt ? new Date(m.reportedAt) : null)
      .input('updated_at', sql.DateTime2(0), ahora).query(`
        UPDATE dbo.chat_agent_metrics WITH (UPDLOCK, SERIALIZABLE) SET
          session_id = @session_id, model = @model, state = @state, tool_label = @tool_label,
          context_tokens = @context_tokens, context_window = @context_window, context_pct = @context_pct,
          turn_input = @turn_input, turn_output = @turn_output,
          turn_cache_read = @turn_cache_read, turn_cache_creation = @turn_cache_creation,
          session_input = @session_input, session_output = @session_output,
          session_cache_read = @session_cache_read, session_cache_creation = @session_cache_creation,
          subagent_input = @subagent_input, subagent_output = @subagent_output,
          cost_usd = @cost_usd, subagent_count = @subagent_count, subagents_json = @subagents_json,
          reported_at = @reported_at, updated_at = @updated_at
        WHERE id_conversation = @id_conversation AND id_agent = @id_agent;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.chat_agent_metrics (
            id_conversation, id_agent, session_id, model, state, tool_label,
            context_tokens, context_window, context_pct,
            turn_input, turn_output, turn_cache_read, turn_cache_creation,
            session_input, session_output, session_cache_read, session_cache_creation,
            subagent_input, subagent_output, cost_usd, subagent_count, subagents_json,
            reported_at, updated_at
          ) VALUES (
            @id_conversation, @id_agent, @session_id, @model, @state, @tool_label,
            @context_tokens, @context_window, @context_pct,
            @turn_input, @turn_output, @turn_cache_read, @turn_cache_creation,
            @session_input, @session_output, @session_cache_read, @session_cache_creation,
            @subagent_input, @subagent_output, @cost_usd, @subagent_count, @subagents_json,
            @reported_at, @updated_at
          );
      `)
  );
  tablaAusenteHasta = 0;
  return ahora;
}

/* ───────────────────────────── Lectura ───────────────────────────── */

type Fila = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function numONulo(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function iso(v: unknown): string | null {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
}

function filaADto(f: Fila): AgentMetricsDto {
  let subagents: SubagenteMetricaDto[] = [];
  if (typeof f.subagents_json === 'string' && f.subagents_json) {
    try {
      const p = JSON.parse(f.subagents_json);
      if (Array.isArray(p)) subagents = p;
    } catch {
      subagents = [];
    }
  }
  return {
    sessionId: (f.session_id as string | null) ?? null,
    model: (f.model as string | null) ?? null,
    state: (f.state as string | null) ?? null,
    toolLabel: (f.tool_label as string | null) ?? null,
    context: {
      tokens: numONulo(f.context_tokens),
      window: numONulo(f.context_window),
      percent: numONulo(f.context_pct),
    },
    turn: {
      input: num(f.turn_input),
      output: num(f.turn_output),
      cacheRead: num(f.turn_cache_read),
      cacheCreation: num(f.turn_cache_creation),
    },
    session: {
      input: num(f.session_input),
      output: num(f.session_output),
      cacheRead: num(f.session_cache_read),
      cacheCreation: num(f.session_cache_creation),
    },
    subagentTokens: { input: num(f.subagent_input), output: num(f.subagent_output) },
    costUsd: numONulo(f.cost_usd),
    subagents,
    subagentCount: num(f.subagent_count),
    reportedAt: iso(f.reported_at),
    updatedAt: iso(f.updated_at) ?? new Date(0).toISOString(),
  };
}

/**
 * Última foto de métricas del agente en una conversación, o null.
 * NUNCA lanza: la llama el sondeo del chat y un fallo aquí no puede apagar el
 * indicador de "trabajando". Cualquier error se registra y devuelve null.
 */
export async function readAgentMetrics(idConversation: number, idAgent: number): Promise<AgentMetricsDto | null> {
  if (Date.now() < tablaAusenteHasta) return null;
  try {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input('id_conversation', sql.Int, idConversation)
        .input('id_agent', sql.Int, idAgent)
        .query(
          'SELECT TOP 1 * FROM dbo.chat_agent_metrics WHERE id_conversation = @id_conversation AND id_agent = @id_agent'
        )
    );
    const fila = r.recordset?.[0] as Fila | undefined;
    return fila ? filaADto(fila) : null;
  } catch (error) {
    if (isMissingTableError(error)) {
      tablaAusenteHasta = Date.now() + 60_000;
      return null;
    }
    console.error('[chat/agent-metrics] no se pudieron leer las métricas:', error);
    return null;
  }
}

/**
 * Métricas para el usuario de la sesión, ya filtradas por visibilidad. Solo
 * hilos directos por ahora (F1). undefined = el usuario no las puede ver (el
 * campo no se manda); null = puede verlas pero no hay ninguna.
 */
export async function agentMetricsForViewer(
  userEmail: string,
  guard: { kind: string; conversationId: number; idAgent?: number }
): Promise<AgentMetricsDto | null | undefined> {
  if (guard.kind !== 'direct' || !guard.idAgent) return undefined;
  try {
    if (!(await canViewAgentMetrics(userEmail))) return undefined;
  } catch (error) {
    console.error('[chat/agent-metrics] no se pudo resolver el permiso:', error);
    return undefined;
  }
  return readAgentMetrics(guard.conversationId, guard.idAgent);
}
