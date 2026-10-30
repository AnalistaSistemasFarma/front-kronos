/**
 * RENOMBRAR y ELIMINAR conversaciones de un proyecto (2026-10-29). Las reglas
 * puras están en ./hilos-rules.ts; aquí, la base.
 *
 * Las dos acciones escriben PRIMERO el registro (chat_project_conversation_log)
 * y luego el cambio, en la MISMA transacción: si el registro no se puede
 * escribir (por ejemplo, la tabla aún no existe en ese entorno), no cambia
 * nada. Eliminar es LÓGICO: archived = 1 en chat_conversation. Los mensajes,
 * los adjuntos y lo archivado en «Archivos» se conservan, y con archived = 1
 * la bandeja de los agentes deja de entregar el hilo y sus llaves dejan de
 * poder publicar en él (assertAgentProjectConversation exige archived = 0).
 */
import { prisma } from '../prisma';
import { checkAdminPrivileges } from '../access-control';
import type { ProjectAccess, ProjectUser } from '../chat/projects';
import { ProyectoError } from './acciones';
import { normalizarTituloHilo, puedeGestionarHilo } from './hilos-rules';

/** Prisma: la tabla no existe (P2021) o SQL Server «Invalid object name» (208). */
export function esTablaAusente(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'P2021') return true;
  return typeof e.message === 'string' && /Invalid object name/i.test(e.message) && e.message.includes('chat_project_conversation_log');
}

const PENDIENTE =
  'Esta función todavía no está activa en este entorno (falta el registro de cambios). Avísele a Tecnología.';

async function hiloGestionable(user: ProjectUser, project: ProjectAccess, idConversation: unknown) {
  const id = typeof idConversation === 'number' ? idConversation : Number(idConversation);
  if (!Number.isInteger(id) || id <= 0) throw new ProyectoError('Conversación inválida.', 400);

  const conv = await prisma.chatConversation.findFirst({
    // Anclada al proyecto de la puerta: un id de otro proyecto no existe aquí.
    where: { id, kind: 'project', id_project: project.idProject, archived: false },
    select: { id: true, title: true, created_by: true },
  });
  if (!conv) throw new ProyectoError('Conversación no encontrada.', 404);

  // Al administrador solo se le pregunta si hace falta (no es dueño ni creador).
  const sinAdmin = puedeGestionarHilo({
    actorId: user.id,
    role: project.role,
    esAdmin: false,
    creadoPor: conv.created_by,
    proyectoArchivado: project.archived,
  });
  if (!sinAdmin.ok && !project.archived) {
    const esAdmin = await checkAdminPrivileges(user.email).catch(() => false);
    const conAdmin = puedeGestionarHilo({
      actorId: user.id,
      role: project.role,
      esAdmin,
      creadoPor: conv.created_by,
      proyectoArchivado: project.archived,
    });
    if (!conAdmin.ok) throw new ProyectoError(conAdmin.motivo, 403);
  } else if (!sinAdmin.ok) {
    throw new ProyectoError(sinAdmin.motivo, 403);
  }
  return conv;
}

/** Renombra una conversación del proyecto. Devuelve el título guardado. */
export async function renombrarHilo(
  user: ProjectUser,
  project: ProjectAccess,
  idConversation: unknown,
  rawTitle: unknown
): Promise<{ idConversation: number; title: string }> {
  const t = normalizarTituloHilo(rawTitle);
  if (!t.ok) throw new ProyectoError(t.error, 400);
  const conv = await hiloGestionable(user, project, idConversation);
  if ((conv.title ?? '') === t.value) return { idConversation: conv.id, title: t.value };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.chatProjectConversationLog.create({
        data: {
          id_project: project.idProject,
          id_conversation: conv.id,
          action: 'renombrar',
          title_before: conv.title,
          title_after: t.value,
          changed_by: user.id,
        },
      });
      await tx.chatConversation.update({ where: { id: conv.id }, data: { title: t.value } });
    });
  } catch (err) {
    if (esTablaAusente(err)) throw new ProyectoError(PENDIENTE, 503);
    throw err;
  }
  return { idConversation: conv.id, title: t.value };
}

/** Elimina (borrado LÓGICO) una conversación del proyecto. */
export async function eliminarHilo(
  user: ProjectUser,
  project: ProjectAccess,
  idConversation: unknown
): Promise<{ idConversation: number; eliminada: true }> {
  const conv = await hiloGestionable(user, project, idConversation);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.chatProjectConversationLog.create({
        data: {
          id_project: project.idProject,
          id_conversation: conv.id,
          action: 'eliminar',
          title_before: conv.title,
          title_after: null,
          changed_by: user.id,
        },
      });
      // updateMany con archived = false: si dos personas eliminan a la vez, la segunda no hace nada.
      await tx.chatConversation.updateMany({ where: { id: conv.id, archived: false }, data: { archived: true } });
    });
  } catch (err) {
    if (esTablaAusente(err)) throw new ProyectoError(PENDIENTE, 503);
    throw err;
  }
  return { idConversation: conv.id, eliminada: true };
}
