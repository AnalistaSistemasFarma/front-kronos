import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getRoomsLevel } from '../../../../../lib/rooms/access';
import { errorResponse } from '../../../../../lib/rooms/response';
import { cancelBooking } from '../../../../../lib/rooms/service';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/rooms/bookings/{iCalUId}?room=&date=YYYY-MM-DD&scope=day|series
 * Only the organizer or a module administrator (403 for everyone else).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const level = await getRoomsLevel(session.user.email);
    await cancelBooking(session.user.email, level, {
      roomId: q.get('room') ?? '',
      iCalUId: String(id ?? '').slice(0, 1000),
      date: q.get('date') ?? '',
      scope: q.get('scope') === 'series' ? 'series' : 'day',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 'cancel booking');
  }
}
