import { describe, expect, it } from 'vitest';
import { READ_ONLY_MESSAGE, isReadOnly, parseRooms, toPublicRooms } from '../config';
import { addYears, bogotaMs, dayRange, formatTime12h, isDate, timeOptions, todayBogota } from '../dates';
import { canCancel, isRoomsMarkerSubprocess, levelFromUrls } from '../permissions';
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
  type ExistingEvent,
} from '../rules';

function catchError(fn: () => unknown): BookingError {
  try {
    fn();
  } catch (e) {
    if (e instanceof BookingError) return e;
    throw e;
  }
  throw new Error('did not throw');
}

describe('dates', () => {
  it('validates real dates', () => {
    expect(isDate('2026-11-17')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('17/11/2026')).toBe(false);
  });
  it('today in Bogotá honors the -05:00 offset', () => {
    expect(todayBogota(new Date('2026-11-18T03:00:00Z'))).toBe('2026-11-17');
    expect(todayBogota(new Date('2026-11-18T05:00:00Z'))).toBe('2026-11-18');
  });
  it('calendarView range carries the -05:00 offset', () => {
    expect(dayRange('2026-11-17')).toEqual({
      start: '2026-11-17T00:00:00-05:00',
      end: '2026-11-18T00:00:00-05:00',
    });
  });
  it('formats times in Colombian 12-hour style', () => {
    expect(formatTime12h('08:30')).toBe('8:30 a. m.');
    expect(formatTime12h('00:00')).toBe('12:00 a. m.');
    expect(formatTime12h('12:00')).toBe('12:00 p. m.');
    expect(formatTime12h('13:45')).toBe('1:45 p. m.');
    expect(formatTime12h('24:00')).toBe('12:00 a. m.');
  });
  it('time options every 15 minutes keep HH:mm values with 12-hour labels', () => {
    const options = timeOptions(15);
    expect(options).toHaveLength(96);
    expect(options[34]).toEqual({ value: '08:30', label: '8:30 a. m.' });
  });
  it('Feb 29 + 1 year becomes Feb 28', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
  });
});

describe('room configuration', () => {
  const raw =
    'salaadm1@gsslatam.com|Sala administrativa 1;quietroom@gsslatam.com|Quiet Room;invitados1@gsslatam.com|Sala invitados 1|30;bad|X';
  it('parses SALAS_ROOMS with default, known and explicit windows', () => {
    expect(parseRooms(raw).map((r) => [r.id, r.windowDays])).toEqual([
      ['salaadm1', 15],
      ['quietroom', 10],
      ['invitados1', 30],
    ]);
  });
  it('SALAS_VENTANA_DIAS can widen the window (e.g. to 365)', () => {
    const rooms = parseRooms(raw, 'quietroom@gsslatam.com|365');
    expect(rooms.find((r) => r.id === 'quietroom')?.windowDays).toBe(365);
  });
  it('public view does not expose the mailbox', () => {
    expect(JSON.stringify(toPublicRooms(parseRooms(raw)))).not.toContain('@');
  });
});

describe('permissions', () => {
  it('takes the highest level', () => {
    expect(levelFromUrls(['/process/salas'])).toBe('view');
    expect(levelFromUrls(['/process/salas', '/process/salas/reservar'])).toBe('book');
    expect(levelFromUrls(['/process/salas/admin/'])).toBe('admin');
    expect(levelFromUrls(['/process/other'])).toBeNull();
  });
  it('the organizer with booking permission, or an admin, can cancel', () => {
    expect(canCancel('book', 'a@gss.com', 'A@gss.com')).toBe(true);
    expect(canCancel('book', 'a@gss.com', 'b@gss.com')).toBe(false);
    expect(canCancel('view', 'a@gss.com', 'a@gss.com')).toBe(false);
    expect(canCancel('admin', 'a@gss.com', 'b@gss.com')).toBe(true);
  });
  it('markers are hidden from the hub', () => {
    expect(isRoomsMarkerSubprocess({ subprocess_url: '/process/salas/reservar' })).toBe(true);
    expect(isRoomsMarkerSubprocess({ subprocess_url: '/process/salas/admin' })).toBe(true);
    expect(isRoomsMarkerSubprocess({ subprocess_url: '/process/salas' })).toBe(false);
  });
});

describe('request and attendees', () => {
  const base = {
    roomId: 'salaadm1',
    date: '2026-11-20',
    startTime: '09:00',
    endTime: '10:00',
    subject: 'Comité',
    attendees: '',
    recurrence: { type: 'none' as const },
  };
  it('end must be after start', () => {
    expect(catchError(() => validateRequest({ ...base, endTime: '09:00' })).message).toMatch(/posterior/);
  });
  it('comma-separated attendees, de-duplicated', () => {
    expect(parseAttendees('a@gss.com, B@gss.com ,a@gss.com')).toEqual(['a@gss.com', 'b@gss.com']);
  });
  it('rejects invalid emails and semicolons', () => {
    expect(() => parseAttendees('a@gss.com; b@gss.com')).toThrow(BookingError);
    expect(() => parseAttendees('not-an-email')).toThrow(/no válido/);
  });
});

describe('series expansion', () => {
  it('single: one date', () => {
    expect(expandDates('2026-11-20', { type: 'none' })).toEqual(['2026-11-20']);
  });
  it('daily Monday to Friday skips the weekend', () => {
    expect(expandDates('2026-11-20', { type: 'daily', weekdaysOnly: true, until: '2026-11-24' })).toEqual([
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
    ]);
  });
  it('daily every day', () => {
    expect(expandDates('2026-11-20', { type: 'daily', until: '2026-11-22' })).toHaveLength(3);
  });
  it('weekly on several days', () => {
    // 2026-11-16 is a Monday
    expect(expandDates('2026-11-16', { type: 'weekly', daysOfWeek: [1, 3], until: '2026-11-25' })).toEqual([
      '2026-11-16',
      '2026-11-18',
      '2026-11-23',
      '2026-11-25',
    ]);
  });
  it('monthly skips months without that day (like Graph)', () => {
    expect(expandDates('2027-01-31', { type: 'monthly', until: '2027-05-31' })).toEqual([
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
    ]);
  });
  it('yearly within one year: only the first', () => {
    expect(expandDates('2026-11-20', { type: 'yearly', until: '2027-11-19' })).toEqual(['2026-11-20']);
  });
  it('specific days: sorted, unique and including the start date', () => {
    expect(
      expandDates('2026-11-20', { type: 'specific', dates: ['2026-12-01', '2026-11-25', '2026-12-01'] })
    ).toEqual(['2026-11-20', '2026-11-25', '2026-12-01']);
  });
  it('1-year cap from the first date', () => {
    expect(expandDates('2026-11-20', { type: 'daily', until: '2027-11-19' })).toHaveLength(365);
    const e = catchError(() => expandDates('2026-11-20', { type: 'daily', until: '2027-11-20' }));
    expect(e.message).toMatch(/1 año.*2027-11-19/);
    expect(() => expandDates('2026-11-20', { type: 'specific', dates: ['2027-12-01'] })).toThrow(/1 año/);
  });
  it('requires an end date after the start', () => {
    expect(() => expandDates('2026-11-20', { type: 'weekly' })).toThrow(/hasta qué fecha/);
    expect(() => expandDates('2026-11-20', { type: 'weekly', until: '2026-11-01' })).toThrow(/posterior/);
  });
  it('Graph pattern', () => {
    expect(graphPattern('2026-11-20', { type: 'daily', weekdaysOnly: true })).toMatchObject({
      type: 'weekly',
      daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });
    expect(graphPattern('2026-11-20', { type: 'yearly' })).toEqual({
      type: 'absoluteYearly',
      interval: 1,
      dayOfMonth: 20,
      month: 11,
    });
    expect(graphPattern('2026-11-20', { type: 'specific' })).toBeNull();
  });
});

describe('booking window', () => {
  it('clear error with the last allowed date', () => {
    const e = catchError(() => validateWindow(['2026-11-20', '2026-11-28'], '2026-11-17', 10, 'Quiet Room'));
    expect(e.message).toContain('2026-11-27');
    expect(e.details).toMatchObject({ code: 'WINDOW', maxDate: '2026-11-27' });
  });
  it('inside the window does not throw', () => {
    expect(() => validateWindow(['2026-12-02'], '2026-11-17', 15, 'Sala')).not.toThrow();
  });
  it('no bookings in the past', () => {
    const occ = toOccurrences(['2026-11-17'], '08:00', '09:00');
    expect(() => validateNotPast(occ, bogotaMs('2026-11-17', '08:30'))).toThrow(/ya pasó/);
    expect(() => validateNotPast(occ, bogotaMs('2026-11-17', '07:59'))).not.toThrow();
  });
});

describe('conflicts', () => {
  const existing: ExistingEvent = {
    startMs: bogotaMs('2026-11-20', '09:30'),
    endMs: bogotaMs('2026-11-20', '10:30'),
    subject: 'Ocupado',
    date: '2026-11-20',
    startTime: '09:30',
    endTime: '10:30',
  };
  it('detects the overlap and returns the details', () => {
    const occ = toOccurrences(['2026-11-19', '2026-11-20'], '09:00', '10:00');
    expect(findConflicts(occ, [existing])).toEqual([
      { date: '2026-11-20', subject: 'Ocupado', startTime: '09:30', endTime: '10:30' },
    ]);
  });
  it('back-to-back meetings do not conflict', () => {
    expect(findConflicts(toOccurrences(['2026-11-20'], '10:30', '11:00'), [existing])).toEqual([]);
  });
});

describe('SALAS_SOLO_LECTURA', () => {
  it('parses the variable', () => {
    expect(isReadOnly('1')).toBe(true);
    expect(isReadOnly('true')).toBe(true);
    expect(isReadOnly('0')).toBe(false);
    expect(isReadOnly(undefined)).toBe(false);
  });
  it('blocks writes with 423 and the clear message', () => {
    const e = catchError(() => requireWritable(true, READ_ONLY_MESSAGE));
    expect(e.status).toBe(423);
    expect(e.message).toMatch(/Modo de solo lectura/);
    expect(() => requireWritable(false, READ_ONLY_MESSAGE)).not.toThrow();
  });
});
