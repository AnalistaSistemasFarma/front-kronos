import { errorResponse, json, sessionEmail } from '../../../../lib/meetings/http';
import { meetingTranscript } from '../../../../lib/meetings/service';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_=+/-]{10,512}$/;

/**
 * GET /api/meetings/transcript?id=<event id> — transcript of ONE meeting of
 * the session user. The event is re-read from the session mailbox, so an id of
 * someone else's calendar answers 404.
 */
export async function GET(req: Request) {
  try {
    const email = await sessionEmail();
    if (typeof email !== 'string') return email;
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!ID_RE.test(id)) return json({ error: 'La reunión no es válida.' }, 400);
    return json({ enabled: true, ...(await meetingTranscript(email, id)) });
  } catch (err) {
    return errorResponse(err, 'transcript');
  }
}
