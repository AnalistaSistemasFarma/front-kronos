import { createHash, randomBytes } from 'node:crypto';
import { addDays } from './reviewAlerts';
import { toCalendarDate } from './review';

/**
 * Enlace iCal PRIVADO de solo lectura (RFC 5545) para suscribir el calendario
 * de vencimientos del SGC en Outlook. Funciones PURAS salvo la generación del
 * token (aleatorio criptográfico). En la base se guarda solo el SHA-256 del
 * token; el enlace se muestra una sola vez y se puede revocar.
 *
 * Privacidad (opción más segura): un documento CONFIDENCIAL aparece solo con
 * su código y versión, sin título, porque el calendario sale de SynerLink.
 */

export interface SgcIcalEvent {
  uid: string;
  date: string; // YYYY-MM-DD (evento de día completo)
  summary: string;
  description: string;
  url: string;
}

export function newIcalToken(): string {
  return randomBytes(32).toString('base64url');
}

export function icalTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Un token tiene 43 caracteres base64url (32 bytes). */
export function isIcalTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Escapa texto según RFC 5545 (\\, ;, , y saltos de línea). */
export function escapeIcalText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Pliega líneas a 75 octetos (RFC 5545 §3.1), sin partir caracteres UTF-8. */
export function foldIcalLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function ymd(date: string): string {
  return date.replace(/-/g, '');
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildIcalendar(events: readonly SgcIcalEvent[], opts: { calendarName: string; now: Date }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Group Shared Services Latinoamérica//SynerLink SGC documental//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcalText(opts.calendarName)}`,
    'X-WR-TIMEZONE:America/Bogota',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of events) {
    const start = toCalendarDate(e.date);
    const end = addDays(start, 1).toISOString().slice(0, 10);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(opts.now)}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(end)}`,
      `SUMMARY:${escapeIcalText(e.summary)}`,
      `DESCRIPTION:${escapeIcalText(e.description)}`,
      `URL:${e.url}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcalLine).join('\r\n') + '\r\n';
}
