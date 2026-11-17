import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getRoomsLevel } from '../../../../lib/rooms/access';
import { errorResponse } from '../../../../lib/rooms/response';
import type { BookingRequest, Recurrence } from '../../../../lib/rooms/rules';
import { createBooking } from '../../../../lib/rooms/service';

export const dynamic = 'force-dynamic';

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function parseRecurrence(v: unknown): Recurrence {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const types = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'specific'] as const;
  const type = types.find((t) => t === r.type) ?? 'none';
  return {
    type,
    weekdaysOnly: r.weekdaysOnly === true,
    daysOfWeek: Array.isArray(r.daysOfWeek)
      ? r.daysOfWeek.filter((d): d is number => Number.isInteger(d)).slice(0, 7)
      : undefined,
    until: str(r.until, 10) || undefined,
    dates: Array.isArray(r.dates) ? r.dates.map((d) => str(d, 10)).slice(0, 400) : undefined,
  };
}

/**
 * POST /api/rooms/bookings — creates a single or recurring booking.
 * The organizer is ALWAYS the session user: the body does not carry it.
 * 409 on conflicts (with details) or if the room declines; 423 in read-only mode.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const level = await getRoomsLevel(session.user.email);
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Solicitud no válida.' }, { status: 400 });
    }
    const request: BookingRequest = {
      roomId: str(body.roomId, 100),
      date: str(body.date, 10),
      startTime: str(body.startTime, 5),
      endTime: str(body.endTime, 5),
      subject: str(body.subject, 300),
      attendees: str(body.attendees, 5000),
      recurrence: parseRecurrence(body.recurrence),
    };
    const result = await createBooking(session.user.email, level, request);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'create booking');
  }
}
