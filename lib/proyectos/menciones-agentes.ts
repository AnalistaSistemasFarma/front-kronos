/**
 * MENCIONES ENTRE ASISTENTES en un hilo de proyecto — reglas PURAS (sin base).
 *
 * Pedido de Nicolás Rivera (2026-11-12, 12:35 COT): «las menciones @agente
 * solo despiertan al otro asistente si las escribe una persona; las que
 * escribe un asistente no se entregan… tenemos que corregir esto ya».
 *
 * Desde el multiagente (PR #806) solo una PERSONA despertaba a otro agente en
 * un hilo de proyecto, para no abrir bucles de consumo. Ahora un asistente
 * también puede mencionar con @ a otro asistente del proyecto, con FRENOS:
 *
 *   1. A QUIÉN: solo a otro asistente designado en el proyecto al que la
 *      PERSONA que escribió por última vez en el hilo le podría escribir (la
 *      misma regla de una mención de persona). Nunca a sí mismo, nunca a un
 *      asistente de fuera del proyecto, y nunca si en el hilo no ha escrito
 *      ninguna persona. Así un asistente no despierta a nadie que la persona
 *      no pudiera despertar.
 *   2. PROFUNDIDAD: como mucho MAX_SALTOS_AGENTE saltos asistente→asistente
 *      seguidos sin que escriba una persona. Cuando una persona escribe, la
 *      cuenta vuelve a cero. Un «salto» es un mensaje de asistente que SÍ
 *      despertó a otro (tiene filas de entrega): los mensajes intermedios de
 *      un mismo turno no cuentan.
 *   3. RITMO: como mucho MAX_SALTOS_POR_HORA saltos asistente→asistente por
 *      hilo en la última hora (aunque una persona escriba en medio).
 *   4. IDA Y VUELTA: si dos asistentes se mencionan entre sí más de
 *      MAX_IDA_Y_VUELTA veces seguidas (A→B, B→A, A→B…), se corta.
 *   5. COMANDOS: un mensaje de asistente que empieza por «/» no se entrega (el
 *      puente lo trataría como comando, p. ej. /clear, en la sesión del otro).
 *   6. MESAS: sin cambio. En una mesa de discusión los turnos los reparte el
 *      motor y no se invoca a nadie con @.
 *
 * Cuando un freno corta, se publica en el hilo un aviso de sistema (una sola
 * vez seguida) y al asistente se le devuelve `chainStopped: true`.
 */
import { resolverAgentesMencionados, type AgenteMencionable } from '../chat/groups';

/** Saltos asistente→asistente seguidos, sin que escriba una persona. */
export const MAX_SALTOS_AGENTE = 3;
/** Saltos asistente→asistente por hilo en la ventana de ritmo. */
export const MAX_SALTOS_POR_HORA = 10;
/** Ventana del freno de ritmo. */
export const VENTANA_RITMO_MS = 60 * 60 * 1000;
/** Saltos seguidos entre el MISMO par de asistentes (A→B, B→A, …). */
export const MAX_IDA_Y_VUELTA = 2;
/** Cuántos mensajes recientes del hilo se miran para contar saltos. */
export const MENSAJES_PARA_CONTEO = 60;

/** Aviso de sistema cuando un freno corta la conversación entre asistentes. */
export const AVISO_BUCLE_ASISTENTES =
  'Se pausó la conversación entre asistentes para evitar un bucle; escriba en el hilo para continuar.';

export type FrenoMenciones = 'profundidad' | 'ritmo' | 'ida-y-vuelta';

/** Un mensaje de asistente que despertó a otros. */
export interface Salto {
  autor: number;
  destinos: number[];
}

/** Lo mínimo de un mensaje del hilo para contar saltos (en orden ASCENDENTE). */
export interface MensajeHilo {
  role: string;
  id_agent_author: number | null;
  id_user_author: string | null;
  deliveries: { id_agent: number }[];
}

/**
 * Saltos asistente→asistente desde el último mensaje de una PERSONA (orden
 * ascendente), y quién fue esa persona (null si no aparece en lo leído).
 */
export function saltosDesdeUltimaPersona(mensajes: MensajeHilo[]): { saltos: Salto[]; idUserOrigen: string | null } {
  const saltos: Salto[] = [];
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const m = mensajes[i];
    if (m.role === 'user') return { saltos: saltos.reverse(), idUserOrigen: m.id_user_author };
    if (m.role === 'agent' && m.id_agent_author !== null && m.deliveries.length > 0) {
      saltos.push({ autor: m.id_agent_author, destinos: m.deliveries.map((d) => d.id_agent) });
    }
  }
  return { saltos: saltos.reverse(), idUserOrigen: null };
}

/** Cuántos saltos seguidos, al final, rebotan entre el mismo par (incluido el nuevo). */
export function idaYVueltaSeguidas(saltos: Salto[], nuevo: Salto): number {
  const todos = [...saltos, nuevo];
  let n = 1;
  for (let i = todos.length - 1; i > 0; i -= 1) {
    const actual = todos[i];
    const previo = todos[i - 1];
    const rebota = previo.destinos.includes(actual.autor) && actual.destinos.includes(previo.autor);
    if (!rebota) break;
    n += 1;
  }
  return n;
}

/**
 * A quién despierta un mensaje de ASISTENTE en un hilo de proyecto.
 *
 * `candidatos`: asistentes elegibles del proyecto (ya filtrados por la regla
 * de la persona de origen); el autor se descarta aquí de todos modos.
 */
export function entregasDeAgenteEnHilo(opciones: {
  body: string;
  idAgentAutor: number;
  candidatos: AgenteMencionable[];
  esMesa: boolean;
  saltosDesdePersona: Salto[];
  saltosUltimaHora: number;
}): { idAgents: number[]; freno: FrenoMenciones | null } {
  const { body, idAgentAutor, candidatos, esMesa, saltosDesdePersona, saltosUltimaHora } = opciones;
  const nada = { idAgents: [] as number[], freno: null };
  if (esMesa || !body.includes('@') || body.trimStart().startsWith('/')) return nada;

  const destinos = resolverAgentesMencionados(
    body,
    candidatos.filter((c) => c.idAgent !== idAgentAutor)
  ).map((a) => a.idAgent);
  if (destinos.length === 0) return nada;

  if (saltosDesdePersona.length >= MAX_SALTOS_AGENTE) return { idAgents: [], freno: 'profundidad' };
  if (saltosUltimaHora >= MAX_SALTOS_POR_HORA) return { idAgents: [], freno: 'ritmo' };
  if (idaYVueltaSeguidas(saltosDesdePersona, { autor: idAgentAutor, destinos }) > MAX_IDA_Y_VUELTA) {
    return { idAgents: [], freno: 'ida-y-vuelta' };
  }
  return { idAgents: destinos, freno: null };
}
