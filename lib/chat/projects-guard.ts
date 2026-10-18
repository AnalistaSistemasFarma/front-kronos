/**
 * Guardia de las rutas /api/proyectos/[id]/** — sesión + puerta del proyecto
 * en tres líneas, igual que guardConversation (lib/chat/http.ts).
 *
 * Responde 404 (y no 403) cuando la persona no puede entrar: no se le
 * confirma a quien sondea ids que el proyecto existe.
 */
import type { NextResponse } from 'next/server';
import { badRequest, forbidden, jsonNoStore, resolveSessionUser, unauthorized, type ChatSessionUser } from './http';
import { resolveProjectForUser, type ProjectAccess } from './projects';

export type ProjectGuard = { response: NextResponse } | { user: ChatSessionUser; project: ProjectAccess };

export function notFoundProject(): NextResponse {
  return jsonNoStore({ error: 'Proyecto no encontrado.' }, { status: 404 });
}

/** Proyecto archivado: solo su dueño lo ve, y no se escribe en él. */
export function archivedProject(): NextResponse {
  return forbidden('El proyecto está archivado. Restáurelo para hacer cambios.');
}

export async function guardProject(rawId: string, opciones: { allowArchived?: boolean } = {}): Promise<ProjectGuard> {
  const user = await resolveSessionUser();
  if (!user) return { response: unauthorized() };

  const idProject = Number.parseInt(rawId, 10);
  if (!Number.isInteger(idProject) || idProject <= 0 || String(idProject) !== rawId.trim()) {
    return { response: badRequest('Id de proyecto inválido.') };
  }

  const project = await resolveProjectForUser(user, idProject, opciones);
  if (!project) return { response: notFoundProject() };
  return { user, project };
}
