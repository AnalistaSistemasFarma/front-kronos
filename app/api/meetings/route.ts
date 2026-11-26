import { parseRange } from '../../../lib/meetings/config';
import { errorResponse, json, sessionEmail } from '../../../lib/meetings/http';
import { meetingsOverview } from '../../../lib/meetings/service';

export const dynamic = 'force-dynamic';

/** GET /api/meetings?days=30 — meetings of the session user in the period, summary vs previous period and weekly trend. */
export async function GET(req: Request) {
  try {
    const email = await sessionEmail();
    if (typeof email !== 'string') return email;
    const days = parseRange(new URL(req.url).searchParams.get('days'));
    return json({ enabled: true, ...(await meetingsOverview(email, days)) });
  } catch (err) {
    return errorResponse(err, 'overview');
  }
}
