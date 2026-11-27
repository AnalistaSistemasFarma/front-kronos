import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, serverError } from '../../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { meetingErrorResponse } from '../../../../../../../lib/meetings/projects/links';
import { transcriptForMember } from '../../../../../../../lib/meetings/projects/analysis';

export const dynamic = 'force-dynamic';

/**
 * GET — transcript and participation by person of a project meeting, ONLY for a member who attended
 * (the meeting is in their own calendar). Read live from Teams with their mailbox; never stored.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  try {
    const { id, linkId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const n = Number.parseInt(linkId, 10);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== linkId) return badRequest('Reunión inválida.');
    return jsonNoStore(await transcriptForMember(guard.user, guard.project, n));
  } catch (error) {
    const e = meetingErrorResponse(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/reuniones/[linkId]/transcripcion', error);
  }
}
