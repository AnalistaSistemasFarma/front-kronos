/**
 * PROYECTOS (hilos de agente) del chat — la parte que toca la base.
 *
 * F1 piloto aprobado por Nicolás Rivera el 2026-10-17. Las reglas puras
 * (interruptor, perfiles, validaciones) están en lib/chat/projects-rules.ts.
 *
 * -------------------------------------------------------------------------
 * LAS DOS PUERTAS
 * -------------------------------------------------------------------------
 * PERSONA (resolveProjectForUser / assertProjectConversationAccess): entra
 * a un proyecto —y a sus conversaciones— solo si se cumplen TODAS:
 *   (a) el agente del proyecto tiene proyectos habilitados
 *       (CHAT_PROJECTS_AGENTS);
 *   (b) el proyecto no está archivado;
 *   (c) la persona es MIEMBRO (chat_project_member) — dueño o miembro;
 *   (d) la persona TODAVÍA tiene el permiso del agente en la empresa del
 *       proyecto. Un permiso revocado cierra el proyecto sin que el dueño
 *       tenga que acordarse de retirarla.
 *
 * AGENTE (assertAgentProjectConversation): solo con una llave de alcance
 * 'projects' (la del puente) y solo conversaciones de proyectos de SU agente.
 * La llave del bot vivo nunca pasa por aquí (lib/chat/agent-auth.ts).
 *
 * Igual que en el resto del módulo, lo que no pasa responde 404 y no 403:
 * distinguirlos le confirmaría a quien sondea ids que el proyecto existe.
 */
import { prisma } from '../prisma';
import { CHAT_MODULE_URL, getChatAccess, getChatAgentAccess } from './access';
import {
  profileLabel,
  profilesFor,
  projectsEnabledFor,
  PROJECT_PROFILES,
  type ProjectRole,
} from './projects-rules';

/** Proyecto resuelto para una persona que SÍ puede entrar. */
export interface ProjectAccess {
  idProject: number;
  name: string;
  idAgent: number;
  agentCode: string;
  idCompany: number;
  profile: string;
  role: ProjectRole;
}

function esIdValido(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

/** Puerta de la PERSONA sobre un proyecto. Ver (a)–(d) arriba. */
export async function resolveProjectForUser(
  user: { id: string; email: string },
  idProject: unknown
): Promise<ProjectAccess | null> {
  if (!esIdValido(idProject)) return null;

  const project = await prisma.chatProject.findUnique({
    where: { id_project: idProject },
    select: {
      id_project: true,
      name: true,
      id_agent: true,
      id_company: true,
      profile: true,
      archived: true,
      agent: { select: { code: true, is_active: true } },
      // Solo la fila de ESTA persona: la pertenencia se lee de aquí y de
      // ninguna otra parte.
      members: { where: { id_user: user.id }, select: { role: true } },
    },
  });

  if (!project || project.archived) return null; // (b)
  if (!project.agent.is_active || !projectsEnabledFor(project.agent.code)) return null; // (a)

  const mio = project.members[0];
  if (!mio) return null; // (c)

  // (d) el permiso del agente en la empresa del proyecto sigue vigente.
  const acceso = await getChatAgentAccess(user.email, project.id_agent);
  if (!acceso || !acceso.companies.some((c) => c.idCompany === project.id_company)) return null;

  return {
    idProject: project.id_project,
    name: project.name,
    idAgent: project.id_agent,
    agentCode: project.agent.code,
    idCompany: project.id_company,
    profile: project.profile,
    role: mio.role === 'owner' ? 'owner' : 'member',
  };
}

/**
 * Puerta de la PERSONA sobre una CONVERSACIÓN de proyecto (la usa
 * guardConversation en lib/chat/http.ts). Anclada a kind = 'project'.
 */
export async function assertProjectConversationAccess(
  user: { id: string; email: string },
  conversationId: number
): Promise<(ProjectAccess & { conversationId: number }) | null> {
  if (!esIdValido(conversationId)) return null;

  const conv = await prisma.chatConversation.findFirst({
    where: { id: conversationId, kind: 'project' },
    select: { id: true, id_project: true, id_agent: true, archived: true },
  });
  if (!conv || conv.id_project === null || conv.archived) return null;

  const acceso = await resolveProjectForUser(user, conv.id_project);
  // Defensa adicional: el agente de la conversación es el del proyecto.
  if (!acceso || acceso.idAgent !== conv.id_agent) return null;

  return { ...acceso, conversationId: conv.id };
}

/**
 * Puerta del AGENTE (llave de alcance 'projects'): la conversación es de un
 * proyecto activo de ESTE agente, y el agente tiene proyectos habilitados.
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
      // ANCLA DE SEGURIDAD: del agente de la llave, por las dos columnas.
      id_agent: idAgent,
      project: { id_agent: idAgent, archived: false },
    },
    select: {
      id: true,
      project: { select: { id_project: true, name: true, agent: { select: { code: true } } } },
    },
  });
  if (!conv || !conv.project) return null;
  if (!projectsEnabledFor(conv.project.agent.code)) return null;

  return { id: conv.id, idProject: conv.project.id_project, projectName: conv.project.name };
}

/* ─────────────────────────── Personas elegibles ───────────────────────── */

/**
 * Personas que PUEDEN ser miembros de un proyecto: activas, con el módulo del
 * chat Y con el permiso del agente en la empresa del proyecto. Es la misma
 * condición (d) de la puerta: invitar a alguien que no la cumple dejaría un
 * miembro que nunca puede entrar.
 *
 * `ids` acota la búsqueda (validar una invitación); sin `ids`, lista todas
 * (el buscador del cuadro de invitar).
 */
export async function eligibleProjectUsers(
  idAgent: number,
  idCompany: number,
  ids?: string[]
): Promise<{ id: string; name: string; email: string; image: string | null }[]> {
  const agent = await prisma.agent.findUnique({
    where: { id_agent: idAgent },
    select: { id_subprocess: true },
  });
  if (!agent?.id_subprocess) return [];

  const filas = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(ids ? { id: { in: ids } } : {}),
      AND: [
        {
          companyUsers: {
            some: { id_company: idCompany, subprocesses: { some: { id_subprocess: agent.id_subprocess } } },
          },
        },
        {
          companyUsers: {
            some: {
              id_company: idCompany,
              subprocesses: { some: { subprocess: { subprocess_url: CHAT_MODULE_URL } } },
            },
          },
        },
      ],
    },
    select: { id: true, name: true, email: true, image: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
  });

  return filas.map((u) => ({ id: u.id, name: u.name?.trim() || u.email, email: u.email, image: u.image }));
}

/* ───────────────────────────── Listado ───────────────────────────────── */

export interface ProjectSummaryDto {
  idProject: number;
  name: string;
  company: { idCompany: number; companyName: string };
  profile: { key: string; label: string };
  myRole: ProjectRole;
  memberCount: number;
  conversationCount: number;
  updatedAt: string;
}

/**
 * Proyectos de UN agente que esta persona puede abrir, más lo que necesita la
 * interfaz para crear uno nuevo (empresas y perfiles permitidos).
 *
 * Devuelve null si la persona no ve al agente o el agente no tiene proyectos:
 * la ruta responde 404.
 */
export async function listProjectsForUser(
  user: { id: string; email: string },
  agentCode: string
) {
  const code = agentCode.trim().toLowerCase();
  if (!code || !projectsEnabledFor(code)) return null;

  const access = await getChatAccess(user.email);
  if (!access.canUseChat) return null;
  const agent = access.agents.find((a) => a.code.toLowerCase() === code);
  if (!agent) return null;

  const empresas = agent.companies.map((c) => c.idCompany);

  const filas = await prisma.chatProject.findMany({
    where: {
      id_agent: agent.idAgent,
      archived: false,
      // (d) solo empresas donde HOY tiene el permiso del agente.
      id_company: { in: empresas },
      // (c) solo donde es miembro.
      members: { some: { id_user: user.id } },
    },
    select: {
      id_project: true,
      name: true,
      profile: true,
      updated_at: true,
      company: { select: { id_company: true, company: true } },
      members: { where: { id_user: user.id }, select: { role: true } },
      _count: { select: { members: true, conversations: { where: { archived: false } } } },
    },
    orderBy: [{ updated_at: 'desc' }],
  });

  const proyectos: ProjectSummaryDto[] = filas.map((p) => ({
    idProject: p.id_project,
    name: p.name,
    company: { idCompany: p.company.id_company, companyName: p.company.company },
    profile: { key: p.profile, label: profileLabel(p.profile) },
    myRole: p.members[0]?.role === 'owner' ? 'owner' : 'member',
    memberCount: p._count.members,
    conversationCount: p._count.conversations,
    updatedAt: p.updated_at.toISOString(),
  }));

  const permitidos = profilesFor(code);
  return {
    agent: {
      idAgent: agent.idAgent,
      code: agent.code,
      displayName: agent.displayName,
      handle: agent.handle,
      avatarUrl: agent.avatarUrl,
      avatarVersion: agent.avatarVersion,
    },
    companies: agent.companies.map((c) => ({ idCompany: c.idCompany, companyName: c.companyName })),
    profiles: PROJECT_PROFILES.filter((p) => permitidos.includes(p.key)),
    projects: proyectos,
  };
}

/* ───────────────────────────── Detalle ───────────────────────────────── */

export async function getProjectDetail(acceso: ProjectAccess) {
  const p = await prisma.chatProject.findUnique({
    where: { id_project: acceso.idProject },
    select: {
      id_project: true,
      name: true,
      profile: true,
      instructions: true,
      created_at: true,
      updated_at: true,
      company: { select: { id_company: true, company: true } },
      agent: {
        select: { id_agent: true, code: true, display_name: true, handle: true, avatar_url: true, avatar_updated_at: true },
      },
      members: {
        select: {
          id_user: true,
          role: true,
          added_at: true,
          user: { select: { name: true, email: true, image: true } },
        },
        orderBy: [{ role: 'desc' }, { added_at: 'asc' }],
      },
      files: {
        select: { id_project_file: true, file_name: true, content_type: true, size_bytes: true, created_at: true },
        orderBy: { created_at: 'desc' },
      },
      conversations: {
        where: { archived: false },
        select: { id: true, title: true, created_at: true, last_message_at: true },
        orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
      },
    },
  });
  if (!p) return null;

  return {
    idProject: p.id_project,
    name: p.name,
    instructions: p.instructions,
    profile: { key: p.profile, label: profileLabel(p.profile) },
    company: { idCompany: p.company.id_company, companyName: p.company.company },
    agent: {
      idAgent: p.agent.id_agent,
      code: p.agent.code,
      displayName: p.agent.display_name,
      handle: p.agent.handle,
      avatarUrl: p.agent.avatar_url,
      avatarVersion: p.agent.avatar_updated_at ? p.agent.avatar_updated_at.getTime() : null,
    },
    myRole: acceso.role,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
    members: p.members.map((m) => ({
      id: m.id_user,
      name: m.user.name?.trim() || m.user.email,
      email: m.user.email,
      avatarUrl: m.user.image,
      role: m.role === 'owner' ? ('owner' as const) : ('member' as const),
    })),
    files: p.files.map((f) => ({
      id: f.id_project_file,
      fileName: f.file_name,
      contentType: f.content_type,
      sizeBytes: f.size_bytes,
      createdAt: f.created_at.toISOString(),
      downloadUrl: `/api/chat/projects/${p.id_project}/files/${f.id_project_file}`,
    })),
    conversations: p.conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.created_at.toISOString(),
      lastMessageAt: c.last_message_at ? c.last_message_at.toISOString() : null,
    })),
  };
}

export type ProjectDetailDto = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
