import { errorResponse, json } from '../../../../../lib/meetings/http';
import { resolveSessionUser } from '../../../../../lib/chat/http';
import { deleteRule, meetingErrorResponse } from '../../../../../lib/meetings/projects/links';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ ruleId: string }> };

/** DELETE /api/meetings/rules/[ruleId] — removes a «whole series» rule (its creator or the project owner). */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await resolveSessionUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const { ruleId } = await params;
    const id = Number.parseInt(ruleId, 10);
    if (!Number.isInteger(id) || id <= 0 || String(id) !== ruleId) return json({ error: 'Regla inválida.' }, 400);
    await deleteRule(user, id);
    return json({ ok: true });
  } catch (err) {
    const e = meetingErrorResponse(err);
    if (e) return json({ error: e.error }, e.status);
    return errorResponse(err, 'delete rule');
  }
}
