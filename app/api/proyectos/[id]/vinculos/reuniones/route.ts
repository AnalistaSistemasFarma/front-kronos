import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { archivedProject, guardProject } from '../../../../../../lib/chat/projects-guard';
import { normalizeLinkSummary } from '../../../../../../lib/chat/projects-rules';
import { linkMeeting, meetingErrorResponse } from '../../../../../../lib/meetings/projects/links';
import { parseLinkInput } from '../../../../../../lib/meetings/projects/rules';

export const dynamic = 'force-dynamic';

/**
 * MEETINGS of the project (2026-11-24, lib/meetings/projects/links.ts).
 *
 *   POST { eventId, applyToSeries?, summary?, origin? }  assigns a meeting of the SESSION calendar to the
 *        project (owner or editor, with the meetings module). The event is read again on the server: an
 *        id from another calendar gives 404. Private/confidential meetings are refused. With
 *        applyToSeries the next occurrences of the series go to the project on their own.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const input = parseLinkInput(payload);
    if (!input.ok) return badRequest(input.error);
    const summary = normalizeLinkSummary(payload.summary);
    if (!summary.ok) return badRequest(summary.error);

    const r = await linkMeeting(guard.user, guard.project, input.value, summary.value);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = meetingErrorResponse(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/vinculos/reuniones', error);
  }
}
