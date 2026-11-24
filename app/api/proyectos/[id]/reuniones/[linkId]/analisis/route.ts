import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, serverError } from '../../../../../../../lib/chat/http';
import { archivedProject, guardProject } from '../../../../../../../lib/chat/projects-guard';
import { meetingErrorResponse } from '../../../../../../../lib/meetings/projects/links';
import { getAnalysis, requestAnalysis } from '../../../../../../../lib/meetings/projects/analysis';

export const dynamic = 'force-dynamic';

/**
 * Analysis of a project meeting by the project's agent (2026-11-24, lib/meetings/projects/analysis.ts).
 *
 *   GET   latest analysis, filtered by who asks (participation by person only for attendees).
 *   POST  asks for a new one. Only an ATTENDEE (the meeting is in their calendar) who is owner or editor
 *         and can write to the project's agent. On demand: nothing runs on its own.
 */
type Ctx = { params: Promise<{ id: string; linkId: string }> };

function parseLinkId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === raw ? n : null;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id, linkId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const n = parseLinkId(linkId);
    if (!n) return badRequest('Reunión inválida.');
    return jsonNoStore({ analysis: await getAnalysis(guard.user, guard.project, n) });
  } catch (error) {
    const e = meetingErrorResponse(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/reuniones/[linkId]/analisis', error);
  }
}

export async function POST(_request: NextRequest, { params }: Ctx) {
  try {
    const { id, linkId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();
    const n = parseLinkId(linkId);
    if (!n) return badRequest('Reunión inválida.');
    return jsonNoStore(await requestAnalysis(guard.user, guard.project, n), { status: 202 });
  } catch (error) {
    const e = meetingErrorResponse(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/reuniones/[linkId]/analisis', error);
  }
}
