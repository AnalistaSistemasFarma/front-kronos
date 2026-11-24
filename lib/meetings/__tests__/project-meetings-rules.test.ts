import { describe, expect, it } from 'vitest';
import { bogotaDate, parseLinkInput, projectKpis, suggestProject, tokens } from '../projects/rules';

const ME = 'ana@gsslatam.com';
const candidates = [
  { idProject: 1, name: 'Validación SGC Synerlink', memberEmails: ['ana@gsslatam.com', 'bob@gsslatam.com', 'cy@gsslatam.com'] },
  { idProject: 2, name: 'Unificación SAPSEND-SynerLink', memberEmails: ['ana@gsslatam.com', 'dan@gsslatam.com'] },
  { idProject: 3, name: 'Firmas digitales', memberEmails: ['eve@gsslatam.com'] },
];

describe('suggestProject (no AI)', () => {
  it('the series already went to a project: that one first', () => {
    expect(suggestProject({ subject: 'Firmas', attendeeEmails: [], me: ME, seriesProject: 2 }, candidates)).toEqual({ idProject: 2, reason: 'serie' });
  });

  it('ignores a series project the person cannot assign to', () => {
    expect(suggestProject({ subject: 'Café', attendeeEmails: [], me: ME, seriesProject: 99 }, candidates)).toBeNull();
  });

  it('subject: only words that identify ONE project count (SynerLink is shared, SGC is not)', () => {
    expect(suggestProject({ subject: 'Seguimiento semanal SGC', attendeeEmails: [], me: ME }, candidates)).toEqual({ idProject: 1, reason: 'asunto' });
    expect(suggestProject({ subject: 'Revisión SynerLink', attendeeEmails: [], me: ME }, candidates)).toBeNull();
    expect(suggestProject({ subject: 'firmas DIGITALES: avance', attendeeEmails: [], me: ME }, candidates)).toEqual({ idProject: 3, reason: 'asunto' });
  });

  it('accents and case do not matter', () => {
    expect(suggestProject({ subject: 'validacion sgc', attendeeEmails: [], me: ME }, candidates)?.idProject).toBe(1);
  });

  it('a tie gives no suggestion', () => {
    expect(suggestProject({ subject: 'SGC y SAPSEND', attendeeEmails: [], me: ME }, candidates)).toBeNull();
  });

  it('attendees: more than half of the OTHER invitees are members of one project', () => {
    const s = suggestProject({ subject: 'Llamada', attendeeEmails: [ME, 'bob@gsslatam.com', 'cy@gsslatam.com', 'x@otra.com'], me: ME }, candidates);
    expect(s).toEqual({ idProject: 1, reason: 'asistentes' });
    expect(suggestProject({ subject: 'Llamada', attendeeEmails: [ME, 'bob@gsslatam.com', 'x@otra.com'], me: ME }, candidates)).toBeNull();
    expect(suggestProject({ subject: 'Llamada', attendeeEmails: [ME], me: ME }, candidates)).toBeNull();
  });

  it('no candidates, no suggestion', () => {
    expect(suggestProject({ subject: 'SGC', attendeeEmails: [], me: ME }, [])).toBeNull();
  });

  it('tokens drop stopwords and short words', () => {
    expect(tokens('Reunión de seguimiento del Proyecto SGC')).toEqual(['sgc']);
  });
});

describe('parseLinkInput', () => {
  it('accepts an event id and the series flag', () => {
    expect(parseLinkInput({ eventId: 'AAMk=', applyToSeries: true, origin: 'sugerencia' })).toEqual({ ok: true, value: { eventId: 'AAMk=', applyToSeries: true, origin: 'sugerencia' } });
    expect(parseLinkInput({ eventId: 'AAMk=' })).toEqual({ ok: true, value: { eventId: 'AAMk=', applyToSeries: false, origin: 'manual' } });
  });
  it('rejects ids with paths or spaces and a non-boolean flag', () => {
    expect(parseLinkInput({ eventId: '../x' }).ok).toBe(false);
    expect(parseLinkInput({ eventId: 'a b' }).ok).toBe(false);
    expect(parseLinkInput({ eventId: 'x'.repeat(513) }).ok).toBe(false);
    expect(parseLinkInput({ eventId: 'ok', applyToSeries: 'si' }).ok).toBe(false);
    expect(parseLinkInput({}).ok).toBe(false);
  });
});

describe('projectKpis', () => {
  it('person-hours, decisions, commitments and punctuality per project (never per person)', () => {
    const k = projectKpis([
      { scheduledMinutes: 60, actualMinutes: 72, attendeesCount: 4, attendedCount: 3, startDelayMinutes: 4, analysis: { status: 'listo', decisions: 2, commitments: 3, proposalsConfirmed: 1 } },
      { scheduledMinutes: 30, actualMinutes: null, attendeesCount: 2, attendedCount: null, startDelayMinutes: null, analysis: null },
      { scheduledMinutes: 45, actualMinutes: 40, attendeesCount: 3, attendedCount: 3, startDelayMinutes: 9, analysis: { status: 'listo', decisions: 0, commitments: 0, proposalsConfirmed: 0 } },
      { scheduledMinutes: 45, actualMinutes: 40, attendeesCount: 3, attendedCount: 3, startDelayMinutes: 1, analysis: { status: 'fallido', decisions: 0, commitments: 0, proposalsConfirmed: 0 } },
    ]);
    // 72×3 + 30×2 + 40×3 + 40×3 = 516 min = 8.6 h
    expect(k).toEqual({ meetings: 4, personHours: 8.6, analyzed: 2, withDecisions: 1, commitments: 3, proposalsConfirmed: 1, onTime: 2, withActuals: 3 });
  });
});

describe('bogotaDate', () => {
  it('uses Bogotá time', () => {
    expect(bogotaDate('2026-11-24T03:00:00Z')).toBe('2026-11-23');
    expect(bogotaDate('2026-11-24T05:00:00Z')).toBe('2026-11-24');
  });
});
