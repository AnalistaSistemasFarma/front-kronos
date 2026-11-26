/**
 * «SILENCIAR NOTIFICACIONES» of a project, per person (2026-11-23, Nicolás
 * Rivera, SynerLink msg 38059: «en los proyectos ayúdame a poder tener un
 * botón de silenciar notificaciones»).
 *
 * What a mute does (only for the person who muted; the other members do not
 * notice anything):
 *   - no push to the device when an agent replies in that project (including
 *     the synthesis of a discussion table);
 *   - no in-app message sound for that project (the chat pulse marks the event
 *     as `muted`);
 *   - the project does not count in the header «Proyectos» icon.
 * What it does NOT do: messages are still written and still show as unread
 * inside the project, so nothing is lost. Exception (2026-11-26): a direct
 * @mention of the person (lib/proyectos/menciones-personas.ts) is notified
 * even when muted, like a muted chat in Teams.
 *
 * Storage: one row in chat_project_mute per (project, person). No row = on.
 *
 * Fail open: if reading the mutes fails (e.g. the table does not exist yet
 * because the code shipped before the DDL), everybody keeps getting
 * notifications exactly as before. Losing a notification is worse than
 * getting one you had muted.
 */
import { prisma } from '../prisma';

function isDuplicate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** Ids of the projects this person muted. Empty set on any error (fail open). */
export async function mutedProjectIds(userId: string): Promise<Set<number>> {
  try {
    const rows = await prisma.chatProjectMute.findMany({ where: { id_user: userId }, select: { id_project: true } });
    return new Set(rows.map((r) => r.id_project));
  } catch (error) {
    console.error('[proyectos/mute] could not read the muted projects:', error);
    return new Set();
  }
}

/** Did this person mute this project? false on any error (fail open). */
export async function isProjectMuted(idProject: number, userId: string): Promise<boolean> {
  try {
    const row = await prisma.chatProjectMute.findUnique({
      where: { id_project_id_user: { id_project: idProject, id_user: userId } },
      select: { id_project_mute: true },
    });
    return row !== null;
  } catch (error) {
    console.error('[proyectos/mute] could not read the mute:', error);
    return false;
  }
}

/** Ids of the members who muted this project. Empty set on any error (fail open). */
export async function projectMutedUserIds(idProject: number): Promise<Set<string>> {
  try {
    const rows = await prisma.chatProjectMute.findMany({ where: { id_project: idProject }, select: { id_user: true } });
    return new Set(rows.map((r) => r.id_user));
  } catch (error) {
    console.error('[proyectos/mute] could not read the project mutes:', error);
    return new Set();
  }
}

/**
 * Push recipients of a project: active members with an email, minus the ones
 * who muted it. Pure, so the rule is tested without a database.
 */
export function projectPushRecipients(
  members: { id_user: string; user: { email: string | null; isActive: boolean } }[],
  muted: Set<string>
): string[] {
  return members
    .filter((m) => m.user.isActive && !muted.has(m.id_user))
    .map((m) => (m.user.email ?? '').trim())
    .filter((e) => e.length > 0);
}

/**
 * Mutes or unmutes a project for this person. Idempotent: muting twice keeps
 * one row (two tabs at once hit the unique index, which is fine), unmuting
 * something not muted does nothing. Errors propagate: the route reports them.
 */
export async function setProjectMuted(idProject: number, userId: string, muted: boolean): Promise<void> {
  if (!muted) {
    await prisma.chatProjectMute.deleteMany({ where: { id_project: idProject, id_user: userId } });
    return;
  }
  try {
    await prisma.chatProjectMute.create({ data: { id_project: idProject, id_user: userId } });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
  }
}
