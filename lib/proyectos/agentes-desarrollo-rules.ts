/**
 * AGENTES DE DESARROLLO en Proyectos (2026-10-27) — reglas PURAS (sin base),
 * compartidas por la interfaz y el servidor.
 *
 * Regla de Nicolás Rivera (2026-10-27, 16:08 COT): «el tema de los proyectos
 * de desarrollo sí, solo debería ser de los agentes que desarrollan». El nivel
 * de código y los repositorios de un proyecto solo se asignan cuando TODOS sus
 * agentes designados son de desarrollo (agent.es_desarrollo = 1; hoy, Orus y
 * Pedro). Basta un agente de negocio en el proyecto para que quede en
 * «ninguno»: la política es del proyecto, no de cada agente.
 */

export interface AgenteMarcado {
  displayName: string;
  esDesarrollo: boolean;
}

/** ¿La política pedida da algo de código? (nivel distinto de «ninguno» o algún repo). */
export function pideCodigo(p: { codeLevel?: unknown; repos?: unknown }): boolean {
  if (p.codeLevel !== undefined && p.codeLevel !== null && p.codeLevel !== 'ninguno') return true;
  return Array.isArray(p.repos) && p.repos.length > 0;
}

/** Agentes que NO son de desarrollo (en el orden recibido). */
export function agentesDeNegocio<T extends AgenteMarcado>(agentes: T[]): T[] {
  return agentes.filter((a) => !a.esDesarrollo);
}

/** ¿Se le puede dar código al proyecto? Sí solo si hay agentes y TODOS son de desarrollo. */
export function codigoPermitido(agentes: AgenteMarcado[]): boolean {
  return agentes.length > 0 && agentes.every((a) => a.esDesarrollo);
}

function enumerar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** Mensaje del 400 (y del aviso de la interfaz) cuando hay agentes de negocio. */
export function mensajeSoloDesarrollo(nombresNegocio: string[]): string {
  const quien =
    nombresNegocio.length === 0
      ? 'Este proyecto no tiene agentes de desarrollo'
      : nombresNegocio.length === 1
        ? `${nombresNegocio[0]} no es agente de desarrollo`
        : `${enumerar(nombresNegocio)} no son agentes de desarrollo`;
  return `El acceso a código y los repositorios solo se asignan a agentes de desarrollo. ${quien}: el proyecto queda en «Ninguno» y sin repositorios.`;
}
