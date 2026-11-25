/**
 * Módulo «Proyectos» de SynerLink — puertas de acceso y lecturas en la base.
 *
 * F1 piloto (2026-10-17): un proyecto por agente, dentro del chat.
 * Módulo (2026-10-18, pedido de Nicolás Rivera): módulo propio del menú, con
 * VARIOS agentes designados, roles dueño / editor / lector y correos y
 * solicitudes vinculados. Las reglas puras están en lib/chat/projects-rules.ts.
 *
 * -------------------------------------------------------------------------
 * LAS PUERTAS
 * -------------------------------------------------------------------------
 * PERSONA (resolveProjectForUser): entra a un proyecto solo si
 *   (a) es MIEMBRO (chat_project_member: dueño, editor o lector);
 *   (b) TODAVÍA tiene el permiso del módulo «Proyectos» en la empresa del
 *       proyecto (un permiso revocado cierra el proyecto sin que el dueño
 *       tenga que acordarse de retirarla) — o, desde el 2026-11-25 (msg 39725),
 *       lo tiene en OTRA empresa y además tiene asignado (en cualquier
 *       empresa) al menos uno de los agentes del proyecto;
 *   (c) el proyecto no está archivado — salvo el DUEÑO, que lo ve para
 *       restaurarlo (y nada más: sus conversaciones siguen cerradas).
 *
 * ESCRIBIRLE A UN AGENTE (writeAccessForAgent): además de la puerta,
 *   (d) rol dueño o editor;
 *   (e) el agente sigue DESIGNADO, activo y con CONECTORES resueltos
 *       (lib/proyectos/agentes-otra-empresa-rules.ts): si pertenece a la
 *       empresa del proyecto, el perfil del proyecto habilitado ahí; si es de
 *       OTRA empresa (2026-11-25), el perfil de SU empresa —nunca el del
 *       proyecto—;
 *   (f) la persona tiene ESE agente asignado en la empresa de sus conectores
 *       (la del proyecto, o la suya si es de otra empresa). El agente trae
 *       conectores de SAP: no debe ser una puerta a datos que la persona no
 *       tiene.
 *
 * AGENTE (assertAgentProjectConversation): solo con una llave de alcance
 * 'projects' (la del puente), solo conversaciones de SU agente y solo en
 * proyectos activos donde está designado. La llave del bot vivo nunca pasa por
 * aquí (lib/chat/agent-auth.ts).
 *
 * Lo que no pasa responde 404 y no 403: distinguirlos le confirmaría a quien
 * sondea ids que el proyecto existe.
 */
import { prisma } from '../prisma';
import { isProjectMuted, mutedProjectIds } from '../proyectos/mute';
import { getChatAccess } from './access';
import { parseAgentTasks } from './status-tasks';
import type { EstadoAgenteProyectoDto } from '../proyectos/estado-agente';
import {
  capabilitiesFor,
  profileLabel,
  PROJECTS_MODULE_URL,
  roleFromDb,
  type ProjectRole,
} from './projects-rules';
import { cargarConfigProyectos } from '../proyectos/config-agentes';
import { idsDesarrollo } from '../proyectos/agentes-desarrollo';
import type { ConfigProyectos } from '../proyectos/config-agentes-rules';
import { resolverConectoresAgente, type ConectoresAgente } from '../proyectos/agentes-otra-empresa-rules';
import { agentesMencionables, puedeGestionarHilo } from '../proyectos/hilos-rules';
import type { AgenteMencionable } from './groups';

/** Proyecto resuelto para una persona que SÍ puede entrar. */
export interface ProjectAccess {
  idProject: number;
  name: string;
  idCompany: number;
  profile: string;
  role: ProjectRole;
  archived: boolean;
}

export interface ProjectUser {
  id: string;
  email: string;
}

function esIdValido(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

/* ───────────────────────────── Módulo ───────────────────────────── */

/**
 * Empresas donde la persona tiene el permiso del módulo «Proyectos»
 * (subproceso /process/proyectos). Vacío = no tiene el módulo.
 */
export async function projectModuleCompanies(userId: string): Promise<{ idCompany: number; companyName: string }[]> {
  const filas = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { id_user: userId, user: { isActive: true, NOT: { role: 'supplier' } } },
      subprocess: { subprocess_url: PROJECTS_MODULE_URL },
    },
    select: { companyUser: { select: { company: { select: { id_company: true, company: true } } } } },
  });
  const out = new Map<number, { idCompany: number; companyName: string }>();
  for (const f of filas) {
    const c = f.companyUser.company;
    out.set(c.id_company, { idCompany: c.id_company, companyName: c.company.trim() });
  }
  return [...out.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
}

async function tieneModuloEn(userId: string, idCompany: number): Promise<boolean> {
  const n = await prisma.subprocessUserCompany.count({
    where: {
      companyUser: { id_user: userId, id_company: idCompany, user: { isActive: true, NOT: { role: 'supplier' } } },
      subprocess: { subprocess_url: PROJECTS_MODULE_URL },
    },
  });
  return n > 0;
}

/**
 * (b) por agente (2026-11-25, msg 39725): sin el módulo en la empresa del
 * proyecto, entra si tiene «Proyectos» en ALGUNA empresa y tiene asignado (en
 * cualquier empresa) al menos uno de los agentes del proyecto.
 */
async function entraPorAgente(user: ProjectUser, idProject: number): Promise<boolean> {
  const n = await prisma.subprocessUserCompany.count({
    where: {
      companyUser: { id_user: user.id, user: { isActive: true, NOT: { role: 'supplier' } } },
      subprocess: { subprocess_url: PROJECTS_MODULE_URL },
    },
  });
  if (n === 0) return false;
  const designados = await prisma.chatProjectAgent.findMany({ where: { id_project: idProject }, select: { id_agent: true } });
  if (designados.length === 0) return false;
  const asignados = await agentesAsignados(user.email);
  return designados.some((d) => (asignados.get(d.id_agent)?.size ?? 0) > 0);
}

/* ───────────────────────────── Puerta ───────────────────────────── */

/** Puerta de la PERSONA sobre un proyecto. Ver (a)–(c) arriba. */
export async function resolveProjectForUser(
  user: ProjectUser,
  idProject: unknown,
  opciones: { allowArchived?: boolean } = {}
): Promise<ProjectAccess | null> {
  if (!esIdValido(idProject)) return null;

  const project = await prisma.chatProject.findUnique({
    where: { id_project: idProject },
    select: {
      id_project: true,
      name: true,
      id_company: true,
      profile: true,
      archived: true,
      // Solo la fila de ESTA persona: la pertenencia se lee de aquí y de
      // ninguna otra parte.
      members: { where: { id_user: user.id }, select: { role: true } },
    },
  });
  if (!project) return null;

  const mio = project.members[0];
  if (!mio) return null; // (a)
  const role = roleFromDb(mio.role);

  if (project.archived && !(opciones.allowArchived && role === 'owner')) return null; // (c)
  if (!(await tieneModuloEn(user.id, project.id_company)) && !(await entraPorAgente(user, project.id_project))) return null; // (b)

  return {
    idProject: project.id_project,
    name: project.name,
    idCompany: project.id_company,
    profile: project.profile,
    role,
    archived: project.archived,
  };
}

/* ─────────────────────── Escribirle a un agente ─────────────────────── */

export type WriteAccess = { ok: true } | { ok: false; motivo: string };

interface AgenteDesignado {
  idAgent: number;
  code: string;
  isActive: boolean;
  /** Conectores resueltos para ESTE proyecto (null = no puede trabajar aquí). */
  conectores: ConectoresAgente | null;
}

/** (e) + (f): el agente sigue en condiciones y la persona lo tiene asignado en la empresa de sus conectores. */
function evaluarAgente(
  agente: AgenteDesignado | null,
  project: Pick<ProjectAccess, 'role'>,
  agentesDeLaPersona: Map<number, Set<number>>
): WriteAccess {
  if (!capabilitiesFor(project.role).write) {
    return { ok: false, motivo: 'Usted es lector en este proyecto: puede leer las conversaciones, pero no escribir.' };
  }
  if (!agente) return { ok: false, motivo: 'Este asistente ya no está en el proyecto: la conversación quedó de solo lectura.' };
  if (!agente.isActive || !agente.conectores) {
    return { ok: false, motivo: 'Este asistente no tiene proyectos habilitados en este momento.' };
  }
  if (!agentesDeLaPersona.get(agente.idAgent)?.has(agente.conectores.idCompany)) {
    return {
      ok: false,
      motivo: agente.conectores.otraEmpresa
        ? 'Usted no tiene este asistente asignado en la empresa de la que trae sus conectores.'
        : 'Usted no tiene este asistente asignado en la empresa del proyecto.',
    };
  }
  return { ok: true };
}

/** Designación leída de la base con lo necesario para resolver sus conectores. */
interface FilaDesignacion {
  idAgent: number;
  code: string;
  addedBy: string | null;
  /** Empresas a las que pertenece el agente (agent_company). */
  empresas: number[];
}

/** Select de Prisma para FilaDesignacion (dentro de chat_project_agent). */
const selectDesignacion = {
  added_by: true,
  agent: { select: { id_agent: true, code: true, is_active: true, companies: { select: { id_company: true } } } },
} as const;

function aFilaDesignacion(f: { added_by: string | null; agent: { id_agent: number; code: string; companies: { id_company: number }[] } }): FilaDesignacion {
  return { idAgent: f.agent.id_agent, code: f.agent.code, addedBy: f.added_by, empresas: f.agent.companies.map((c) => c.id_company) };
}

/**
 * Conectores de los agentes designados en UN proyecto (ver
 * lib/proyectos/agentes-otra-empresa-rules.ts). Solo los de OTRA empresa
 * consultan a quien los agregó (una consulta de personas y su acceso al chat).
 */
async function conectoresDeDesignados(
  proyecto: { idCompany: number; profile: string },
  filas: FilaDesignacion[],
  config: ConfigProyectos
): Promise<Map<number, ConectoresAgente | null>> {
  const out = new Map<number, ConectoresAgente | null>();
  const base = { idCompanyProyecto: proyecto.idCompany, perfilProyecto: proyecto.profile, config };
  const otras = filas.filter((f) => !f.empresas.includes(proyecto.idCompany));
  const porPersona = new Map<string, Map<number, Set<number>>>();
  const ids = [...new Set(otras.map((f) => f.addedBy).filter((x): x is string => typeof x === 'string' && x.length > 0))];
  if (ids.length > 0) {
    const personas = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, email: true } });
    for (const p of personas) if (p.email) porPersona.set(p.id, await agentesAsignados(p.email));
  }
  for (const f of filas) {
    const pertenece = f.empresas.includes(proyecto.idCompany);
    const deQuien = !pertenece && f.addedBy ? porPersona.get(f.addedBy)?.get(f.idAgent) ?? new Set<number>() : new Set<number>();
    out.set(f.idAgent, resolverConectoresAgente({ ...base, code: f.code, perteneceAEmpresaProyecto: pertenece, empresasDeQuienLoAgrego: deQuien }));
  }
  return out;
}

/** Agentes que la persona tiene asignados, por empresa: idAgent → empresas. */
export async function agentesAsignados(email: string): Promise<Map<number, Set<number>>> {
  const acceso = await getChatAccess(email);
  const out = new Map<number, Set<number>>();
  if (!acceso.canUseChat) return out;
  for (const a of acceso.agents) out.set(a.idAgent, new Set(a.companies.map((c) => c.idCompany)));
  return out;
}

/** ¿Puede ESTA persona escribirle a ESTE agente en ESTE proyecto? */
export async function writeAccessForAgent(user: ProjectUser, project: ProjectAccess, idAgent: number): Promise<WriteAccess> {
  if (project.archived) return { ok: false, motivo: 'El proyecto está archivado.' };
  if (!capabilitiesFor(project.role).write) return evaluarAgente(null, project, new Map());
  const fila = await prisma.chatProjectAgent.findFirst({
    where: { id_project: project.idProject, id_agent: idAgent },
    select: selectDesignacion,
  });
  let agente: AgenteDesignado | null = null;
  if (fila) {
    const conectores = await conectoresDeDesignados(project, [aFilaDesignacion(fila)], await cargarConfigProyectos());
    agente = { idAgent: fila.agent.id_agent, code: fila.agent.code, isActive: fila.agent.is_active, conectores: conectores.get(fila.agent.id_agent) ?? null };
  }
  return evaluarAgente(agente, project, await agentesAsignados(user.email));
}

/**
 * Puerta de la PERSONA sobre una CONVERSACIÓN de proyecto (la usa
 * guardConversation en lib/chat/http.ts). Anclada a kind = 'project'. Leer
 * basta con pasar la puerta del proyecto; `writable` dice si puede escribir.
 */
export async function assertProjectConversationAccess(
  user: ProjectUser,
  conversationId: number
): Promise<(ProjectAccess & { conversationId: number; idAgent: number; writable: WriteAccess }) | null> {
  if (!esIdValido(conversationId)) return null;

  const conv = await prisma.chatConversation.findFirst({
    where: { id: conversationId, kind: 'project' },
    select: { id: true, id_project: true, id_agent: true, archived: true },
  });
  if (!conv || conv.id_project === null || conv.archived) return null;

  const acceso = await resolveProjectForUser(user, conv.id_project);
  if (!acceso) return null;

  const writable = await writeAccessForAgent(user, acceso, conv.id_agent);
  return { ...acceso, conversationId: conv.id, idAgent: conv.id_agent, writable };
}

/**
 * Puerta del AGENTE (llave de alcance 'projects'): la conversación es de un
 * proyecto ACTIVO donde ESTE agente está designado, y la conversación es suya
 * — o lo INVITARON a ella (2026-10-29, multiagente): una persona lo mencionó
 * en el hilo, lo que deja una fila suya en chat_message_delivery. Con eso
 * puede leer el contexto (con el historial), poner su indicador y responder
 * en el mismo hilo. El id del agente sale de la llave, nunca del payload.
 */
/** Perfil sin conectores (lib/chat/projects-rules.ts). */
const PERFIL_SIN_CONECTORES = 'sin-conectores';

export async function assertAgentProjectConversation(
  idAgent: number,
  conversationId: unknown
): Promise<{
  id: number;
  idProject: number;
  projectName: string;
  invitado: boolean;
  idAgentPrincipal: number;
  /** Perfil de conectores con el que trabaja ESTE agente en la conversación. */
  perfil: string;
  /** La conversación es una mesa de discusión (los turnos los reparte el motor). */
  esMesa: boolean;
} | null> {
  if (!esIdValido(conversationId) || !esIdValido(idAgent)) return null;

  const conv = await prisma.chatConversation.findFirst({
    where: {
      id: conversationId,
      kind: 'project',
      archived: false,
      // ANCLA DE SEGURIDAD: la conversación es del agente de la llave, o una
      // persona lo mencionó en ella; y el agente sigue designado en un
      // proyecto activo.
      OR: [{ id_agent: idAgent }, { messages: { some: { deliveries: { some: { id_agent: idAgent } } } } }],
      project: { archived: false, agents: { some: { id_agent: idAgent } } },
    },
    select: {
      id: true,
      id_agent: true,
      mesa: { select: { id_mesa: true } },
      project: {
        select: {
          id_project: true,
          name: true,
          profile: true,
          id_company: true,
          // El agente de la LLAVE (no el del principal): el perfil se resuelve para él.
          agents: { where: { id_agent: idAgent }, select: selectDesignacion },
        },
      },
    },
  });
  if (!conv || !conv.project) return null;
  const designacion = conv.project.agents[0];
  if (!designacion) return null;
  const code = designacion.agent.code;
  const config = await cargarConfigProyectos();
  // Perfil POR AGENTE (2026-11-25): un agente de OTRA empresa trabaja con los
  // conectores de SU empresa, nunca con los del proyecto.
  const conectores =
    (await conectoresDeDesignados({ idCompany: conv.project.id_company, profile: conv.project.profile }, [aFilaDesignacion(designacion)], config)).get(idAgent) ??
    null;
  let perfil: string;
  if (conectores && !(conv.mesa && conectores.otraEmpresa)) {
    perfil = conectores.perfil;
  } else {
    // MESA DE DISCUSIÓN (2026-11-05, Nicolás Rivera: «que pueda elegir todos los
    // agentes que quiera»): un agente habilitado en la empresa pero sin el perfil
    // del proyecto —o uno de OTRA empresa— entra a la mesa SIN CONECTORES:
    // menos permisos que cualquier perfil suyo, y en una mesa solo se conversa.
    if (!conv.mesa) return null;
    if (!conectores?.otraEmpresa && config.perfiles(code, conv.project.id_company).length === 0) return null;
    perfil = PERFIL_SIN_CONECTORES;
  }

  return {
    id: conv.id,
    idProject: conv.project.id_project,
    projectName: conv.project.name,
    invitado: conv.id_agent !== idAgent,
    idAgentPrincipal: conv.id_agent,
    perfil,
    esMesa: Boolean(conv.mesa),
  };
}

/**
 * Agentes que ESTA persona puede MENCIONAR en un hilo (2026-10-29): designados
 * en el proyecto, que ella misma puede usar ahí (evaluarAgente) y distintos
 * del principal. Devuelve también al principal, para resolver la mención.
 */
export async function mencionablesDelHilo(
  user: ProjectUser,
  idProject: number,
  role: ProjectRole,
  idAgentPrincipal: number
): Promise<{ principal: AgenteMencionable | null; mencionables: AgenteMencionable[] }> {
  const p = await prisma.chatProject.findUnique({
    where: { id_project: idProject },
    select: {
      id_company: true,
      profile: true,
      archived: true,
      agents: {
        select: {
          added_by: true,
          agent: { select: { id_agent: true, code: true, display_name: true, handle: true, is_active: true, companies: { select: { id_company: true } } } },
        },
      },
    },
  });
  if (!p || p.archived) return { principal: null, mencionables: [] };
  const fila = p.agents.find((x) => x.agent.id_agent === idAgentPrincipal)?.agent;
  const principal = fila ? { idAgent: fila.id_agent, code: fila.code, displayName: fila.display_name, handle: fila.handle } : null;
  const otros = p.agents.filter((x) => x.agent.id_agent !== idAgentPrincipal);
  if (otros.length === 0 || !capabilitiesFor(role).write) return { principal, mencionables: [] };

  const [asignados, config] = await Promise.all([agentesAsignados(user.email), cargarConfigProyectos()]);
  const conectores = await conectoresDeDesignados({ idCompany: p.id_company, profile: p.profile }, otros.map(aFilaDesignacion), config);
  const mencionables = agentesMencionables(
    otros.map((x) => ({
      idAgent: x.agent.id_agent,
      code: x.agent.code,
      displayName: x.agent.display_name,
      handle: x.agent.handle,
      puedoEscribir: evaluarAgente(
        { idAgent: x.agent.id_agent, code: x.agent.code, isActive: x.agent.is_active, conectores: conectores.get(x.agent.id_agent) ?? null },
        { role },
        asignados
      ).ok,
    })),
    idAgentPrincipal
  );
  return { principal, mencionables };
}

/**
 * Asistentes a los que un ASISTENTE puede despertar con @ en un hilo de
 * proyecto (2026-11-12, menciones entre asistentes): los mismos que podría
 * mencionar la PERSONA que escribió por última vez en el hilo (`idUserOrigen`)
 * —designados, vigentes, con Proyectos habilitado y asignados a ella—, más el
 * principal del hilo si sigue designado. Sin persona de origen, o si ella ya
 * no puede escribir en el proyecto, nadie. El autor nunca se incluye.
 */
export async function mencionablesParaAgente(opciones: {
  idProject: number;
  idAgentPrincipal: number;
  idAgentAutor: number;
  idUserOrigen: string | null;
}): Promise<AgenteMencionable[]> {
  const { idProject, idAgentPrincipal, idAgentAutor, idUserOrigen } = opciones;
  if (!idUserOrigen) return [];
  const persona = await prisma.user.findUnique({ where: { id: idUserOrigen }, select: { id: true, email: true, isActive: true } });
  if (!persona || !persona.isActive || !persona.email) return [];
  const usuario = { id: persona.id, email: persona.email };
  const acceso = await resolveProjectForUser(usuario, idProject);
  if (!acceso || acceso.archived) return [];
  const { principal, mencionables } = await mencionablesDelHilo(usuario, idProject, acceso.role, idAgentPrincipal);
  const todos = [...(principal ? [principal] : []), ...mencionables];
  return todos.filter((a) => a.idAgent !== idAgentAutor);
}

/** Filtro Prisma de «proyecto activo donde el agente está designado» (bandeja, archivos). */
export function whereProyectoDelAgente(idAgent: number) {
  return { archived: false, agents: { some: { id_agent: idAgent } } } as const;
}

/**
 * Filtro del PUENTE (bandeja, archivos, matrices): proyecto activo donde el
 * agente está designado y, o es de una empresa donde está habilitado para
 * Proyectos (como antes), o es de una empresa a la que el agente NO pertenece
 * (agente de OTRA empresa, 2026-11-25). En ese caso la puerta fina es
 * assertAgentProjectConversation: trabaja con los conectores de SU empresa, o
 * no trabaja.
 */
export async function filtroProyectosDelPuente(idAgent: number, code: string, config: ConfigProyectos) {
  const propias = await prisma.agentCompany.findMany({ where: { id_agent: idAgent }, select: { id_company: true } });
  return {
    ...whereProyectoDelAgente(idAgent),
    OR: [config.filtroEmpresas(code), { id_company: { notIn: propias.map((c) => c.id_company) } }],
  };
}

/* ─────────────────────────── Personas elegibles ───────────────────────── */

/**
 * Personas que PUEDEN ser miembros de un proyecto: activas, no proveedoras y
 * que cumplen la condición (b) de la puerta (invitar a alguien que no la
 * cumple dejaría un miembro que nunca puede entrar):
 *   - el permiso del módulo «Proyectos» en la empresa del proyecto, o
 *   - (2026-11-25, msg 39725) el permiso del módulo en OTRA empresa y, en
 *     cualquier empresa, el permiso de al menos uno de los agentes designados
 *     en el proyecto (`idProject`).
 * `ids` acota la búsqueda (validar una invitación).
 */
export async function eligibleProjectUsers(
  idCompany: number,
  ids?: string[],
  idProject?: number
): Promise<{ id: string; name: string; email: string; image: string | null }[]> {
  const conModulo = { subprocesses: { some: { subprocess: { subprocess_url: PROJECTS_MODULE_URL } } } };
  // Subprocesos-permiso de los agentes designados (agent.id_subprocess).
  const subprocesosAgentes =
    typeof idProject === 'number'
      ? (
          await prisma.chatProjectAgent.findMany({ where: { id_project: idProject }, select: { agent: { select: { id_subprocess: true } } } })
        )
          .map((f) => f.agent.id_subprocess)
          .filter((x): x is number => typeof x === 'number')
      : [];
  const ramas: Record<string, unknown>[] = [{ companyUsers: { some: { id_company: idCompany, ...conModulo } } }];
  if (subprocesosAgentes.length > 0) {
    ramas.push({
      AND: [
        { companyUsers: { some: conModulo } },
        { companyUsers: { some: { subprocesses: { some: { id_subprocess: { in: subprocesosAgentes } } } } } },
      ],
    });
  }
  const filas = await prisma.user.findMany({
    where: {
      isActive: true,
      NOT: { role: 'supplier' },
      ...(ids ? { id: { in: ids } } : {}),
      OR: ramas,
    },
    select: { id: true, name: true, email: true, image: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    take: 500,
  });
  return filas.map((u) => ({ id: u.id, name: u.name?.trim() || u.email, email: u.email, image: u.image }));
}

/* ─────────────────────────── Agentes designables ──────────────────────── */

export interface AgenteDesignable {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarVersion: number | null;
  profiles: string[];
  /** Agente de DESARROLLO (2026-10-27): solo a estos se les ofrece código y repos. */
  esDesarrollo: boolean;
  /**
   * Agente de OTRA empresa (2026-11-25): no pertenece a la empresa del proyecto
   * y trabaja con los conectores de la empresa indicada (nunca con los del
   * proyecto). Null = de la empresa del proyecto.
   */
  otraEmpresa?: { idCompany: number; companyName: string; profile: string; profileLabel: string } | null;
}

/**
 * Agentes que ESTA persona puede designar, por empresa: los que tiene
 * asignados en esa empresa, con proyectos habilitados. Con `profile`, solo
 * los que admiten ese perfil.
 */
export async function designableAgents(email: string, profile?: string): Promise<Map<number, AgenteDesignable[]>> {
  const acceso = await getChatAccess(email);
  const out = new Map<number, AgenteDesignable[]>();
  if (!acceso.canUseChat) return out;
  const config = await cargarConfigProyectos();
  const desarrollo = await idsDesarrollo(acceso.agents.map((a) => a.idAgent));
  for (const a of acceso.agents) {
    // Habilitado y perfiles POR EMPRESA (configuración del módulo; sin configurar, el .env).
    for (const c of a.companies) {
      const perfiles = config.perfiles(a.code, c.idCompany);
      if (perfiles.length === 0) continue;
      if (profile && !perfiles.includes(profile)) continue;
      const lista = out.get(c.idCompany) ?? [];
      lista.push({
        idAgent: a.idAgent,
        code: a.code,
        displayName: a.displayName,
        handle: a.handle,
        avatarUrl: a.avatarUrl,
        avatarVersion: a.avatarVersion,
        profiles: perfiles,
        esDesarrollo: desarrollo.has(a.idAgent),
      });
      out.set(c.idCompany, lista);
    }
  }
  return out;
}

/**
 * Agentes que ESTA persona puede designar en UN proyecto (2026-11-25, msg
 * 39725: «si tengo acceso al agente pueda añadirlo»):
 *   - los de la empresa del proyecto, como antes (designableAgents): asignados
 *     ahí, habilitados y —con `profile`— con el perfil del proyecto;
 *   - los que NO pertenecen a la empresa del proyecto y la persona tiene
 *     asignados en otra empresa donde están habilitados para Proyectos. Llevan
 *     `otraEmpresa`: trabajarán con el perfil de ESA empresa (la misma
 *     resolución que usa el puente, resolverConectoresAgente), por eso no se
 *     filtran por el perfil del proyecto.
 */
export async function designableAgentsForProject(email: string, idCompany: number, profile?: string): Promise<AgenteDesignable[]> {
  const acceso = await getChatAccess(email);
  if (!acceso.canUseChat) return [];
  const [porEmpresa, config, pertenecen] = await Promise.all([
    designableAgents(email, profile),
    cargarConfigProyectos(),
    prisma.agentCompany.findMany({ where: { id_company: idCompany, id_agent: { in: acceso.agents.map((a) => a.idAgent) } }, select: { id_agent: true } }),
  ]);
  const deLaEmpresa = new Set(pertenecen.map((f) => f.id_agent));
  const out: AgenteDesignable[] = [...(porEmpresa.get(idCompany) ?? [])].filter((a) => deLaEmpresa.has(a.idAgent)).map((a) => ({ ...a, otraEmpresa: null }));
  const otras = acceso.agents.filter((a) => !deLaEmpresa.has(a.idAgent));
  if (otras.length === 0) return out;
  const desarrollo = await idsDesarrollo(otras.map((a) => a.idAgent));
  for (const a of otras) {
    const c = resolverConectoresAgente({
      code: a.code,
      idCompanyProyecto: idCompany,
      perfilProyecto: profile ?? '',
      perteneceAEmpresaProyecto: false,
      empresasDeQuienLoAgrego: a.companies.map((x) => x.idCompany),
      config,
    });
    if (!c) continue;
    const companyName = a.companies.find((x) => x.idCompany === c.idCompany)?.companyName.trim() ?? '';
    out.push({
      idAgent: a.idAgent,
      code: a.code,
      displayName: a.displayName,
      handle: a.handle,
      avatarUrl: a.avatarUrl,
      avatarVersion: a.avatarVersion,
      profiles: [c.perfil],
      esDesarrollo: desarrollo.has(a.idAgent),
      otraEmpresa: { idCompany: c.idCompany, companyName, profile: c.perfil, profileLabel: profileLabel(c.perfil) },
    });
  }
  return out;
}

/* ───────────────────────────── Listado ───────────────────────────────── */

const agenteMini = {
  id_agent: true,
  code: true,
  display_name: true,
  handle: true,
  avatar_url: true,
  avatar_updated_at: true,
} as const;

function aAgenteMini(a: {
  id_agent: number;
  code: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  avatar_updated_at: Date | null;
}) {
  return {
    idAgent: a.id_agent,
    code: a.code,
    displayName: a.display_name,
    handle: a.handle,
    avatarUrl: a.avatar_url,
    avatarVersion: a.avatar_updated_at ? a.avatar_updated_at.getTime() : null,
  };
}

/**
 * Proyectos que esta persona puede abrir: es miembro y conserva el permiso del
 * módulo en la empresa del proyecto. Archivados: solo los suyos (dueño).
 */
export async function listProjectsForUser(user: ProjectUser, opciones: { archivados: boolean }) {
  const empresas = await projectModuleCompanies(user.id);
  if (empresas.length === 0) return null;
  // (b) por agente (2026-11-25): también proyectos de OTRAS empresas donde es
  // miembro y tiene asignado alguno de sus agentes (en cualquier empresa).
  const misAgentes = [...(await agentesAsignados(user.email)).entries()].filter(([, cs]) => cs.size > 0).map(([id]) => id);
  const porEmpresa = { id_company: { in: empresas.map((e) => e.idCompany) } };

  const filas = await prisma.chatProject.findMany({
    where: {
      ...(misAgentes.length > 0 ? { OR: [porEmpresa, { agents: { some: { id_agent: { in: misAgentes } } } }] } : porEmpresa),
      archived: opciones.archivados,
      members: opciones.archivados
        ? { some: { id_user: user.id, role: 'owner' } }
        : { some: { id_user: user.id } },
    },
    select: {
      id_project: true,
      name: true,
      description: true,
      profile: true,
      archived: true,
      updated_at: true,
      company: { select: { id_company: true, company: true } },
      members: { where: { id_user: user.id }, select: { role: true } },
      agents: { select: { agent: { select: agenteMini } }, orderBy: { added_at: 'asc' } },
      _count: {
        select: { members: true, files: true, emails: true, requests: true, tasks: true, conversations: { where: { archived: false } } },
      },
    },
    orderBy: [{ updated_at: 'desc' }],
    take: 200,
  });
  const muted = await mutedProjectIds(user.id);

  return {
    companies: empresas,
    projects: filas.map((p) => ({
      idProject: p.id_project,
      name: p.name,
      description: p.description,
      company: { idCompany: p.company.id_company, companyName: p.company.company.trim() },
      profile: { key: p.profile, label: profileLabel(p.profile) },
      myRole: roleFromDb(p.members[0]?.role),
      archived: p.archived,
      agents: p.agents.map((x) => aAgenteMini(x.agent)),
      memberCount: p._count.members,
      conversationCount: p._count.conversations,
      linkCount: p._count.emails + p._count.requests,
      fileCount: p._count.files,
      taskCount: p._count.tasks,
      updatedAt: p.updated_at.toISOString(),
      muted: muted.has(p.id_project),
    })),
  };
}

/**
 * Conversaciones de proyecto donde la persona PUEDE ESCRIBIR (2026-10-24),
 * para el selector de «Compartir → Reenviar por el chat» del visor de
 * adjuntos. Misma regla de escritura que la puerta (evaluarAgente: rol con
 * escritura, agente vigente y asignado en la empresa), resuelta en bloque:
 * una consulta de proyectos y una de permisos, sin N+1. La puerta del POST
 * se vuelve a pasar igual al reenviar: esto solo arma la lista.
 */
export async function conversacionesDeProyectoEscribibles(
  user: ProjectUser
): Promise<{ idConversation: number; titulo: string | null; proyecto: string; agente: string; lastMessageAt: Date | null }[]> {
  const listado = await listProjectsForUser(user, { archivados: false });
  if (!listado || listado.projects.length === 0) return [];
  const conEscritura = listado.projects.filter((p) => capabilitiesFor(p.myRole).write);
  if (conEscritura.length === 0) return [];

  const filas = await prisma.chatConversation.findMany({
    where: { kind: 'project', archived: false, id_project: { in: conEscritura.map((p) => p.idProject) } },
    select: {
      id: true,
      title: true,
      id_project: true,
      last_message_at: true,
      agent: { select: { id_agent: true, code: true, display_name: true, is_active: true } },
    },
    orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  if (filas.length === 0) return [];

  const [asignados, config, designados] = await Promise.all([
    agentesAsignados(user.email),
    cargarConfigProyectos(),
    prisma.chatProjectAgent.findMany({
      where: { id_project: { in: conEscritura.map((p) => p.idProject) } },
      select: { id_project: true, ...selectDesignacion },
    }),
  ]);
  const proyectos = new Map(conEscritura.map((p) => [p.idProject, p]));
  // Conectores por proyecto: `${idProject}:${idAgent}` → conectores (solo designados).
  const enProyecto = new Map<string, ConectoresAgente | null>();
  for (const p of conEscritura) {
    const filasP = designados.filter((d) => d.id_project === p.idProject);
    if (filasP.length === 0) continue;
    const cs = await conectoresDeDesignados({ idCompany: p.company.idCompany, profile: p.profile.key }, filasP.map(aFilaDesignacion), config);
    for (const d of filasP) enProyecto.set(`${p.idProject}:${d.agent.id_agent}`, cs.get(d.agent.id_agent) ?? null);
  }

  const salida: { idConversation: number; titulo: string | null; proyecto: string; agente: string; lastMessageAt: Date | null }[] = [];
  for (const c of filas) {
    const p = c.id_project === null ? undefined : proyectos.get(c.id_project);
    if (!p) continue;
    const clave = `${p.idProject}:${c.agent.id_agent}`;
    const agente = enProyecto.has(clave)
      ? { idAgent: c.agent.id_agent, code: c.agent.code, isActive: c.agent.is_active, conectores: enProyecto.get(clave) ?? null }
      : null;
    const w = evaluarAgente(agente, { role: p.myRole }, asignados);
    if (!w.ok) continue;
    salida.push({ idConversation: c.id, titulo: c.title, proyecto: p.name, agente: c.agent.display_name, lastMessageAt: c.last_message_at });
  }
  return salida;
}

/* ───────────────────────────── Detalle ───────────────────────────────── */

/** Lo que la base sabe del proyecto; los vínculos los completa projects-links. */
export async function getProjectDetail(user: ProjectUser, acceso: ProjectAccess, opciones: { esAdmin?: boolean } = {}) {
  const p = await prisma.chatProject.findUnique({
    where: { id_project: acceso.idProject },
    select: {
      id_project: true,
      name: true,
      description: true,
      profile: true,
      instructions: true,
      archived: true,
      created_at: true,
      updated_at: true,
      company: { select: { id_company: true, company: true } },
      agents: {
        select: { added_by: true, agent: { select: { ...agenteMini, is_active: true, companies: { select: { id_company: true } } } } },
        orderBy: { added_at: 'asc' },
      },
      members: {
        select: { id_user: true, role: true, added_at: true, user: { select: { name: true, email: true, image: true } } },
        orderBy: [{ added_at: 'asc' }],
      },
      files: {
        select: {
          id_project_file: true,
          file_name: true,
          content_type: true,
          size_bytes: true,
          created_at: true,
          uploaded_by: true,
          uploaded_by_agent: true,
          id_conversation: true,
          folder_path: true,
        },
        orderBy: { created_at: 'desc' },
      },
      folders: { select: { path: true }, orderBy: { path: 'asc' } },
      _count: { select: { tasks: true, subagents: { where: { status: 'aprobado' } } } },
      conversations: {
        where: { archived: false },
        select: {
          id: true,
          title: true,
          created_at: true,
          last_message_at: true,
          id_agent: true,
          created_by: true,
          agent: { select: agenteMini },
          // Estado del agente (el mismo indicador del chat, 2026-10-20).
          statuses: { select: { id_agent: true, state: true, label: true, tasks: true, updated_at: true } },
        },
        orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
        take: 200,
      },
    },
  });
  if (!p) return null;

  const caps = capabilitiesFor(acceso.role);
  const asignados = caps.write && !p.archived ? await agentesAsignados(user.email) : new Map<number, Set<number>>();
  const designados = new Map(p.agents.map((x) => [x.agent.id_agent, x.agent]));
  const config = await cargarConfigProyectos();
  const conectores = await conectoresDeDesignados({ idCompany: p.company.id_company, profile: p.profile }, p.agents.map(aFilaDesignacion), config);
  const motivoDe = (idAgent: number) => {
    if (p.archived) return { ok: false as const, motivo: 'El proyecto está archivado.' };
    const a = designados.get(idAgent);
    return evaluarAgente(a ? { idAgent: a.id_agent, code: a.code, isActive: a.is_active, conectores: conectores.get(a.id_agent) ?? null } : null, acceso, asignados);
  };

  // Nombres de quienes crearon conversaciones o subieron archivos (una consulta).
  const ids = new Set<string>();
  for (const c of p.conversations) if (c.created_by) ids.add(c.created_by);
  for (const f of p.files) if (f.uploaded_by) ids.add(f.uploaded_by);
  const nombres = new Map<string, string>();
  for (const m of p.members) nombres.set(m.id_user, m.user.name?.trim() || m.user.email);
  const faltan = [...ids].filter((id) => !nombres.has(id));
  if (faltan.length > 0) {
    const us = await prisma.user.findMany({ where: { id: { in: faltan } }, select: { id: true, name: true, email: true } });
    for (const u of us) nombres.set(u.id, u.name?.trim() || u.email);
  }
  const persona = (id: string | null) => (id ? { id, name: nombres.get(id) ?? 'Persona retirada' } : null);

  // Archivos que generó un agente en una conversación (2026-10-23): su nombre visible.
  const idsAgentes = [...new Set(p.files.map((f) => f.uploaded_by_agent).filter((x): x is number => typeof x === 'number'))];
  const nombresAgentes = new Map<number, string>(p.agents.map((x) => [x.agent.id_agent, x.agent.display_name]));
  const faltanAgentes = idsAgentes.filter((id) => !nombresAgentes.has(id));
  if (faltanAgentes.length > 0) {
    const as = await prisma.agent.findMany({ where: { id_agent: { in: faltanAgentes } }, select: { id_agent: true, display_name: true } });
    for (const a of as) nombresAgentes.set(a.id_agent, a.display_name);
  }

  return {
    idProject: p.id_project,
    name: p.name,
    description: p.description,
    instructions: p.instructions,
    profile: { key: p.profile, label: profileLabel(p.profile) },
    company: { idCompany: p.company.id_company, companyName: p.company.company.trim() },
    myRole: acceso.role,
    archived: p.archived,
    // «Silenciar notificaciones» (2026-11-23): only for this person.
    muted: await isProjectMuted(p.id_project, user.id),
    // Agregar y retirar asistentes (2026-11-10): también la administración de SynerLink.
    capabilities: p.archived ? { ...capabilitiesFor(null), archive: caps.archive } : { ...caps, manageAgents: caps.manageAgents || opciones.esAdmin === true },
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
    agents: p.agents.map((x) => {
      const w = motivoDe(x.agent.id_agent);
      const c = conectores.get(x.agent.id_agent) ?? null;
      return {
        ...aAgenteMini(x.agent),
        disponible: x.agent.is_active && c !== null,
        // Agente de OTRA empresa (2026-11-25): con qué perfil de conectores trabaja aquí.
        conectoresOtraEmpresa: c?.otraEmpresa ? { profile: c.perfil, profileLabel: profileLabel(c.perfil) } : null,
        puedoEscribir: w.ok,
        motivo: w.ok ? null : w.motivo,
      };
    }),
    members: p.members
      .map((m) => ({
        id: m.id_user,
        name: m.user.name?.trim() || m.user.email,
        email: m.user.email,
        avatarUrl: m.user.image,
        role: roleFromDb(m.role),
      }))
      // Dueño, editores y lectores, en ese orden.
      .sort((a, b) => ['owner', 'editor', 'reader'].indexOf(a.role) - ['owner', 'editor', 'reader'].indexOf(b.role)),
    files: p.files.map((f) => ({
      id: f.id_project_file,
      fileName: f.file_name,
      contentType: f.content_type,
      sizeBytes: f.size_bytes,
      createdAt: f.created_at.toISOString(),
      uploadedBy: persona(f.uploaded_by),
      uploadedByAgent:
        typeof f.uploaded_by_agent === 'number'
          ? { idAgent: f.uploaded_by_agent, name: nombresAgentes.get(f.uploaded_by_agent) ?? 'Asistente', idConversation: f.id_conversation ?? null }
          : null,
      downloadUrl: `/api/proyectos/${p.id_project}/archivos/${f.id_project_file}`,
      puedoQuitar: !p.archived && (caps.removeAny || (caps.contribute && f.uploaded_by === user.id)),
      folderPath: f.folder_path ?? null,
    })),
    folders: p.folders.map((x) => x.path),
    conversations: p.conversations.map((c) => {
      const w = motivoDe(c.id_agent);
      return {
        id: c.id,
        title: c.title,
        createdAt: c.created_at.toISOString(),
        lastMessageAt: c.last_message_at ? c.last_message_at.toISOString() : null,
        agent: aAgenteMini(c.agent),
        createdBy: persona(c.created_by),
        soloLectura: w.ok ? null : w.motivo,
        // Renombrar y eliminar (2026-10-29): creador con escritura, dueño o administrador.
        puedoGestionar: puedeGestionarHilo({
          actorId: user.id,
          role: acceso.role,
          esAdmin: opciones.esAdmin === true,
          creadoPor: c.created_by,
          proyectoArchivado: p.archived,
        }).ok,
        agentStatus: estadoDeConversacion(c, p.id_project, p.name),
      };
    }),
    memberCount: p.members.length,
    conversationCount: p.conversations.length,
    fileCount: p.files.length,
    taskCount: p._count.tasks,
    teamCount: p._count.subagents,
  };
}

/**
 * Estado del agente DUEÑO de una conversación de proyecto (2026-10-20). En un
 * proyecto cada conversación es de un solo agente; una fila de otro agente no
 * se muestra.
 */
function estadoDeConversacion(
  c: {
    id: number;
    title: string | null;
    id_agent: number;
    agent: Parameters<typeof aAgenteMini>[0];
    statuses: { id_agent: number; state: string; label: string | null; tasks: string | null; updated_at: Date }[];
  },
  idProject: number,
  projectName: string
): EstadoAgenteProyectoDto | null {
  const s = c.statuses.find((x) => x.id_agent === c.id_agent);
  if (!s) return null;
  const a = aAgenteMini(c.agent);
  return {
    idConversation: c.id,
    idProject,
    projectName,
    conversationTitle: c.title?.trim() || 'Conversación',
    agent: { idAgent: a.idAgent, code: a.code, displayName: a.displayName, avatarUrl: a.avatarUrl, avatarVersion: a.avatarVersion },
    state: s.state,
    label: s.label,
    tasks: parseAgentTasks(s.tasks),
    updatedAt: s.updated_at.toISOString(),
  };
}

/** Para pruebas: la evaluación pura del permiso de escritura. */
export const __evaluarAgente = evaluarAgente;
