/**
 * @PERSONA IN A PROJECT CONVERSATION (2026-11-26).
 *
 * Request from Nicolás Rivera (2026-11-26, project 39 «Feature - Proyectos Synerlink»): «para el
 * tema de las conversaciones ahora hay una nueva funcionalidad @personareal para que no lo tomen
 * los agentes, y se puedan comunicar todos dentro del proyecto».
 *
 * Rules (pure, no database):
 *   - A person is mentioned by the local part of the email (`@nicolas.rivera`), lower case. It is
 *     unique, has no spaces and fits the @ grammar of lib/chat/groups.ts (extraerMenciones).
 *   - Only MEMBERS of the project can be mentioned; the author is never «mentioned».
 *   - An agent name wins over a person with the same handle (agents were there first).
 *   - A PERSON message that mentions people and NO agent is for people: the main agent does not
 *     take it (it sees it in the history of its next turn). If it also mentions an agent, the
 *     agent rules apply as before.
 *   - The mentioned people get a notification (push + bell), even if they muted the project:
 *     a direct mention is the exception to «mute», as in Teams.
 */
import { extraerMenciones, resolverAgentesMencionados, type AgenteMencionable } from '../chat/groups';
import { entregasHiloProyecto } from './hilos-rules';
import { handlePersona } from './menciones-personas-handle';

/** Project member that can be mentioned. */
export interface PersonaMencionable {
  idUser: string;
  name: string;
  email: string;
}

export { handlePersona };

/** Keys an agent answers to in a mention (code, name without spaces, handle). */
function clavesAgente(a: AgenteMencionable): string[] {
  return [a.code.toLowerCase(), a.displayName.toLowerCase().replace(/\s+/g, ''), ...(a.handle ? [a.handle.replace(/^@/, '').toLowerCase()] : [])];
}

/** Members mentioned in the text (without the author and without names taken by agents). */
export function personasMencionadas(
  body: string,
  personas: PersonaMencionable[],
  opciones: { idAutor?: string | null; agentes?: AgenteMencionable[] } = {}
): PersonaMencionable[] {
  const candidatos = extraerMenciones(body);
  if (candidatos.length === 0) return [];
  const deAgentes = new Set((opciones.agentes ?? []).flatMap(clavesAgente));
  const porHandle = new Map<string, PersonaMencionable>();
  for (const p of personas) {
    const h = handlePersona(p.email);
    if (h && !deAgentes.has(h) && !porHandle.has(h)) porHandle.set(h, p);
  }
  const out: PersonaMencionable[] = [];
  for (const c of candidatos) {
    const p = porHandle.get(c);
    if (p && p.idUser !== opciones.idAutor && !out.some((x) => x.idUser === p.idUser)) out.push(p);
  }
  return out;
}

/**
 * Who a PERSON message wakes in a project conversation, people included.
 * `invitados`: other agents mentioned; `principalAtiende`: false if the message mentions only
 * other agents, or only people; `personas`: members to notify.
 */
export function entregasConPersonas(opciones: {
  body: string;
  principal: AgenteMencionable | null;
  mencionables: AgenteMencionable[];
  personas: PersonaMencionable[];
  idAutor: string;
}): { invitados: number[]; principalAtiende: boolean; personas: PersonaMencionable[] } {
  const { body, principal, mencionables, personas, idAutor } = opciones;
  if (!body.includes('@')) return { invitados: [], principalAtiende: true, personas: [] };
  const agentes = [...(principal ? [principal] : []), ...mencionables];
  const r = principal && mencionables.length > 0 ? entregasHiloProyecto({ body, mencionables, principal }) : { invitados: [], principalAtiende: true };
  const principalMencionado = principal ? resolverAgentesMencionados(body, [principal]).length > 0 : false;
  const mencionadas = personasMencionadas(body, personas, { idAutor, agentes });
  const algunAgente = r.invitados.length > 0 || principalMencionado;
  return {
    invitados: r.invitados,
    principalAtiende: mencionadas.length > 0 && !algunAgente ? false : r.principalAtiende,
    personas: mencionadas,
  };
}

/** Handles the agents may use to address people (bridge context). */
export function personasParaAgente(personas: PersonaMencionable[], agentes: AgenteMencionable[] = []): { name: string; handle: string }[] {
  const deAgentes = new Set(agentes.flatMap(clavesAgente));
  const out: { name: string; handle: string }[] = [];
  for (const p of personas) {
    const h = handlePersona(p.email);
    if (h && !deAgentes.has(h) && !out.some((x) => x.handle === h)) out.push({ name: p.name, handle: h });
  }
  return out;
}
