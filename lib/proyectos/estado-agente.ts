import { describeAgentStatus, subagentesEnCurso, type ChatStatusDto } from '../chat/client';
import type { AgentTaskDto } from '../chat/status-tasks';

/**
 * ESTADO EN VIVO DEL AGENTE en las conversaciones de PROYECTO — pedido de
 * Nicolás Rivera del 2026-10-20: «en el tema de proyectos, cuando un agente
 * está trabajando no hay ningún estado por fuera que diga que está trabajando.
 * Debería aparecer ahí quién está trabajando».
 *
 * Lógica PURA (sin React, sin red, sin base): la usan la lista de
 * conversaciones del proyecto, la lista de proyectos, el panel del icono de la
 * cabecera y el pulso del chat. El estado es el MISMO del chat
 * (chat_agent_status, POST /api/chat/agent/status), que el puente de hilos ya
 * publica al empezar el turno, con cada herramienta y al terminar (en reposo).
 *
 * Cómo llega en vivo: el pulso del chat (/api/chat/pulse, el long-poll que ya
 * existe) entrega también los cambios de estado de las conversaciones de
 * proyecto visibles para la persona, y ChatPulse los reparte con
 * EVENTO_ESTADO_PROYECTOS. No hay sondeo nuevo.
 */

/** Un estado de agente en una conversación de proyecto, tal como viaja al navegador. */
export interface EstadoAgenteProyectoDto {
  idConversation: number;
  idProject: number;
  projectName: string;
  conversationTitle: string;
  agent: { idAgent: number; code: string; displayName: string; avatarUrl: string | null; avatarVersion: number | null };
  /** 'idle' | 'thinking' | 'tool'. */
  state: string;
  label: string | null;
  tasks: AgentTaskDto[];
  updatedAt: string;
}

/** Cuántos estados viajan como máximo en una respuesta (lista, panel o pulso). */
export const MAX_ESTADOS = 50;

/** Lo emite ChatPulse con los estados que cambiaron (detail: { estados }). */
export const EVENTO_ESTADO_PROYECTOS = 'proyectos:estado';

/** El estado en la forma que entiende describeAgentStatus del chat. */
export function comoStatusDelChat(e: Pick<EstadoAgenteProyectoDto, 'state' | 'label' | 'tasks' | 'updatedAt'> | null | undefined): ChatStatusDto | null {
  if (!e) return null;
  return { state: e.state, label: e.label, tasks: e.tasks, updatedAt: e.updatedAt };
}

export interface VistaEstadoAgente {
  /** El agente está trabajando y el estado es fresco (no rancio). */
  trabajando: boolean;
  /** «Orus está trabajando…». Vacío si no trabaja. */
  texto: string;
  /** La actividad que reportó el agente («Consultando SAP…»), si la dio. */
  actividad: string | null;
  /** Subagentes en curso (pueden seguir aunque el principal ya volvió a reposo). */
  subagentes: AgentTaskDto[];
  /** Para el logo animado: 'tool' agarra más rápido que 'thinking'. */
  variante: 'thinking' | 'tool';
}

/**
 * Cómo pintar el estado. Reusa la regla del chat: un «trabajando» que lleva
 * demasiado sin refrescarse (sesión caída) NO se pinta como trabajando.
 */
export function vistaEstadoAgente(
  e: Pick<EstadoAgenteProyectoDto, 'state' | 'label' | 'tasks' | 'updatedAt'> | null | undefined,
  nombreAgente: string
): VistaEstadoAgente {
  const status = comoStatusDelChat(e);
  const view = describeAgentStatus(status);
  const subagentes = subagentesEnCurso(status);
  const trabajando = view.busy || subagentes.length > 0;
  const nombre = nombreAgente.trim() || 'El asistente';
  const actividad = view.busy ? e?.label?.trim() || null : null;
  return {
    trabajando,
    texto: trabajando ? `${nombre} está trabajando…` : '',
    actividad,
    subagentes,
    variante: e?.state === 'tool' ? 'tool' : 'thinking',
  };
}

/** Texto corto de subagentes: «1 subagente en curso» / «3 subagentes en curso». */
export function textoSubagentes(n: number): string {
  if (n <= 0) return '';
  return n === 1 ? '1 subagente en curso' : `${n} subagentes en curso`;
}

/**
 * Resumen de VARIOS estados (tarjeta de un proyecto, icono de la cabecera):
 * «Orus está trabajando…» o «2 asistentes trabajando…», como los grupos del chat.
 */
export function resumenTrabajando(estados: EstadoAgenteProyectoDto[]): { n: number; texto: string; primero: EstadoAgenteProyectoDto | null } {
  const activos = estados.filter((e) => vistaEstadoAgente(e, e.agent.displayName).trabajando);
  if (activos.length === 0) return { n: 0, texto: '', primero: null };
  if (activos.length === 1) return { n: 1, texto: `${activos[0].agent.displayName} está trabajando…`, primero: activos[0] };
  const agentes = new Set(activos.map((e) => e.agent.idAgent));
  const texto = agentes.size === 1 ? `${activos[0].agent.displayName} está trabajando en ${activos.length} conversaciones…` : `${agentes.size} asistentes trabajando…`;
  return { n: activos.length, texto, primero: activos[0] };
}

/**
 * Mezcla estados nuevos con los que ya se tenían, por conversación. Gana el
 * más reciente (`updatedAt`): un evento viejo que llegue tarde no pisa uno
 * nuevo. Devuelve el MISMO mapa si nada cambió (React no vuelve a pintar).
 */
export function mezclarEstados(
  actuales: ReadonlyMap<number, EstadoAgenteProyectoDto>,
  nuevos: readonly EstadoAgenteProyectoDto[]
): ReadonlyMap<number, EstadoAgenteProyectoDto> {
  let salida: Map<number, EstadoAgenteProyectoDto> | null = null;
  for (const n of nuevos) {
    if (!n || !Number.isInteger(n.idConversation)) continue;
    const previo = (salida ?? actuales).get(n.idConversation);
    if (previo) {
      const a = Date.parse(previo.updatedAt);
      const b = Date.parse(n.updatedAt);
      if (!Number.isNaN(a) && !Number.isNaN(b) && b < a) continue;
      if (
        previo.updatedAt === n.updatedAt &&
        previo.state === n.state &&
        previo.label === n.label &&
        JSON.stringify(previo.tasks) === JSON.stringify(n.tasks)
      ) {
        continue;
      }
    }
    if (!salida) salida = new Map(actuales);
    salida.set(n.idConversation, n);
  }
  return salida ?? actuales;
}

/** Mapa inicial a partir de una lista (lo que trae la API al cargar). */
export function mapaDeEstados(lista: readonly EstadoAgenteProyectoDto[] | null | undefined): ReadonlyMap<number, EstadoAgenteProyectoDto> {
  return mezclarEstados(new Map(), lista ?? []);
}

/** Lee el detail del evento del navegador de forma defensiva. */
export function estadosDelEvento(detail: unknown): EstadoAgenteProyectoDto[] {
  const lista = (detail as { estados?: unknown } | null)?.estados;
  if (!Array.isArray(lista)) return [];
  return lista.filter(
    (e): e is EstadoAgenteProyectoDto =>
      !!e &&
      typeof e === 'object' &&
      Number.isInteger((e as EstadoAgenteProyectoDto).idConversation) &&
      Number.isInteger((e as EstadoAgenteProyectoDto).idProject) &&
      typeof (e as EstadoAgenteProyectoDto).state === 'string' &&
      typeof (e as EstadoAgenteProyectoDto).updatedAt === 'string' &&
      !!(e as EstadoAgenteProyectoDto).agent
  );
}

/** Reparte los estados a las pantallas abiertas (lo llama ChatPulse). */
export function avisarEstadoProyectos(estados: EstadoAgenteProyectoDto[]): void {
  if (typeof window === 'undefined' || estados.length === 0) return;
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_ESTADO_PROYECTOS, { detail: { estados } }));
  } catch {
    /* navegador sin CustomEvent: se ve al recargar */
  }
}

/** Cursor del pulso para los estados: ISO válido o null. */
export function cursorDeEstado(raw: string | null | undefined): Date | null {
  if (!raw || raw === '0') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
