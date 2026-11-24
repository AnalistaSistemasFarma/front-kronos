/**
 * QA FIXTURE of "Mis reuniones" — TESTING ONLY (2026-11-24).
 *
 *   REUNIONES_FIXTURE_USUARIOS   comma separated e-mails that see a FAKE calendar (meetings, attendance
 *                                and transcripts generated here) instead of Microsoft Graph.
 *
 * Why: the QA accounts of the testing environment (qa.sgc@…) are not real mailboxes, and the Teams
 * application access policy only covers real people. Without this the project meetings and the agent
 * analysis could not be exercised end to end in testing. NEVER set it in production: it only changes
 * what those e-mails see (they also need REUNIONES_USUARIOS) and it never touches Microsoft 365.
 *
 * Pure and deterministic: everything is derived from the date, so the ids are stable between calls.
 */
import type { AttendanceReport, GraphMeetingEvent } from './metrics';

type Env = Record<string, string | undefined>;

export function meetingsFixtureEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  const mail = String(email ?? '').trim().toLowerCase();
  if (!mail.includes('@')) return false;
  return String(env.REUNIONES_FIXTURE_USUARIOS ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(mail);
}

const DAY_MS = 86_400_000;
const PEOPLE = [
  { name: 'QA SGC Pruebas', address: 'qa.sgc@gsslatam.com' },
  { name: 'QA Chat Pruebas', address: 'qa.chat@gsslatam.com' },
  { name: 'Laura Calidad (ficticia)', address: 'laura.calidad.ficticia@gsslatam.com' },
];
const JOIN = 'https://teams.microsoft.com/l/meetup-join/fixture-';

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}
function graphDate(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '0000');
}

interface FixtureSlot {
  key: string;
  subject: string;
  startMs: number;
  minutes: number;
  series: boolean;
  online: boolean;
  privateMeeting?: boolean;
  organizer: { name: string; address: string };
}

/** Monday 14:00 UTC (9:00 Bogotá) of the week that contains `ms`. */
function mondayAt14(ms: number): number {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow, 14, 0, 0);
}

function dayAt(ms: number, hourUtc: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0);
}

function slots(now: number): FixtureSlot[] {
  const out: FixtureSlot[] = [];
  // Weekly series: the last 6 Mondays plus the next one (future ones are filtered by the service).
  const base = mondayAt14(now);
  for (let w = -6; w <= 1; w++) {
    const start = base + w * 7 * DAY_MS;
    out.push({ key: `sgc-${ymd(start)}`, subject: 'Seguimiento semanal SGC', startMs: start, minutes: 60, series: true, online: true, organizer: PEOPLE[0] });
  }
  const doc = dayAt(now - 2 * DAY_MS, 16);
  out.push({ key: `doc-${ymd(doc)}`, subject: 'Revisión de procedimientos del SGC', startMs: doc, minutes: 45, series: false, online: true, organizer: PEOPLE[2] });
  const comite = dayAt(now - 5 * DAY_MS, 20);
  out.push({ key: `comite-${ymd(comite)}`, subject: 'Comité de Calidad', startMs: comite, minutes: 30, series: false, online: true, organizer: PEOPLE[1] });
  const privada = dayAt(now - 1 * DAY_MS, 21);
  out.push({ key: `privada-${ymd(privada)}`, subject: 'Reunión privada', startMs: privada, minutes: 30, series: false, online: true, privateMeeting: true, organizer: PEOPLE[0] });
  return out;
}

function toEvent(s: FixtureSlot, email: string): GraphMeetingEvent {
  return {
    id: `fixture-${s.key}`,
    iCalUId: `fixture-ical-${s.key}`,
    subject: s.subject,
    start: { dateTime: graphDate(s.startMs), timeZone: 'UTC' },
    end: { dateTime: graphDate(s.startMs + s.minutes * 60_000), timeZone: 'UTC' },
    isAllDay: false,
    isCancelled: false,
    isOnlineMeeting: s.online,
    isOrganizer: s.organizer.address === email.toLowerCase(),
    sensitivity: s.privateMeeting ? 'private' : 'normal',
    showAs: 'busy',
    type: s.series ? 'occurrence' : 'singleInstance',
    seriesMasterId: s.series ? 'fixture-series-sgc' : null,
    webLink: null,
    onlineMeeting: s.online ? { joinUrl: `${JOIN}${s.key.split('-')[0]}` } : null,
    organizer: { emailAddress: { name: s.organizer.name, address: s.organizer.address } },
    attendees: PEOPLE.map((p) => ({ type: 'required', emailAddress: { address: p.address } })),
    responseStatus: { response: s.organizer.address === email.toLowerCase() ? 'organizer' : 'accepted' },
  };
}

/** Fake calendarView of the mailbox between two instants. */
export function fixtureEvents(email: string, fromMs: number, toMs: number, now: number = Date.now()): GraphMeetingEvent[] {
  return slots(now)
    .filter((s) => s.startMs >= fromMs && s.startMs < toMs)
    .sort((a, b) => b.startMs - a.startMs)
    .map((s) => toEvent(s, email));
}

/** Fake event by id (null = not in this calendar, like a Graph 404). */
export function fixtureEvent(email: string, id: string, now: number = Date.now()): GraphMeetingEvent | null {
  const m = /^fixture-(sgc|doc|comite|privada)-(\d{8})$/.exec(id);
  if (!m) return null;
  const day = Date.UTC(Number(m[2].slice(0, 4)), Number(m[2].slice(4, 6)) - 1, Number(m[2].slice(6, 8)), 12);
  const key = `${m[1]}-${m[2]}`;
  // The slots are relative to "now": look for the key around its own date (stable ids for old meetings).
  for (const at of [now, ...Array.from({ length: 9 }, (_, k) => day + k * DAY_MS)]) {
    const hit = slots(at).find((s) => s.key === key);
    if (hit) return toEvent(hit, email);
  }
  return null;
}

/** Attendance report of the occurrence: the weekly meeting starts 4 min late and runs 12 min over. */
export function fixtureAttendance(id: string): AttendanceReport[] {
  const e = fixtureEvent('qa.sgc@gsslatam.com', id);
  if (!e || id.startsWith('fixture-privada')) return [];
  const start = Date.parse(`${e.start.dateTime.slice(0, 19)}Z`);
  const end = Date.parse(`${e.end.dateTime.slice(0, 19)}Z`);
  const late = id.startsWith('fixture-sgc') ? 4 : 1;
  const over = id.startsWith('fixture-sgc') ? 12 : -5;
  return [
    {
      totalParticipantCount: id.startsWith('fixture-comite') ? 2 : 3,
      meetingStartDateTime: new Date(start + late * 60_000).toISOString(),
      meetingEndDateTime: new Date(end + over * 60_000).toISOString(),
    },
  ];
}

function cue(at: string, speaker: string, text: string, i: number): string {
  return `${i}\n${at}.000 --> ${at}.900\n<v ${speaker}>${text}</v>`;
}

/** Fake WEBVTT transcript (null = the meeting was not transcribed). */
export function fixtureTranscript(id: string): string | null {
  if (id.startsWith('fixture-sgc')) {
    const lines: [string, string, string][] = [
      ['00:00:05', 'QA SGC Pruebas', 'Buenos días. Hoy revisamos el avance de la validación del SGC en SynerLink y los pendientes de la semana pasada.'],
      ['00:00:40', 'QA Chat Pruebas', 'De la semana pasada quedó cargar los procedimientos de compras; ya están cargados y aprobados.'],
      ['00:01:30', 'Laura Calidad (ficticia)', 'El formato de control de cambios todavía no está, se me cruzó con la auditoría.'],
      ['00:02:10', 'QA SGC Pruebas', 'Entonces decidimos que el control de cambios sale en la versión dos del flujo y no bloquea la salida a producción.'],
      ['00:03:00', 'QA Chat Pruebas', 'Otra vez sale el tema de las firmas de los elaboradores; seguimos sin definir quién firma cuando el líder está de vacaciones.'],
      ['00:04:20', 'Laura Calidad (ficticia)', 'Yo propongo que firme el suplente del departamento, pero eso lo debe aprobar Calidad.'],
      ['00:05:15', 'QA SGC Pruebas', 'Queda como compromiso: QA SGC Pruebas envía la propuesta de suplentes de firma a Calidad a más tardar el viernes.'],
      ['00:06:00', 'QA Chat Pruebas', 'Yo me comprometo a probar el flujo de aprobación con los tres tipos de documento antes del miércoles.'],
      ['00:07:30', 'Laura Calidad (ficticia)', 'Y yo reviso la lista maestra para que no queden documentos sin responsable, para el próximo lunes.'],
      ['00:09:00', 'QA SGC Pruebas', 'Los veinte minutos siguientes fueron de estado de tareas, cada uno contó lo suyo.'],
      ['00:31:00', 'QA Chat Pruebas', 'Sobre la capacitación, no alcanzamos a definir fecha; lo vemos la otra semana.'],
      ['00:58:00', 'QA SGC Pruebas', 'Nos pasamos de la hora. Cerramos aquí, gracias a todos.'],
    ];
    return `WEBVTT\n\n${lines.map(([at, who, text], i) => cue(at, who, text, i + 1)).join('\n\n')}\n`;
  }
  if (id.startsWith('fixture-doc')) {
    const lines: [string, string, string][] = [
      ['00:00:10', 'Laura Calidad (ficticia)', 'Revisamos los procedimientos PR-012 y PR-015 del SGC.'],
      ['00:02:00', 'QA SGC Pruebas', 'El PR-012 queda aprobado tal como está.'],
      ['00:05:30', 'Laura Calidad (ficticia)', 'Del PR-015 falta el diagrama; QA SGC Pruebas lo actualiza para el jueves.'],
      ['00:40:00', 'QA SGC Pruebas', 'Listo, terminamos antes de la hora.'],
    ];
    return `WEBVTT\n\n${lines.map(([at, who, text], i) => cue(at, who, text, i + 1)).join('\n\n')}\n`;
  }
  return null;
}
