import { NextRequest, NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../../lib/mssqlPool';
import { resolveSessionUser } from '../../../../../lib/chat/http';
import { replyToNotification, type SqlPoolLike, type SqlTypes } from '../../../../../lib/notifications/replyToNotification';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/:id/reply  { body: string }
 *
 * Quick reply from a bell notification card (2026-11-24): adds a note to the request or ticket the
 * notification points to. Author = session user; the notification must be the user's own; the
 * target comes from the stored URL. See lib/notifications/replyToNotification.ts.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const { id } = await params;
    const payload = (await request.json().catch(() => null)) as { body?: unknown } | null;
    const result = await withMssqlPool((pool) =>
      replyToNotification(pool as unknown as SqlPoolLike, sql as unknown as SqlTypes, user, Number(id), payload?.body)
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[POST /api/notifications/:id/reply]', error);
    return NextResponse.json({ error: 'No se pudo guardar la nota.' }, { status: 500 });
  }
}
