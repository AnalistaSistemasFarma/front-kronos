import 'server-only';
import {
  READ_ONLY_MESSAGE,
  environmentRooms,
  graphCredentials,
  isReadOnly,
  type GraphCredentials,
  type Room,
} from './config';
import { GRAPH_TIME_ZONE, bogotaMs, isDate, todayBogota } from './dates';
import {
  calendarView,
  createEvent,
  deleteEvent,
  getEvent,
  isBusy,
  isPrivate,
  localTimes,
  type GraphEvent,
} from './graph';
import { canBook, canCancel, type RoomsLevel } from './permissions';
import {
  BookingError,
  expandDates,
  findConflicts,
  graphPattern,
  parseAttendees,
  requireWritable,
  toOccurrences,
  validateNotPast,
  validateRequest,
  validateWindow,
  type BookingRequest,
  type ExistingEvent,
} from './rules';

/**
 * Rooms module use cases (SERVER ONLY). The app/api/rooms routes resolve the
 * session and the level; everything else happens here.
 */

export interface RoomEvent {
  /** iCalUId: together with the date it identifies the occurrence. */
  id: string;
  startTime: string;
  endTime: string;
  subject: string;
  organizer: string | null;
  isPrivate: boolean;
  isSeries: boolean;
  /** The session user can cancel it (organizer or administrator). */
  cancellable: boolean;
}

export interface RoomOccupancy {
  id: string;
  name: string;
  events: RoomEvent[];
  error: string | null;
}

interface Context {
  cred: GraphCredentials;
  rooms: Room[];
}

/** Environment configuration; BookingError 503 if something is missing. */
export function getContext(): Context {
  const cred = graphCredentials();
  const rooms = environmentRooms();
  if (!cred || rooms.length === 0) {
    throw new BookingError('El módulo de salas no está configurado en este ambiente.', 503);
  }
  return { cred, rooms };
}

function roomById(rooms: Room[], id: string): Room {
  const room = rooms.find((r) => r.id === String(id ?? '').trim().toLowerCase());
  if (!room) throw new BookingError('La sala no existe.', 404);
  return room;
}

function isSeriesEvent(e: GraphEvent): boolean {
  const t = (e.type ?? '').toLowerCase();
  return t === 'occurrence' || t === 'exception' || t === 'seriesmaster' || Boolean(e.seriesMasterId);
}

function organizerEmail(e: GraphEvent): string {
  return (e.organizer?.emailAddress?.address ?? '').trim().toLowerCase();
}

/** Event as shown for the day: clipped if it starts before or ends after it. */
function toRoomEvent(e: GraphEvent, day: string, sessionEmail: string, level: RoomsLevel | null): RoomEvent {
  const t = localTimes(e);
  const priv = isPrivate(e);
  return {
    id: e.iCalUId ?? e.id,
    startTime: t.date < day ? '00:00' : t.startTime,
    endTime: t.endDate > day ? '24:00' : t.endTime,
    subject: priv ? 'Ocupado' : (e.subject ?? '').trim() || '(sin asunto)',
    organizer: priv ? null : e.organizer?.emailAddress?.name?.trim() || null,
    isPrivate: priv,
    isSeries: isSeriesEvent(e),
    cancellable: Boolean(e.iCalUId) && canCancel(level, sessionEmail, organizerEmail(e)),
  };
}

/** Occupancy of every room for a day. If one room fails, the others are still shown. */
export async function getDayOccupancy(
  date: string,
  sessionEmail: string,
  level: RoomsLevel | null
): Promise<RoomOccupancy[]> {
  if (!isDate(date)) throw new BookingError('La fecha no es válida.');
  const { cred, rooms } = getContext();
  return Promise.all(
    rooms.map(async (room) => {
      try {
        const events = (await calendarView(cred, room.mailbox, date))
          .filter(isBusy)
          .map((e) => toRoomEvent(e, date, sessionEmail, level))
          .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
        return { id: room.id, name: room.name, events, error: null };
      } catch (err) {
        console.error(`[rooms] occupancy of ${room.id}:`, err instanceof Error ? err.message : err);
        return { id: room.id, name: room.name, events: [], error: 'No se pudo leer el calendario de esta sala.' };
      }
    })
  );
}

function toExisting(e: GraphEvent): ExistingEvent {
  const t = localTimes(e);
  return {
    startMs: bogotaMs(t.date, t.startTime),
    endMs: bogotaMs(t.endDate, t.endTime),
    subject: isPrivate(e) ? 'Ocupado' : (e.subject ?? '').trim() || '(sin asunto)',
    date: t.date,
    startTime: t.startTime,
    endTime: t.endTime,
  };
}

function eventBody(
  r: BookingRequest,
  room: Room,
  attendees: string[],
  date: string,
  pattern: Record<string, unknown> | null,
  until: string | null
): Record<string, unknown> {
  return {
    subject: r.subject.trim(),
    start: { dateTime: `${date}T${r.startTime}:00`, timeZone: GRAPH_TIME_ZONE },
    end: { dateTime: `${date}T${r.endTime}:00`, timeZone: GRAPH_TIME_ZONE },
    location: { displayName: room.name, locationEmailAddress: room.mailbox, locationType: 'conferenceRoom' },
    attendees: [
      { type: 'resource', emailAddress: { address: room.mailbox, name: room.name } },
      ...attendees
        .filter((a) => a !== room.mailbox)
        .map((a) => ({ type: 'required', emailAddress: { address: a } })),
    ],
    ...(pattern && until
      ? {
          recurrence: {
            pattern,
            range: { type: 'endDate', startDate: date, endDate: until, recurrenceTimeZone: GRAPH_TIME_ZONE },
          },
        }
      : {}),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Room's response (accepted/declined/none…) to an organizer's event. */
async function roomResponse(cred: GraphCredentials, organizer: string, id: string, mailbox: string) {
  const ev = await getEvent(cred, organizer, id);
  const room = (ev.attendees ?? []).find((a) => (a.emailAddress?.address ?? '').toLowerCase() === mailbox);
  return (room?.status?.response ?? 'none').toLowerCase();
}

export interface BookingResult {
  created: number;
  pendingConfirmation: boolean;
}

/**
 * Creates a single or recurring booking in the SESSION USER's calendar (never
 * an organizer sent by the client), with the room as a resource attendee.
 * Everything is validated before writing: fields, 1-year cap, booking window,
 * conflicts across the whole series and read-only mode.
 */
export async function createBooking(
  sessionEmail: string,
  level: RoomsLevel | null,
  r: BookingRequest,
  now: Date = new Date()
): Promise<BookingResult> {
  if (!canBook(level)) throw new BookingError('No tiene permiso para reservar salas.', 403);
  validateRequest(r);
  const { cred, rooms } = getContext();
  const room = roomById(rooms, r.roomId);
  const attendees = parseAttendees(r.attendees);
  const dates = expandDates(r.date, r.recurrence ?? { type: 'none' });
  const occ = toOccurrences(dates, r.startTime, r.endTime);
  validateNotPast(occ, now.getTime());
  validateWindow(dates, todayBogota(now), room.windowDays, room.name);

  const existing = (await calendarView(cred, room.mailbox, dates[0], dates[dates.length - 1]))
    .filter(isBusy)
    .map(toExisting);
  const conflicts = findConflicts(occ, existing);
  if (conflicts.length > 0) {
    throw new BookingError(
      dates.length > 1
        ? `La sala ya está ocupada en ${new Set(conflicts.map((c) => c.date)).size} de las fechas de la serie. No se creó nada.`
        : 'La sala ya está ocupada en ese horario.',
      409,
      { code: 'CONFLICT', conflicts: conflicts.slice(0, 100) }
    );
  }

  requireWritable(isReadOnly(), READ_ONLY_MESSAGE);

  const organizer = sessionEmail.trim().toLowerCase();
  const type = r.recurrence?.type ?? 'none';
  const pattern = type === 'none' || type === 'specific' ? null : graphPattern(r.date, r.recurrence);
  const bodies = pattern
    ? [eventBody(r, room, attendees, r.date, pattern, r.recurrence.until ?? null)]
    : dates.map((d) => eventBody(r, room, attendees, d, null, null));

  const createdIds: string[] = [];
  const rollback = async () => {
    for (const id of createdIds) {
      try {
        await deleteEvent(cred, organizer, id);
      } catch (err) {
        console.error('[rooms] could not roll back an event:', err instanceof Error ? err.message : err);
      }
    }
  };

  try {
    for (const body of bodies) {
      const ev = await createEvent(cred, organizer, body);
      createdIds.push(ev.id);
    }
  } catch (err) {
    await rollback();
    throw err;
  }

  // The room answers within seconds (auto-accept). If it declines, everything is rolled back.
  let pending = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(2000);
    const responses = await Promise.all(
      createdIds.slice(0, 5).map((id) => roomResponse(cred, organizer, id, room.mailbox).catch(() => 'none'))
    );
    if (responses.some((s) => s === 'declined')) {
      await rollback();
      throw new BookingError(
        `${room.name} rechazó la reserva (puede ser por la ventana de reserva o un cruce). Se deshizo todo; no quedó nada creado.`,
        409,
        { code: 'DECLINED' }
      );
    }
    pending = responses.some((s) => s !== 'accepted');
    if (!pending) break;
  }
  return { created: createdIds.length, pendingConfirmation: pending };
}

/**
 * Cancels «this day only» or «the whole series». The occurrence is identified
 * by iCalUId + date and looked up in the ORGANIZER's calendarView
 * (GET /events?$filter=iCalUId does not return series occurrences).
 */
export async function cancelBooking(
  sessionEmail: string,
  level: RoomsLevel | null,
  params: { roomId: string; iCalUId: string; date: string; scope: 'day' | 'series' }
): Promise<void> {
  if (!level) throw new BookingError('No tiene acceso al módulo de salas.', 403);
  if (!isDate(params.date)) throw new BookingError('La fecha no es válida.');
  if (!params.iCalUId) throw new BookingError('Falta la reunión.');
  const { cred, rooms } = getContext();
  const room = roomById(rooms, params.roomId);

  const inRoom = (await calendarView(cred, room.mailbox, params.date)).find((e) => e.iCalUId === params.iCalUId);
  if (!inRoom) throw new BookingError('No se encontró la reunión en la sala para esa fecha.', 404);
  const organizer = organizerEmail(inRoom);
  if (!organizer || !canCancel(level, sessionEmail, organizer)) {
    throw new BookingError('Solo el organizador o un administrador del módulo puede cancelar esta reunión.', 403);
  }

  requireWritable(isReadOnly(), READ_ONLY_MESSAGE);

  const own = (await calendarView(cred, organizer, params.date)).find((e) => e.iCalUId === params.iCalUId);
  if (!own) throw new BookingError('No se encontró la reunión en el calendario del organizador.', 404);
  const id = params.scope === 'series' && own.seriesMasterId ? own.seriesMasterId : own.id;
  await deleteEvent(cred, organizer, id);
}
