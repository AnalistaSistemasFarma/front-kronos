/**
 * AGENTES DE DESARROLLO en Proyectos — reglas PURAS (sin base), compartidas por
 * la interfaz y el servidor.
 *
 * Historia:
 *   - 2026-10-27 (Nicolás Rivera, 16:08 COT): «el tema de los proyectos de
 *     desarrollo sí, solo debería ser de los agentes que desarrollan».
 *   - 2026-11-11 (Nicolás Rivera, 15:22 COT): «la mesa de discusión no debe
 *     depender de proyectos de desarrollo». Un agente de NEGOCIO
 *     (agent.es_desarrollo = 0) SÍ puede estar en un proyecto con código y en
 *     sus mesas: participa en conversaciones y mesas SIN acceso al código.
 *
 * El nivel de código y los repos son del proyecto, pero solo se ENTREGAN a los
 * agentes de desarrollo: la reja real está en el servidor, en
 * politicaParaPuente(idProject, { esDesarrollo: false }) → «ninguno» y sin repos
 * (lib/proyectos/permisos-agentes.ts y GET /api/chat/agent/projects/policy).
 * Por eso ya no se bloquea agregar agentes de negocio ni guardar una política
 * con código: solo se muestra un aviso informativo.
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

function enumerar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Aviso INFORMATIVO (no bloquea) cuando hay agentes de negocio en un proyecto
 * con código. Vacío si no hay ninguno.
 *   «Play no es agente de desarrollo: participa sin acceso al código.»
 */
export function avisoSinCodigo(nombresNegocio: string[]): string {
  const nombres = nombresNegocio.filter((n) => n && n.trim());
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return `${nombres[0]} no es agente de desarrollo: participa sin acceso al código.`;
  return `${enumerar(nombres)} no son agentes de desarrollo: participan sin acceso al código.`;
}
