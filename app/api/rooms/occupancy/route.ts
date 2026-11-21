import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getRoomsLevel } from '../../../../lib/rooms/access';
import { isDate, todayBogota } from '../../../../lib/rooms/dates';
import { errorResponse } from '../../../../lib/rooms/response';
import { getDayOccupancy } from '../../../../lib/rooms/service';

export const dynamic = 'force-dynamic';

/** GET /api/rooms/occupancy?date=YYYY-MM-DD — each room's schedule for the day (private events as «Ocupado»). */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const level = await getRoomsLevel(session.user.email);
    if (!level) return NextResponse.json({ error: 'No tiene acceso al módulo de salas.' }, { status: 403 });

    const date = new URL(req.url).searchParams.get('date') ?? todayBogota();
    if (!isDate(date)) return NextResponse.json({ error: 'La fecha no es válida.' }, { status: 400 });

    const rooms = await getDayOccupancy(date, session.user.email, level);
    return NextResponse.json({ date, rooms }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err, 'occupancy');
  }
}
