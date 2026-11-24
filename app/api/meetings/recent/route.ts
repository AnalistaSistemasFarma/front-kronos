import { errorResponse, json, sessionEmail } from '../../../../lib/meetings/http';
import { recentMeetings } from '../../../../lib/meetings/service';

export const dynamic = 'force-dynamic';

/** GET /api/meetings/recent — last meetings of the session user (header icon). */
export async function GET() {
  try {
    const email = await sessionEmail();
    if (typeof email !== 'string') return email;
    return json({ enabled: true, meetings: await recentMeetings(email) });
  } catch (err) {
    return errorResponse(err, 'recent');
  }
}
