/**
 * Agents from ANOTHER company in a project — PURE rules (no database).
 *
 * Request from Nicolás Rivera (SynerLink conv 1, msg 39725, 2026-11-25):
 * «deja la regla que si tengo acceso al agente pueda añadirlo, lo de las
 * empresas no me sirve ahorita». A person can now designate an agent they have
 * assigned in ANY company, even if the agent does not belong to the project's
 * company (e.g. Doki, OLP only, in a GSS project).
 *
 * -------------------------------------------------------------------------
 * CONNECTORS (the safety rule)
 * -------------------------------------------------------------------------
 * Each designated agent works with the connectors of ONE company, its
 * "connector company":
 *
 *   - Agent that BELONGS to the project's company (agent_company): the
 *     project's company and the project's profile, exactly as before. If that
 *     company's configuration does not enable the project's profile for the
 *     agent, it cannot work (null).
 *   - Agent that does NOT belong to the project's company ("other company"):
 *     the company where the person who ADDED it has it assigned and where it
 *     is enabled for Proyectos (lowest company id if several), and the FIRST
 *     profile of that company's configuration for the agent that is not the
 *     project's ('sin-conectores' if that is the only one). NEVER the
 *     project's profile: Doki in a GSS project keeps OLP's connectors and can
 *     never receive GSS SAP. If the person who added it no longer has it in
 *     such a company, it cannot work (null, fails closed).
 *
 * Writing to an agent (lib/chat/projects.ts → evaluarAgente) requires the
 * person to have the agent assigned in its CONNECTOR company: the agent never
 * becomes a door to another company's data.
 */
import type { ConfigProyectos } from './config-agentes-rules';

const PERFIL_SIN_CONECTORES = 'sin-conectores';

/** Connectors an agent works with inside a given project. */
export interface ConectoresAgente {
  /** Profile key the bridge mounts (puente-hilos/config/perfiles.json). */
  perfil: string;
  /** Company whose configuration and assignment govern the agent here. */
  idCompany: number;
  /** True when the agent does not belong to the project's company. */
  otraEmpresa: boolean;
}

export interface EntradaConectores {
  code: string;
  idCompanyProyecto: number;
  perfilProyecto: string;
  /** The agent belongs to the project's company (agent_company). */
  perteneceAEmpresaProyecto: boolean;
  /** Companies where the person who added the agent has it assigned. */
  empresasDeQuienLoAgrego: Iterable<number>;
  config: ConfigProyectos;
}

/** Resolve the connector company and profile of a designated agent. Null = cannot work. */
export function resolverConectoresAgente(e: EntradaConectores): ConectoresAgente | null {
  if (e.perteneceAEmpresaProyecto) {
    return e.config.perfiles(e.code, e.idCompanyProyecto).includes(e.perfilProyecto)
      ? { perfil: e.perfilProyecto, idCompany: e.idCompanyProyecto, otraEmpresa: false }
      : null;
  }
  const empresas = [...new Set(e.empresasDeQuienLoAgrego)].filter((c) => c !== e.idCompanyProyecto).sort((a, b) => a - b);
  for (const idCompany of empresas) {
    const perfiles = e.config.perfiles(e.code, idCompany);
    if (perfiles.length === 0) continue;
    // Never the project's profile, even if the agent's own company lists it
    // (e.g. a broad .env entry): its first OTHER profile, or no connectors.
    const propio = perfiles.find((p) => p !== e.perfilProyecto) ?? PERFIL_SIN_CONECTORES;
    return { perfil: propio, idCompany, otraEmpresa: true };
  }
  return null;
}
