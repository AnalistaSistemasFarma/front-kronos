import { parseRange } from '../../../../lib/meetings/config';
import { errorResponse, json, sessionEmail } from '../../../../lib/meetings/http';
import { resolveSessionUser } from '../../../../lib/chat/http';
import { meetingErrorResponse, meetingsProjectsView } from '../../../../lib/meetings/projects/links';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meetings/projects?days=30 — «Proyecto» column of "Mis reuniones" (2026-11-24): the project
 * each meeting of the SESSION calendar is assigned to, the simple suggestion (no AI) and the series
 * rule, plus the projects where the person can assign (owner or editor). Separate from /api/meetings
 * on purpose: if the project tables are missing, "Mis reuniones" keeps working ({ available: false }).
 */
export async function GET(req: Request) {
  try {
    const email = await sessionEmail();
    if (typeof email !== 'string') return email;
    const user = await resolveSessionUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const days = parseRange(new URL(req.url).searchParams.get('days'));
    return json({ available: true, ...(await meetingsProjectsView(user, days)) });
  } catch (err) {
    const e = meetingErrorResponse(err);
    if (e?.status === 503) return json({ available: false, error: e.error, projects: [], items: {} });
    if (e) return json({ error: e.error }, e.status);
    return errorResponse(err, 'projects');
  }
}
