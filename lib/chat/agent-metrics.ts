/**
 * MÉTRICAS EN VIVO DEL AGENTE (mod "synerlink-metrics", fase F1) — parte PURA.
 *
 * El mod de Claude Code que corre junto a cada bot publica, cada pocos
 * segundos y solo si algo cambió, cuánto contexto lleva ocupado, los tokens
 * del último turno y de la sesión, el modelo y los sub-agentes en curso
 * (POST /api/chat/agent/metrics). El chat lo pinta como una barra encima del
 * hilo. Este archivo valida y normaliza ese payload, y define las reglas de
 * presentación que comparten servidor y cliente (umbral de "sin datos",
 * colores de la barra). No toca la base: eso está en agent-metrics-store.ts.
 *
 * Es un dato DECLARADO por el agente (igual que /api/chat/agent/usage): la
 * llave garantiza quién lo reporta y la conversación se verifica contra las
 * suyas; no es una medición independiente.
 */

/** Pasado este tiempo sin reporte, la barra dice "sin datos recientes". */
export const METRICAS_RANCIAS_MS = 5 * 60_000;

/** Tope del cuerpo del POST. Un payload real ronda 1–2 KB. */
export const MAX_METRICS_BODY_BYTES = 16 * 1024;

/** Sub-agentes que se guardan por reporte; el resto se cuenta pero no se lista. */
export const MAX_SUBAGENTES = 20;

const MAX_TOKENS = 1_000_000_000_000; // cabe en BIGINT y ataja un dato absurdo
const MAX_VENTANA = 100_000_000;
const MAX_COSTO_USD = 1_000_000;

export interface TokensDto {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface SubagenteMetricaDto {
  id: string;
  type: string | null;
  description: string | null;
  status: string | null;
}

/** Lo que se guarda y lo que ve el chat. Mismo nombre de campos en los dos lados. */
export interface AgentMetricsDto {
  sessionId: string | null;
  model: string | null;
  state: string | null;
  toolLabel: string | null;
  context: { tokens: number | null; window: number | null; percent: number | null };
  turn: TokensDto;
  session: TokensDto;
  subagentTokens: { input: number; output: number };
  costUsd: number | null;
  subagents: SubagenteMetricaDto[];
  /** Cuántos sub-agentes reportó el agente (puede ser > subagents.length). */
  subagentCount: number;
  /** Marca del agente (`at` del payload), o null si no vino o no era válida. */
  reportedAt: string | null;
  /** Marca del servidor al guardar: la que decide si el dato está rancio. */
  updatedAt: string;
}

export type MetricsInput = Omit<AgentMetricsDto, 'updatedAt'>;

function texto(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, max);
  return t || null;
}

function entero(raw: unknown, max = MAX_TOKENS): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), max);
}

function enteroONulo(raw: unknown, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.trunc(n), max);
}

function tokens(raw: unknown): TokensDto {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    input: entero(t.input ?? t.input_tokens),
    output: entero(t.output ?? t.output_tokens),
    cacheRead: entero(t.cacheRead ?? t.cache_read_input_tokens),
    cacheCreation: entero(t.cacheCreation ?? t.cache_creation_input_tokens),
  };
}

function fechaIso(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = new Date(typeof raw === 'number' ? raw : String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Normaliza el payload del mod. Nunca lanza: un campo raro se vuelve null o 0.
 * Devuelve `{ error }` solo cuando falta lo indispensable (la conversación).
 */
export function normalizeMetricsPayload(
  payload: Record<string, unknown>
): { idConversation: number; metrics: MetricsInput } | { error: string } {
  const idConversation = Number(payload.idConversation ?? payload.conversationId);
  if (!Number.isInteger(idConversation) || idConversation <= 0) {
    return { error: 'Falta idConversation (entero positivo).' };
  }

  const ctx = (payload.context && typeof payload.context === 'object' ? payload.context : {}) as Record<
    string,
    unknown
  >;
  const tokensCtx = enteroONulo(ctx.tokens, MAX_VENTANA);
  const ventana = enteroONulo(ctx.window, MAX_VENTANA);
  let porcentaje: number | null = null;
  const pctCrudo = Number(ctx.percent);
  if (ctx.percent !== undefined && ctx.percent !== null && Number.isFinite(pctCrudo)) {
    porcentaje = Math.max(0, Math.min(100, Math.round(pctCrudo * 100) / 100));
  } else if (tokensCtx !== null && ventana) {
    // Tras /compact o /clear el mod puede mandar tokens sin porcentaje.
    porcentaje = Math.min(100, Math.round((tokensCtx / ventana) * 10_000) / 100);
  }

  const sub = (payload.subagentTokens && typeof payload.subagentTokens === 'object'
    ? payload.subagentTokens
    : {}) as Record<string, unknown>;

  const crudos = Array.isArray(payload.subagents) ? payload.subagents : [];
  const subagents: SubagenteMetricaDto[] = crudos
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .slice(0, MAX_SUBAGENTES)
    .map((s, i) => ({
      id: texto(s.id, 80) ?? `sub-${i + 1}`,
      type: texto(s.type, 80),
      description: texto(s.description, 200),
      status: texto(s.status, 20),
    }));

  const herramienta = (payload.tool && typeof payload.tool === 'object' ? payload.tool : null) as Record<
    string,
    unknown
  > | null;

  const costoCrudo = Number(payload.costUsd);
  const costUsd =
    payload.costUsd !== undefined && payload.costUsd !== null && Number.isFinite(costoCrudo) && costoCrudo >= 0
      ? Math.min(Math.round(costoCrudo * 10_000) / 10_000, MAX_COSTO_USD)
      : null;

  const estado = texto(payload.state, 16);

  return {
    idConversation,
    metrics: {
      sessionId: texto(payload.sessionId, 120),
      model: texto(payload.model, 120),
      state: estado === 'idle' || estado === 'thinking' || estado === 'tool' ? estado : null,
      toolLabel: herramienta ? texto(herramienta.label ?? herramienta.name, 120) : null,
      context: { tokens: tokensCtx, window: ventana, percent: porcentaje },
      turn: tokens(payload.turn),
      session: tokens(payload.session),
      subagentTokens: { input: entero(sub.input), output: entero(sub.output) },
      costUsd,
      subagents,
      subagentCount: crudos.length,
      reportedAt: fechaIso(payload.at),
    },
  };
}

/** ¿El último reporte es demasiado viejo para mostrarlo como vivo? */
export function metricasRancias(m: Pick<AgentMetricsDto, 'updatedAt'> | null | undefined, ahora = Date.now()): boolean {
  if (!m) return true;
  const marca = Date.parse(m.updatedAt);
  if (Number.isNaN(marca)) return true;
  return ahora - marca > METRICAS_RANCIAS_MS;
}

/** Color de la barra de contexto: verde < 60 %, ámbar 60–85 %, rojo > 85 %. */
export function colorContexto(percent: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 'gray';
  if (percent > 85) return 'red';
  if (percent >= 60) return 'yellow';
  return 'green';
}

/** Total "de entrada" de un bloque de tokens (lo nuevo + lo leído/escrito de caché). */
export function totalEntrada(t: TokensDto): number {
  return t.input + t.cacheRead + t.cacheCreation;
}
