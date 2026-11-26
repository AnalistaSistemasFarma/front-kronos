import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, serverError } from '../../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { meetingErrorResponse, unlinkMeeting } from '../../../../../../../lib/meetings/projects/links';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; linkId: string }> };

/** DELETE — removes a meeting from the project (whoever assigned it or the owner). Its analyses go with it. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { id, linkId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const n = Number.parseInt(linkId, 10);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== linkId) return badRequest('Reunión inválida.');
    await unlinkMeeting(guard.user, guard.project, n);
    return jsonNoStore({ ok: true });
  } catch (error) {
    const e = meetingErrorResponse(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('DELETE /api/proyectos/[id]/vinculos/reuniones/[linkId]', error);
  }
}
