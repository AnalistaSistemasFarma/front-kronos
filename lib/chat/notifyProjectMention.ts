/**
 * Notification for a @person mention in a project conversation (2026-11-26, see
 * lib/proyectos/menciones-personas.ts). Push + bell, even if the person muted the project.
 * Never throws: the message is already published.
 */
import { prisma } from '../prisma';
import { createAndSendNotifications } from '../notifications.js';
import type { PersonaMencionable } from '../proyectos/menciones-personas';

const MAX_BODY_CHARS = 140;

/** Active members of a project with an email (who can be mentioned). Empty on error. */
export async function personasDelProyecto(idProject: number): Promise<PersonaMencionable[]> {
  try {
    const filas = await prisma.chatProjectMember.findMany({
      where: { id_project: idProject },
      select: { id_user: true, user: { select: { name: true, email: true, isActive: true } } },
    });
    return filas
      .filter((f) => f.user.isActive && (f.user.email ?? '').trim().length > 0)
      .map((f) => ({ idUser: f.id_user, name: f.user.name?.trim() || (f.user.email ?? ''), email: (f.user.email ?? '').trim() }));
  } catch (error) {
    console.error('[proyectos/menciones] could not read the members:', error);
    return [];
  }
}

function resumen(body: string): string {
  const t = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_BODY_CHARS ? `${t.slice(0, MAX_BODY_CHARS - 1)}…` : t || 'Lo mencionaron en una conversación del proyecto.';
}

export async function notifyProjectMention(input: {
  idProject: number;
  idConversation: number;
  projectName: string | null;
  authorName: string;
  emails: string[];
  body: string;
  icon?: string | null;
}): Promise<void> {
  try {
    const emails = [...new Set(input.emails.map((e) => e.trim()).filter((e) => e.length > 0))];
    if (emails.length === 0) return;
    await createAndSendNotifications(emails, {
      title: `${input.authorName} lo mencionó · ${input.projectName?.trim() || 'Proyecto'}`,
      body: resumen(input.body),
      url: `/process/proyectos/${input.idProject}?conversacion=${input.idConversation}`,
      tag: `proyecto-mencion-${input.idConversation}`,
      icon: input.icon ?? undefined,
    });
  } catch (error) {
    console.error('[proyectos/menciones] could not notify the mention:', error);
  }
}
