import { describe, expect, it } from 'vitest';
import { meetingsCredentialsFor, meetingsEnabledFor, parseRange } from '../config';
import { deltaPct, formatMinutes, relativeDay } from '../format';
import {
  actualsFromReports,
  belongsToOccurrence,
  graphUtcMs,
  isRealMeeting,
  normalizeMeeting,
  parseTranscript,
  summarize,
  summarizeActuals,
  weekKey,
  weeklyTrend,
  type GraphMeetingEvent,
} from '../metrics';

const ME = 'nicolas.rivera@gsslatam.com';

function event(over: Partial<GraphMeetingEvent> = {}): GraphMeetingEvent {
  return {
    id: 'AAMk-1',
    subject: 'Comité',
    start: { dateTime: '2026-11-23T21:00:00.0000000', timeZone: 'UTC' },
    end: { dateTime: '2026-11-23T22:00:00.0000000', timeZone: 'UTC' },
    isOnlineMeeting: true,
    onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
    organizer: { emailAddress: { name: 'Nicolás Rivera', address: ME } },
    attendees: [{ type: 'required', emailAddress: { address: 'a@gsslatam.com' } }, { type: 'resource' }],
    responseStatus: { response: 'organizer' },
    ...over,
  };
}

describe('config', () => {
  it('enables the module only for listed e-mails or "*"', () => {
    expect(meetingsEnabledFor(ME, { REUNIONES_USUARIOS: 'Nicolas.Rivera@gsslatam.com, otro@x.com' })).toBe(true);
    expect(meetingsEnabledFor('otro@gsslatam.com', { REUNIONES_USUARIOS: ME })).toBe(false);
    expect(meetingsEnabledFor('otro@gsslatam.com', { REUNIONES_USUARIOS: '*' })).toBe(true);
    expect(meetingsEnabledFor(ME, {})).toBe(false);
    expect(meetingsEnabledFor(null, { REUNIONES_USUARIOS: '*' })).toBe(false);
  });

  it('reuses the Correo tenant credentials by e-mail domain', () => {
    const env = {
      CORREO_INQUILINOS: 'gss',
      CORREO_GSS_TENANT_ID: '11111111-1111-1111-1111-111111111111',
      CORREO_GSS_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
      CORREO_GSS_CLIENT_SECRET: 'secret',
      CORREO_GSS_DOMINIOS: 'gsslatam.com',
    };
    expect(meetingsCredentialsFor(ME, env)?.clientId).toBe('22222222-2222-2222-2222-222222222222');
    expect(meetingsCredentialsFor('x@otra.com', env)).toBeNull();
  });

  it('only accepts known ranges', () => {
    expect(parseRange('90')).toBe(90);
    expect(parseRange('3650')).toBe(30);
    expect(parseRange(null)).toBe(30);
  });
});

describe('metrics', () => {
  it('reads Graph UTC dates without offset', () => {
    expect(new Date(graphUtcMs('2026-11-23T21:00:00.0000000')).toISOString()).toBe('2026-11-23T21:00:00.000Z');
  });

  it('keeps real meetings and drops cancelled, declined, all-day and solo blocks', () => {
    expect(isRealMeeting(event())).toBe(true);
    expect(isRealMeeting(event({ isCancelled: true }))).toBe(false);
    expect(isRealMeeting(event({ isAllDay: true }))).toBe(false);
    expect(isRealMeeting(event({ responseStatus: { response: 'declined' } }))).toBe(false);
    expect(isRealMeeting(event({ showAs: 'free' }))).toBe(false);
    expect(isRealMeeting(event({ isOnlineMeeting: false, attendees: [] }))).toBe(false);
    expect(isRealMeeting(event({ isOnlineMeeting: false }))).toBe(true);
    // A 10-hour "open room" call is not a meeting.
    expect(isRealMeeting(event({ start: { dateTime: '2026-11-23T12:00:00' }, end: { dateTime: '2026-11-23T22:00:00' } }))).toBe(false);
  });

  it('normalizes a meeting without exposing the join URL', () => {
    const m = normalizeMeeting(event(), ME);
    expect(m).toMatchObject({ scheduledMinutes: 60, isOrganizer: true, attendees: 1, online: true, subject: 'Comité' });
    expect(JSON.stringify(m)).not.toContain('meetup-join');
    const other = normalizeMeeting(event({ organizer: { emailAddress: { name: 'Otra', address: 'o@x.com' } }, subject: '' }), ME);
    expect(other.isOrganizer).toBe(false);
    expect(other.subject).toBe('(Sin asunto)');
  });

  it('groups weeks on Monday in Bogotá time', () => {
    // Monday 2026-11-23 02:00 UTC is still Sunday 22 in Bogotá.
    expect(weekKey('2026-11-23T02:00:00.000Z')).toBe('2026-11-16');
    expect(weekKey('2026-11-23T21:00:00.000Z')).toBe('2026-11-23');
  });

  it('summarizes and builds the weekly trend with empty weeks', () => {
    const a = normalizeMeeting(event(), ME);
    const b = normalizeMeeting(
      event({ id: 'b', start: { dateTime: '2026-11-10T14:00:00' }, end: { dateTime: '2026-11-10T16:00:00' } }),
      ME
    );
    const s = summarize([a, b], 30);
    expect(s).toMatchObject({ meetings: 2, minutes: 180, averageMinutes: 90, organizedByMe: 2, longMeetings: 1 });
    const trend = weeklyTrend([a, b], '2026-11-03T12:00:00.000Z', '2026-11-24T12:00:00.000Z');
    expect(trend.map((w) => w.week)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    expect(trend.find((w) => w.week === '2026-11-16')?.meetings).toBe(0);
    expect(trend.find((w) => w.week === '2026-11-09')?.minutes).toBe(120);
  });

  it('matches attendance reports to the right occurrence and computes delay / overrun', () => {
    const m = normalizeMeeting(event(), ME);
    const actuals = actualsFromReports(
      [
        { totalParticipantCount: 4, meetingStartDateTime: '2026-11-23T21:07:00Z', meetingEndDateTime: '2026-11-23T22:20:00Z' },
        // Same recurring meeting, previous week: ignored.
        { totalParticipantCount: 9, meetingStartDateTime: '2026-11-16T21:00:00Z', meetingEndDateTime: '2026-11-16T22:00:00Z' },
      ],
      m
    );
    expect(actuals).toMatchObject({ startDelayMinutes: 7, actualMinutes: 73, overrunMinutes: 13, participants: 4 });
    expect(actualsFromReports([], m).actualMinutes).toBeNull();
    expect(belongsToOccurrence('2026-11-16T21:00:00Z', m)).toBe(false);
  });

  it('summarizes punctuality only over meetings with data', () => {
    const s = summarizeActuals([
      { ...actualsFromReports([], normalizeMeeting(event(), ME)), hasTranscript: true },
      { actualStart: null, actualEnd: null, actualMinutes: 50, startDelayMinutes: 2, overrunMinutes: -10, participants: 3, hasTranscript: false },
      { actualStart: null, actualEnd: null, actualMinutes: 80, startDelayMinutes: 12, overrunMinutes: 20, participants: 3, hasTranscript: true },
    ]);
    expect(s).toMatchObject({ analyzed: 3, withData: 2, onTimePct: 50, overranPct: 50, averageDelayMinutes: 7, withTranscript: 2 });
  });

  it('parses Teams metadataContent and merges the same speaker', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:01:27.342 --> 00:01:43.662',
      '{"speakerName":"Ana","spokenText":"Buenos días.","spokenLanguage":"es-mx"}',
      '',
      '00:01:45.742 --> 00:02:01.022',
      '{"speakerName":"Ana","spokenText":"Empecemos.","spokenLanguage":"es-mx"}',
      '',
      '00:02:02.502 --> 00:02:05.000',
      '<v Luis>De acuerdo</v>',
      '',
      '00:02:06.000 --> 00:02:07.000',
      '{"speakerName":"Luis","spokenText":""}',
    ].join('\n');
    expect(parseTranscript(vtt)).toEqual([
      { at: '00:01:27', speaker: 'Ana', text: 'Buenos días. Empecemos.' },
      { at: '00:02:02', speaker: 'Luis', text: 'De acuerdo' },
    ]);
  });
});

describe('format', () => {
  it('formats minutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(null)).toBe('—');
  });

  it('computes deltas and relative days', () => {
    expect(deltaPct(12, 10)).toBe(20);
    expect(deltaPct(5, 0)).toBeNull();
    const now = new Date('2026-11-23T20:00:00Z');
    expect(relativeDay('2026-11-23T14:00:00Z', now)).toBe('Hoy');
    expect(relativeDay('2026-11-22T14:00:00Z', now)).toBe('Ayer');
  });
});
