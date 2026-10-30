/**
 * CONTEXTO DE LA SESIÓN DEL AGENTE Y ORDEN «LIMPIAR CONTEXTO» — parte PURA (2026-10-29).
 *
 * Pedido de Nicolás Rivera (2026-10-29): en el widget de consumo de los agentes
 * mostrar cuán lleno está el contexto de la sesión del agente y poder limpiarlo.
 * Decidido: limpiar es SOLO para administradores (permiso «Auditoría de agentes ·
 * Configurar», canConfigureAgents). Regla general: aplica a TODOS los agentes
 * (Claude Code y openclaw), no solo a Orus.
 *
 * QUÉ SESIÓN SE MIDE Y SE LIMPIA
 *   - Bot de Claude Code (Mechita, Zoe, Sawblaze, Rex…): UNA sola sesión viva que
 *     atiende TODAS sus conversaciones de SynerLink (y Telegram/Teams). Se publica
 *     con la clave de sesión 'principal'. Limpiarla = rotar la sesión completa del
 *     bot (rotar-sesion-bot.sh --ahora: traspaso de pendientes + archivo + sesión
 *     nueva), así que afecta a todos sus chats.
 *   - Agente openclaw (Duo, Lisa, los OLP…): una sesión POR conversación
 *     ('agent:<id>:synerlink-<conv>'). Se publica con el id de la conversación y
 *     limpiarla = sessions.reset de ESA sesión; las demás no se tocan.
 *   - Hilos de Proyectos (puente de hilos): cada hilo ya tiene su propia sesión y
 *     su propio «/clear». Quedan fuera de esta entrega; el endpoint ya admite que
 *     el puente publique su contexto por conversación el día que se quiera.
 *
 * Este archivo valida el payload del publicador, define las reglas de color y
 * los estados de la orden. No toca la base: eso está en agent-context-store.ts.
 * Es un dato DECLARADO por el agente (la llave dice quién lo reporta).
 */

/** Clave de la sesión única de un bot de Claude Code. */
export const SESION_PRINCIPAL = 'principal';

/** Pasado este tiempo sin reporte, el widget avisa que la medición está desactualizada. */
export const CONTEXTO_RANCIO_MS = 10 * 60_000;

/** Tope de sesiones por reporte (un Gateway openclaw con muchas conversaciones). */
export const MAX_SESIONES_POR_REPORTE = 200;

/** Tope del cuerpo del POST del publicador. */
export const MAX_CONTEXTO_BODY_BYTES = 64 * 1024;

/** Una orden pendiente que nadie tomó en este tiempo se da por vencida. */
export const ORDEN_PENDIENTE_VENCE_MS = 15 * 60_000;

/** Una orden en curso sin resultado en este tiempo se da por fallida (el traspaso tarda hasta ~8 min). */
export const ORDEN_EN_CURSO_VENCE_MS = 30 * 60_000;

/** Un indicador «trabajando» más viejo que esto no bloquea (un bot caído puede dejarlo pegado). */
export const OCUPADO_VIGENTE_MS = 10 * 60_000;

const MAX_VENTANA = 100_000_000;

export type RuntimeAgente = 'claude-code' | 'openclaw' | 'puente';

export interface SesionContextoInput {
  sessionKey: string;
  runtime: RuntimeAgente;
  idConversation: number | null;
  sessionId: string | null;
  model: string | null;
  tokens: number | null;
  window: number | null;
  percent: number | null;
  measuredAt: Date;
}

/** Lo que ve el widget. */
export interface ContextoAgenteDto {
  sessionKey: string;
  runtime: RuntimeAgente;
  /** 'agente' = sesión única del bot (todas sus conversaciones); 'conversacion' = solo este hilo. */
  alcance: 'agente' | 'conversacion';
  sessionId: string | null;
  model: string | null;
  tokens: number | null;
  window: number | null;
  percent: number | null;
  measuredAt: string;
}

export type EstadoOrden = 'pendiente' | 'en_curso' | 'ok' | 'ocupado' | 'error' | 'vencida';
export const ESTADOS_ORDEN: readonly EstadoOrden[] = ['pendiente', 'en_curso', 'ok', 'ocupado', 'error', 'vencida'];
export const ESTADOS_ACTIVOS: readonly EstadoOrden[] = ['pendiente', 'en_curso'];
export const ESTADOS_FINALES: readonly EstadoOrden[] = ['ok', 'ocupado', 'error'];

export const COMANDO_LIMPIAR = 'limpiar_contexto';

export interface OrdenDto {
  id: number;
  command: string;
  sessionKey: string;
  runtime: RuntimeAgente;
  idConversation: number | null;
  status: EstadoOrden;
  requestedBy: string;
  requestedAt: string;
  takenAt: string | null;
  finishedAt: string | null;
  result: string | null;
}

/* ─────────────────────────── utilidades ─────────────────────────── */

function texto(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, max);
  return t || null;
}

function enteroONulo(raw: unknown, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.trunc(n), max);
}

export function esRuntime(v: unknown): v is RuntimeAgente {
  return v === 'claude-code' || v === 'openclaw' || v === 'puente';
}

export function esEstadoOrden(v: unknown): v is EstadoOrden {
  return typeof v === 'string' && (ESTADOS_ORDEN as readonly string[]).includes(v);
}

/** Clave de sesión: letras, números y : _ . - (sin espacios ni rutas). */
const RE_CLAVE = /^[A-Za-z0-9:_.\-]{1,160}$/;

/**
 * Normaliza UNA sesión del reporte. Devuelve null si falta lo indispensable
 * (clave válida y runtime). El porcentaje se calcula si no viene.
 */
export function normalizarSesion(raw: unknown, ahora = new Date()): SesionContextoInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const sessionKey = texto(s.sessionKey ?? s.clave, 160);
  if (!sessionKey || !RE_CLAVE.test(sessionKey)) return null;
  const runtime = s.runtime;
  if (!esRuntime(runtime)) return null;

  const idCrudo = s.idConversation ?? s.conversationId;
  const idNum = Number(idCrudo);
  const idConversation = idCrudo !== undefined && idCrudo !== null && Number.isInteger(idNum) && idNum > 0 ? idNum : null;
  // La sesión principal de un bot es del agente, no de una conversación.
  if (sessionKey === SESION_PRINCIPAL && idConversation !== null) return null;
  // Una sesión por conversación (openclaw, puente) DEBE decir de qué conversación es.
  if (sessionKey !== SESION_PRINCIPAL && idConversation === null) return null;

  const tokens = enteroONulo(s.tokens, MAX_VENTANA);
  const window = enteroONulo(s.window, MAX_VENTANA) || null;
  let percent: number | null = null;
  const pctCrudo = Number(s.percent);
  if (s.percent !== undefined && s.percent !== null && s.percent !== '' && Number.isFinite(pctCrudo)) {
    percent = Math.max(0, Math.min(100, Math.round(pctCrudo * 100) / 100));
  } else if (tokens !== null && window) {
    percent = Math.min(100, Math.round((tokens / window) * 10_000) / 100);
  }

  let measuredAt = ahora;
  const m = s.measuredAt ?? s.at;
  if (m !== undefined && m !== null && m !== '') {
    const d = new Date(typeof m === 'number' ? m : String(m));
    // Una marca del futuro (reloj adelantado) se recorta a «ahora».
    if (!Number.isNaN(d.getTime())) measuredAt = d.getTime() > ahora.getTime() ? ahora : d;
  }

  return {
    sessionKey,
    runtime,
    idConversation,
    sessionId: texto(s.sessionId, 120),
    model: texto(s.model, 120),
    tokens,
    window,
    percent,
    measuredAt,
  };
}

/**
 * Normaliza el reporte completo: `{ sesiones: [...] }` (o una sola sesión
 * suelta). Las sesiones inválidas se descartan y se cuentan.
 */
export function normalizarReporteContexto(
  payload: unknown,
  ahora = new Date()
): { sesiones: SesionContextoInput[]; descartadas: number } | { error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'El cuerpo debe ser un objeto JSON.' };
  }
  const p = payload as Record<string, unknown>;
  const crudas = Array.isArray(p.sesiones) ? p.sesiones : Array.isArray(p.sessions) ? p.sessions : [p];
  if (crudas.length === 0) return { error: 'No hay sesiones en el reporte.' };
  if (crudas.length > MAX_SESIONES_POR_REPORTE) {
    return { error: `Máximo ${MAX_SESIONES_POR_REPORTE} sesiones por reporte.` };
  }
  const vistas = new Map<string, SesionContextoInput>();
  let descartadas = 0;
  for (const c of crudas) {
    const s = normalizarSesion(c, ahora);
    if (!s) {
      descartadas++;
      continue;
    }
    vistas.set(s.sessionKey, s); // la última gana si viene repetida
  }
  if (vistas.size === 0) return { error: 'Ninguna sesión del reporte es válida.' };
  return { sesiones: [...vistas.values()], descartadas };
}

/* ─────────────────────────── presentación ─────────────────────────── */

/** Color de la barra de contexto: verde < 60 %, ámbar 60–85 %, rojo ≥ 85 %. */
export function colorDeContexto(percent: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 'gray';
  if (percent >= 85) return 'red';
  if (percent >= 60) return 'yellow';
  return 'green';
}

export function contextoRancio(c: Pick<ContextoAgenteDto, 'measuredAt'> | null | undefined, ahora = Date.now()): boolean {
  if (!c) return true;
  const t = Date.parse(c.measuredAt);
  return Number.isNaN(t) || ahora - t > CONTEXTO_RANCIO_MS;
}

/** «84 mil», «1,2 M»: tokens en corto, formato latino. */
export function tokensCortos(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toLocaleString('es-CO')} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000).toLocaleString('es-CO')} mil`;
  return n.toLocaleString('es-CO');
}

/** Texto del estado de una orden, para el widget y la hoja de vida. */
export function textoEstadoOrden(estado: EstadoOrden): string {
  switch (estado) {
    case 'pendiente':
      return 'Pendiente: esperando a que la máquina del agente la tome (hasta 1 min).';
    case 'en_curso':
      return 'En curso: guardando pendientes y abriendo una sesión nueva (puede tardar varios minutos).';
    case 'ok':
      return 'Contexto limpiado.';
    case 'ocupado':
      return 'No se limpió: el agente estaba trabajando. Intente de nuevo en unos minutos.';
    case 'error':
      return 'No se pudo limpiar el contexto.';
    case 'vencida':
      return 'Nadie tomó la orden a tiempo (la máquina del agente no tiene el ejecutor instalado o está apagada).';
  }
}

/**
 * Transición permitida al reportar el ejecutor. 'pendiente' → 'en_curso' (la
 * toma) y 'en_curso' → final. Un reporte final directo desde 'pendiente' se
 * admite para que el ejecutor pueda decir «ocupado» o «error» sin tomarla.
 */
export function transicionValida(actual: EstadoOrden, nuevo: EstadoOrden): boolean {
  if (actual === 'pendiente') return nuevo === 'en_curso' || (ESTADOS_FINALES as readonly string[]).includes(nuevo);
  if (actual === 'en_curso') return (ESTADOS_FINALES as readonly string[]).includes(nuevo);
  return false;
}

/** ¿El indicador de estado del agente dice que está trabajando ahora? */
export function estaTrabajando(
  estados: { state: string | null; updatedAt: Date | string | null }[],
  ahora = Date.now()
): boolean {
  return estados.some((e) => {
    if (!e.state || e.state === 'idle') return false;
    const t = e.updatedAt instanceof Date ? e.updatedAt.getTime() : Date.parse(String(e.updatedAt ?? ''));
    return Number.isFinite(t) && ahora - t <= OCUPADO_VIGENTE_MS;
  });
}
