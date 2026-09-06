/**
 * Sondeo adaptativo hacia el navegador.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ POLLING Y NO SSE
 * -------------------------------------------------------------------------
 * Producción corre PM2 en modo cluster con `instances: 2` y `cron_restart`
 * diario (ecosystem.config.js). Una conexión SSE vive en UNA instancia y su
 * registro de suscriptores sería estado EN MEMORIA de esa instancia: el
 * navegador quedaría pegado a la instancia A mientras el mensaje del agente
 * entra por la instancia B. En testing (una sola instancia) funcionaría
 * perfecto y en producción fallaría de forma intermitente — el peor tipo de
 * error. El sondeo contra SQL Server se comporta igual con N instancias.
 *
 * Para que el sondeo no sea caro, el servidor le dice al cliente CADA CUÁNTO
 * volver a preguntar: rápido mientras la conversación está viva, lento cuando
 * lleva rato quieta. La consulta de fondo es un seek por el índice
 * (id_conversation, id DESC) preguntando "¿hay algo después del mensaje X?".
 *
 * Función pura y aislada para poder probarla sin base de datos.
 */
import type { AgentState } from './constants';

/** Cadencias en milisegundos. Un solo lugar para afinarlas. */
export const POLL_MS = {
  /** El agente está trabajando, o acaba de llegar algo: queremos verlo en vivo. */
  live: 1_000,
  /** Conversación activa (algo pasó hace menos de un minuto). */
  active: 2_000,
  /** Se enfrió (menos de cinco minutos). */
  warm: 5_000,
  /** Quieta (menos de media hora). */
  idle: 15_000,
  /** Dormida. Tope superior del sondeo. */
  dormant: 30_000,
} as const;

export interface PollCadenceInput {
  /** ¿Esta vuelta trajo mensajes nuevos? */
  hasNewMessages: boolean;
  /** Estado del agente en la conversación, si lo hay. */
  agentState: AgentState | string | null;
  /** Milisegundos desde la última actividad de la conversación. */
  msSinceLastActivity: number;
  /** ¿La pestaña está oculta? El cliente lo informa para bajar la cadencia. */
  hidden?: boolean;
}

/**
 * Cuántos milisegundos debería esperar el cliente antes de volver a preguntar.
 *
 * Con la pestaña oculta se aplica el tope superior sin importar lo demás: si
 * el usuario no está mirando, no hay nada que refrescar en vivo.
 */
export function computeNextPollMs(input: PollCadenceInput): number {
  if (input.hidden) return POLL_MS.dormant;

  if (input.hasNewMessages) return POLL_MS.live;
  if (input.agentState === 'thinking' || input.agentState === 'tool') return POLL_MS.live;

  const since = Number.isFinite(input.msSinceLastActivity)
    ? Math.max(0, input.msSinceLastActivity)
    : Number.POSITIVE_INFINITY;

  if (since < 60_000) return POLL_MS.active;
  if (since < 5 * 60_000) return POLL_MS.warm;
  if (since < 30 * 60_000) return POLL_MS.idle;
  return POLL_MS.dormant;
}
