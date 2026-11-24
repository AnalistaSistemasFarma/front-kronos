import { NextRequest } from 'next/server';
import { jsonNoStore, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { meetingErrorResponse, projectMeetings } from '../../../../../lib/meetings/projects/links';
import { sweepProjectAnalyses } from '../../../../../lib/meetings/projects/analysis';

export const dynamic = 'force-dynamic';

const RANGES = [30, 90, 180, 365];

/**
 * GET /api/proyectos/[id]/reuniones?days=90 — «Reuniones» section (2026-11-24): the project's meetings of
 * the period with their latest analysis, the series rules and the indicators. Any member (same as linked
 * e-mails: the team sees the summary, never the transcript).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const raw = Number(request.nextUrl.searchParams.get('days'));
    const days = RANGES.includes(raw) ? raw : 90;
    await sweepProjectAnalyses(guard.project.idProject).catch(() => null);
    return jsonNoStore({ available: true, ...(await projectMeetings(guard.user, guard.project, days)) });
  } catch (error) {
    const e = meetingErrorResponse(error);
    if (e?.status === 503) return jsonNoStore({ available: false, error: e.error });
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/reuniones', error);
  }
}
