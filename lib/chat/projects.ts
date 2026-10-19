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
 *       tenga que acordarse de retirarla);
 *   (c) el proyecto no está archivado — salvo el DUEÑO, que lo ve para
 *       restaurarlo (y nada más: sus conversaciones siguen cerradas).
 *
 * ESCRIBIRLE A UN AGENTE (writeAccessForAgent): además de la puerta,
 *   (d) rol dueño o editor;
 *   (e) el agente sigue DESIGNADO, activo y con el módulo habilitado
 *       (CHAT_PROJECTS_AGENTS) para el perfil del proyecto;
 *   (f) la persona tiene ESE agente asignado en la empresa del proyecto. El
 *       agente trae conectores de SAP: no debe ser una puerta a datos que la
 *       persona no tiene (opción más segura; decisión pendiente de Nicolás).
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
import { getChatAccess } from './access';
import {
  capabilitiesFor,
  profileLabel,
  profilesFor,
  projectsEnabledFor,
  PROJECTS_MODULE_URL,
  roleFromDb,
  type ProjectRole,
} from './projects-rules';

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
  if (!(await tieneModuloEn(user.id, project.id_company))) return null; // (b)

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
}

/** (e) + (f): el agente sigue en condiciones y la persona lo tiene asignado. */
function evaluarAgente(
  agente: AgenteDesignado | null,
  project: Pick<ProjectAccess, 'idCompany' | 'profile' | 'role'>,
  agentesDeLaPersona: Map<number, Set<number>>
): WriteAccess {
  if (!capabilitiesFor(project.role).write) {
    return { ok: false, motivo: 'Usted es lector en este proyecto: puede leer las conversaciones, pero no escribir.' };
  }
  if (!agente) return { ok: false, motivo: 'Este asistente ya no está en el proyecto: la conversación quedó de solo lectura.' };
  if (!agente.isActive || !projectsEnabledFor(agente.code) || !profilesFor(agente.code).includes(project.profile)) {
    return { ok: false, motivo: 'Este asistente no tiene proyectos habilitados en este momento.' };
  }
  if (!agentesDeLaPersona.get(agente.idAgent)?.has(project.idCompany)) {
    return { ok: false, motivo: 'Usted no tiene este asistente asignado en la empresa del proyecto.' };
  }
  return { ok: true };
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
  const fila = await prisma.chatProjectAgent.findFirst({
    where: { id_project: project.idProject, id_agent: idAgent },
    select: { agent: { select: { id_agent: true, code: true, is_active: true } } },
  });
  const agente = fila ? { idAgent: fila.agent.id_agent, code: fila.agent.code, isActive: fila.agent.is_active } : null;
  const asignados = capabilitiesFor(project.role).write ? await agentesAsignados(user.email) : new Map();
  return evaluarAgente(agente, project, asignados);
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
 * proyecto ACTIVO donde ESTE agente está designado, y la conversación es suya.
 * El id del agente sale de la llave, nunca del payload.
 */
export async function assertAgentProjectConversation(
  idAgent: number,
  conversationId: unknown
): Promise<{ id: number; idProject: number; projectName: string } | null> {
  if (!esIdValido(conversationId) || !esIdValido(idAgent)) return null;

  const conv = await prisma.chatConversation.findFirst({
    where: {
      id: conversationId,
      kind: 'project',
      archived: false,
      // ANCLA DE SEGURIDAD: la conversación es del agente de la llave y el
      // agente sigue designado en un proyecto activo.
      id_agent: idAgent,
      project: { archived: false, agents: { some: { id_agent: idAgent } } },
    },
    select: {
      id: true,
      agent: { select: { code: true } },
      project: { select: { id_project: true, name: true, profile: true } },
    },
  });
  if (!conv || !conv.project) return null;
  if (!projectsEnabledFor(conv.agent.code) || !profilesFor(conv.agent.code).includes(conv.project.profile)) return null;

  return { id: conv.id, idProject: conv.project.id_project, projectName: conv.project.name };
}

/** Filtro Prisma de «proyecto activo donde el agente está designado» (bandeja, archivos). */
export function whereProyectoDelAgente(idAgent: number) {
  return { archived: false, agents: { some: { id_agent: idAgent } } } as const;
}

/* ─────────────────────────── Personas elegibles ───────────────────────── */

/**
 * Personas que PUEDEN ser miembros de un proyecto: activas y con el permiso
 * del módulo «Proyectos» en la empresa del proyecto (la misma condición (b)
 * de la puerta: invitar a alguien que no la cumple dejaría un miembro que
 * nunca puede entrar). `ids` acota la búsqueda (validar una invitación).
 */
export async function eligibleProjectUsers(
  idCompany: number,
  ids?: string[]
): Promise<{ id: string; name: string; email: string; image: string | null }[]> {
  const filas = await prisma.user.findMany({
    where: {
      isActive: true,
      NOT: { role: 'supplier' },
      ...(ids ? { id: { in: ids } } : {}),
      companyUsers: {
        some: { id_company: idCompany, subprocesses: { some: { subprocess: { subprocess_url: PROJECTS_MODULE_URL } } } },
      },
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
  for (const a of acceso.agents) {
    if (!projectsEnabledFor(a.code)) continue;
    const perfiles = profilesFor(a.code);
    if (profile && !perfiles.includes(profile)) continue;
    for (const c of a.companies) {
      const lista = out.get(c.idCompany) ?? [];
      lista.push({
        idAgent: a.idAgent,
        code: a.code,
        displayName: a.displayName,
        handle: a.handle,
        avatarUrl: a.avatarUrl,
        avatarVersion: a.avatarVersion,
        profiles: perfiles,
      });
      out.set(c.idCompany, lista);
    }
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

  const filas = await prisma.chatProject.findMany({
    where: {
      id_company: { in: empresas.map((e) => e.idCompany) },
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
    })),
  };
}

/* ───────────────────────────── Detalle ───────────────────────────────── */

/** Lo que la base sabe del proyecto; los vínculos los completa projects-links. */
export async function getProjectDetail(user: ProjectUser, acceso: ProjectAccess) {
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
      agents: { select: { agent: { select: { ...agenteMini, is_active: true } } }, orderBy: { added_at: 'asc' } },
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
        },
        orderBy: { created_at: 'desc' },
      },
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
  const motivoDe = (idAgent: number) => {
    if (p.archived) return { ok: false as const, motivo: 'El proyecto está archivado.' };
    const a = designados.get(idAgent);
    return evaluarAgente(a ? { idAgent: a.id_agent, code: a.code, isActive: a.is_active } : null, acceso, asignados);
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

  return {
    idProject: p.id_project,
    name: p.name,
    description: p.description,
    instructions: p.instructions,
    profile: { key: p.profile, label: profileLabel(p.profile) },
    company: { idCompany: p.company.id_company, companyName: p.company.company.trim() },
    myRole: acceso.role,
    archived: p.archived,
    capabilities: p.archived ? { ...capabilitiesFor(null), archive: caps.archive } : caps,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
    agents: p.agents.map((x) => {
      const w = motivoDe(x.agent.id_agent);
      return {
        ...aAgenteMini(x.agent),
        disponible: x.agent.is_active && projectsEnabledFor(x.agent.code),
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
      downloadUrl: `/api/proyectos/${p.id_project}/archivos/${f.id_project_file}`,
      puedoQuitar: !p.archived && (caps.removeAny || (caps.contribute && f.uploaded_by === user.id)),
    })),
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
      };
    }),
    memberCount: p.members.length,
    conversationCount: p.conversations.length,
    fileCount: p.files.length,
    taskCount: p._count.tasks,
    teamCount: p._count.subagents,
  };
}

/** Para pruebas: la evaluación pura del permiso de escritura. */
export const __evaluarAgente = evaluarAgente;
