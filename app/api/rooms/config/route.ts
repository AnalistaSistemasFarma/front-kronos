import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getRoomsLevel } from '../../../../lib/rooms/access';
import {
  READ_ONLY_MESSAGE,
  environmentRooms,
  graphCredentials,
  isReadOnly,
  toPublicRooms,
} from '../../../../lib/rooms/config';
import { todayBogota } from '../../../../lib/rooms/dates';
import { errorResponse } from '../../../../lib/rooms/response';

export const dynamic = 'force-dynamic';

/**
 * Module configuration for the browser: user level, rooms (id, name and
 * window; never the mailbox), read-only mode and today's date in Bogotá.
 * Exposes no secrets.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const level = await getRoomsLevel(session.user.email);
    if (!level) return NextResponse.json({ level: null }, { headers: { 'Cache-Control': 'no-store' } });

    const rooms = environmentRooms();
    return NextResponse.json(
      {
        level,
        configured: Boolean(graphCredentials()) && rooms.length > 0,
        readOnly: isReadOnly(),
        readOnlyMessage: READ_ONLY_MESSAGE,
        today: todayBogota(),
        rooms: toPublicRooms(rooms),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return errorResponse(err, 'config');
  }
}
