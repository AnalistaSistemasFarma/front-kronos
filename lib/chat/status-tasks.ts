/**
 * Sub-agentes en curso del indicador del chat de agentes.
 *
 * Pedido de Nicolás (2026-09-07): que cuando el agente tenga sub-agentes
 * trabajando, el chat los muestre "como si fuera una tablita, como lo hace
 * claude". La columna `label` de chat_agent_status es NVarChar(200) y ahí no
 * cabe una tabla, así que el desglose viaja aparte, como JSON, en la columna
 * `tasks`.
 *
 * Este módulo es la ÚNICA puerta de entrada y salida de ese JSON:
 *
 *   normalizeAgentTasks() — valida lo que MANDA el agente (entrada no
 *                           confiable: llega por la API con su llave).
 *   parseAgentTasks()     — lee lo que hay GUARDADO (defensivo: la columna es
 *                           texto libre y una fila vieja o corrupta no puede
 *                           tumbar el chat).
 *
 * Las dos devuelven siempre una forma segura; ninguna lanza.
 */

import { MAX_STATUS_TASKS, MAX_TASK_DESC_CHARS } from './constants';

export interface AgentTaskDto {
  /** Qué está haciendo ese sub-agente. Texto plano, nunca HTML. */
  desc: string;
  /** ISO 8601, o null si el agente no lo informó. */
  startedAt: string | null;
}

/** ISO válido a partir de un ISO, de milisegundos epoch o de segundos epoch. */
function toIso(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // El hook de bash lleva la hora en SEGUNDOS epoch (date +%s), y el resto
    // del código en milisegundos. Se distinguen por magnitud: cualquier fecha
    // razonable en segundos es menor a 1e11, y en milisegundos es mayor.
    const ms = raw < 1e11 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

/**
 * Valida la lista que manda el agente.
 *
 * Devuelve `null` cuando no hay nada que guardar (ni lista, o lista vacía),
 * para que la columna quede en NULL en vez de con un "[]" inútil.
 * Devuelve `undefined` cuando lo recibido NO es una lista: eso es un error del
 * llamador y la ruta debe responder 400, no guardar a medias.
 */
export function normalizeAgentTasks(raw: unknown): AgentTaskDto[] | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return undefined;

  const out: AgentTaskDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const src = item as Record<string, unknown>;
    const desc = typeof src.desc === 'string' ? src.desc.trim().slice(0, MAX_TASK_DESC_CHARS) : '';
    if (!desc) continue;
    out.push({ desc, startedAt: toIso(src.startedAt) });
    // Se corta en el tope en vez de rechazar: el indicador es cortesía, y con
    // ocho filas ya se entiende que hay trabajo en paralelo.
    if (out.length >= MAX_STATUS_TASKS) break;
  }

  return out.length > 0 ? out : null;
}

/** Lee la columna guardada. Ante cualquier duda, lista vacía. */
export function parseAgentTasks(raw: string | null | undefined): AgentTaskDto[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeAgentTasks(parsed) ?? [];
  } catch {
    return [];
  }
}
