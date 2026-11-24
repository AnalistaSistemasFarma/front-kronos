import { parseRange } from '../../../../lib/meetings/config';
import { errorResponse, json, sessionEmail } from '../../../../lib/meetings/http';
import { meetingsAnalysis } from '../../../../lib/meetings/service';

export const dynamic = 'force-dynamic';

/** GET /api/meetings/analysis?days=30 — real start/duration and transcripts of the session user's Teams meetings. */
export async function GET(req: Request) {
  try {
    const email = await sessionEmail();
    if (typeof email !== 'string') return email;
    const days = parseRange(new URL(req.url).searchParams.get('days'));
    return json({ enabled: true, ...(await meetingsAnalysis(email, days)) });
  } catch (err) {
    return errorResponse(err, 'analysis');
  }
}
