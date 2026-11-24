import { describe, expect, it } from 'vitest';
import { fixtureAttendance, fixtureEvent, fixtureEvents, fixtureTranscript, meetingsFixtureEnabledFor } from '../fixture';
import { isRealMeeting, normalizeMeeting, parseTranscript } from '../metrics';

const QA = 'qa.sgc@gsslatam.com';
const NOW = Date.parse('2026-11-24T15:00:00Z');

describe('QA fixture (testing only)', () => {
  it('is off unless the e-mail is listed', () => {
    expect(meetingsFixtureEnabledFor(QA, {})).toBe(false);
    expect(meetingsFixtureEnabledFor('nicolas.rivera@gsslatam.com', { REUNIONES_FIXTURE_USUARIOS: QA })).toBe(false);
    expect(meetingsFixtureEnabledFor('QA.SGC@gsslatam.com', { REUNIONES_FIXTURE_USUARIOS: `x@y.com, ${QA}` })).toBe(true);
  });

  it('builds a calendar with a weekly series, singles and a private meeting, with stable ids', () => {
    const events = fixtureEvents(QA, NOW - 30 * 86_400_000, NOW, NOW);
    expect(events.length).toBeGreaterThanOrEqual(6);
    const series = events.filter((e) => e.seriesMasterId === 'fixture-series-sgc');
    expect(series.length).toBeGreaterThanOrEqual(4);
    expect(new Set(events.map((e) => e.iCalUId)).size).toBe(events.length);
    for (const e of events) {
      expect(isRealMeeting(e)).toBe(true);
      expect(fixtureEvent(QA, e.id, NOW)?.iCalUId).toBe(e.iCalUId);
    }
    expect(events.some((e) => normalizeMeeting(e, QA).private)).toBe(true);
    expect(fixtureEvent(QA, 'AAMk-real-id', NOW)).toBeNull();
  });

  it('old ids keep resolving after the days go by', () => {
    const [first] = fixtureEvents(QA, NOW - 3 * 86_400_000, NOW, NOW);
    expect(fixtureEvent(QA, first.id, NOW + 20 * 86_400_000)?.iCalUId).toBe(first.iCalUId);
  });

  it('weekly meeting: transcript with speakers and attendance (late and over time)', () => {
    const e = fixtureEvents(QA, NOW - 8 * 86_400_000, NOW, NOW).find((x) => x.seriesMasterId)!;
    const lines = parseTranscript(fixtureTranscript(e.id) ?? '');
    expect(lines.length).toBeGreaterThan(5);
    expect(new Set(lines.map((l) => l.speaker)).size).toBe(3);
    const [r] = fixtureAttendance(e.id);
    expect(r.totalParticipantCount).toBe(3);
    const comite = fixtureEvents(QA, NOW - 8 * 86_400_000, NOW, NOW).find((x) => x.subject === 'Comité de Calidad')!;
    expect(fixtureTranscript(comite.id)).toBeNull();
  });
});
