/**
 * Acciones del módulo «Proyectos» que se ejecutan desde DOS puertas: la ruta de
 * la persona (app/api/proyectos/**) y la CONFIRMACIÓN de una propuesta de un
 * agente (lib/proyectos/propuestas.ts). Así las dos aplican exactamente la
 * misma regla, siempre con la identidad y el rol de la PERSONA.
 */
import { prisma } from '../prisma';
import { MAX_TITLE_CHARS } from '../chat/constants';
import { eligibleProjectUsers, writeAccessForAgent, type ProjectAccess, type ProjectUser } from '../chat/projects';
import { capabilitiesFor, isAssignableRole, MAX_PROJECT_CONVERSATIONS, MAX_PROJECT_MEMBERS } from '../chat/projects-rules';
import { LinkError } from '../chat/projects-links';
import { CorreoError } from '../correo/errors';

/** Error con estado HTTP y un texto para la persona. */
export class ProyectoError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Traduce los errores conocidos del módulo a { status, error }; null si es un error inesperado. */
export function errorDeProyecto(err: unknown): { status: number; error: string } | null {
  if (err instanceof ProyectoError || err instanceof LinkError) return { status: err.status, error: err.message };
  if (err instanceof CorreoError) return { status: err.status ?? 400, error: err.message };
  return null;
}

/** Abre una conversación del proyecto con uno de sus agentes (dueño o editor con el agente asignado). */
export async function crearConversacionProyecto(
  user: ProjectUser,
  project: ProjectAccess,
  entrada: { agentCode: unknown; title?: unknown }
): Promise<{ idConversation: number }> {
  const code = typeof entrada.agentCode === 'string' ? entrada.agentCode.trim().toLowerCase() : '';
  if (!code) throw new ProyectoError('Escoja el asistente de la conversación.', 400);

  let title = 'Nueva conversación';
  if (entrada.title !== undefined && entrada.title !== null) {
    if (typeof entrada.title !== 'string') throw new ProyectoError('El título debe ser texto.', 400);
    title = entrada.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS) || title;
  }

  const agente = await prisma.agent.findFirst({ where: { code }, select: { id_agent: true, display_name: true } });
  if (!agente) throw new ProyectoError('Ese asistente no está en el proyecto.', 400);
  const permiso = await writeAccessForAgent(user, project, agente.id_agent);
  if (!permiso.ok) throw new ProyectoError(permiso.motivo, 403);

  const activas = await prisma.chatConversation.count({ where: { id_project: project.idProject, archived: false } });
  if (activas >= MAX_PROJECT_CONVERSATIONS) {
    throw new ProyectoError(`El proyecto ya tiene ${MAX_PROJECT_CONVERSATIONS} conversaciones activas.`, 409);
  }

  const now = new Date();
  const conversacion = await prisma.$transaction(async (tx) => {
    const c = await tx.chatConversation.create({
      data: {
        kind: 'project',
        id_project: project.idProject,
        title,
        id_company: project.idCompany,
        id_user: user.id,
        created_by: user.id,
        id_agent: agente.id_agent,
        last_message_at: now,
      },
      select: { id: true },
    });
    await tx.chatMessage.create({
      data: {
        id_conversation: c.id,
        role: 'system',
        body:
          `Conversación con **${agente.display_name}** en el proyecto **${project.name}**. ` +
          'Tiene su propia memoria y trabaja con las instrucciones, los archivos y lo vinculado al proyecto. Todos los miembros la pueden leer.',
        created_at: now,
        delivered_at: now,
      },
    });
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: now } });
    return c;
  });
  return { idConversation: conversacion.id };
}

/**
 * Invita personas al proyecto (solo el dueño). Deben tener el permiso del
 * módulo en la empresa del proyecto, o nunca podrían entrar.
 */
export async function invitarMiembros(user: ProjectUser, project: ProjectAccess, ids: string[], role: unknown): Promise<{ added: number }> {
  if (!capabilitiesFor(project.role).manageMembers) throw new ProyectoError('Solo el dueño del proyecto puede invitar.', 403);
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  const rol = role === undefined ? 'editor' : role;
  if (!isAssignableRole(rol)) throw new ProyectoError('El rol debe ser editor o lector.', 400);

  const elegibles = new Set((await eligibleProjectUsers(project.idCompany, ids)).map((u) => u.id));
  if (ids.some((x) => !elegibles.has(x))) {
    throw new ProyectoError(
      'Hay personas que no tienen el permiso «Proyectos» en la empresa del proyecto, así que no podrían entrar. Pida primero el permiso.',
      409
    );
  }

  const actuales = await prisma.chatProjectMember.findMany({ where: { id_project: project.idProject }, select: { id_user: true } });
  const yaEstan = new Set(actuales.map((m) => m.id_user));
  const nuevos = ids.filter((x) => !yaEstan.has(x));
  if (actuales.length + nuevos.length > MAX_PROJECT_MEMBERS) {
    throw new ProyectoError(`Un proyecto admite máximo ${MAX_PROJECT_MEMBERS} miembros.`, 400);
  }
  if (nuevos.length > 0) {
    await prisma.chatProjectMember.createMany({
      data: nuevos.map((idUser) => ({ id_project: project.idProject, id_user: idUser, role: rol, added_by: user.id })),
    });
  }
  return { added: nuevos.length };
}
