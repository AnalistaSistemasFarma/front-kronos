import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { isProjectMuted, setProjectMuted } from '../../../../../lib/proyectos/mute';

export const dynamic = 'force-dynamic';

/**
 * «Silenciar notificaciones» of ONE project for the person in session
 * (2026-11-23, msg 38059). See lib/proyectos/mute.ts for what a mute does.
 *
 *   GET    { muted }
 *   PATCH  { muted: boolean } → { muted }
 *
 * Any member can do it (owner, editor or reader): it only changes what THAT
 * person receives, never the others. The gate is the project one
 * (guardProject: member + module in the project's company + not archived).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    return jsonNoStore({ muted: await isProjectMuted(guard.project.idProject, guard.user.id) });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/notificaciones', error);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;

    const payload = await readJsonBody(request);
    if (!payload || typeof payload.muted !== 'boolean') return badRequest('Indique muted: true o false.');

    await setProjectMuted(guard.project.idProject, guard.user.id, payload.muted);
    return jsonNoStore({ muted: payload.muted });
  } catch (error) {
    return serverError('PATCH /api/proyectos/[id]/notificaciones', error);
  }
}
