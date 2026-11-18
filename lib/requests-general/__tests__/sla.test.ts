import { describe, expect, it } from 'vitest';
import {
  bogotaWallNow,
  businessHoursBetween,
  evaluateSla,
  formatRemaining,
  formatSla,
  isBusinessDay,
  parseSlaInput,
  roundBaselineHours,
  slaDurationMs,
  slaElapsedMs,
} from '../sla';

// Wall-clock helper: the UTC fields are the Bogotá wall clock (same as DB values).
const w = (s: string) => new Date(`${s}Z`);
const H = 3_600_000;

describe('isBusinessDay', () => {
  it('excludes weekends and Colombian holidays', () => {
    expect(isBusinessDay(w('2026-11-18T10:00:00'))).toBe(true); // Wednesday
    expect(isBusinessDay(w('2026-11-21T10:00:00'))).toBe(false); // Saturday
    expect(isBusinessDay(w('2026-11-16T10:00:00'))).toBe(false); // Independencia de Cartagena (moved to Monday)
    expect(isBusinessDay(w('2026-12-25T10:00:00'))).toBe(false);
    expect(isBusinessDay(w('2026-04-03T10:00:00'))).toBe(false); // Good Friday 2026
  });
});

describe('businessHoursBetween', () => {
  it('counts only the 08:00–17:00 window', () => {
    expect(businessHoursBetween(w('2026-11-18T09:00:00'), w('2026-11-18T12:30:00'))).toBe(3.5);
    expect(businessHoursBetween(w('2026-11-18T06:00:00'), w('2026-11-18T20:00:00'))).toBe(9);
    expect(businessHoursBetween(w('2026-11-18T18:00:00'), w('2026-11-19T07:00:00'))).toBe(0);
  });
  it('skips weekends and holidays', () => {
    // Fri 16:00 → Tue 09:00 with Monday 2026-11-16 holiday: 1 h (Fri) + 0 + 1 h (Tue)
    expect(businessHoursBetween(w('2026-11-13T16:00:00'), w('2026-11-17T09:00:00'))).toBe(2);
  });
  it('is zero when end <= start', () => {
    expect(businessHoursBetween(w('2026-11-18T12:00:00'), w('2026-11-18T10:00:00'))).toBe(0);
  });
});

describe('slaDurationMs', () => {
  it('converts units', () => {
    expect(slaDurationMs({ value: 2, unit: 'business_days' })).toBe(18 * H);
    expect(slaDurationMs({ value: 5, unit: 'business_hours' })).toBe(5 * H);
    expect(slaDurationMs({ value: 24, unit: 'calendar_hours' })).toBe(24 * H);
    expect(slaDurationMs({ value: null, unit: 'business_hours' })).toBeNull();
    expect(slaDurationMs({ value: 0, unit: 'business_hours' })).toBeNull();
  });
});

describe('slaElapsedMs with pauses', () => {
  it('subtracts the business time of each pause', () => {
    const created = w('2026-11-18T08:00:00');
    const now = w('2026-11-19T17:00:00'); // 18 business hours
    const pauses = [{ pausedAt: w('2026-11-18T13:00:00'), resumedAt: w('2026-11-19T10:00:00') }]; // 4 + 2 = 6 h
    expect(slaElapsedMs(created, now, 'business_hours', pauses) / H).toBe(12);
  });
  it('an open pause runs until now', () => {
    const created = w('2026-11-18T08:00:00');
    const now = w('2026-11-18T12:00:00');
    expect(slaElapsedMs(created, now, 'business_hours', [{ pausedAt: w('2026-11-18T10:00:00'), resumedAt: null }]) / H).toBe(2);
  });
  it('calendar hours ignore the business window', () => {
    expect(slaElapsedMs(w('2026-11-21T00:00:00'), w('2026-11-22T00:00:00'), 'calendar_hours') / H).toBe(24);
  });
});

describe('evaluateSla', () => {
  const created = w('2026-11-18T08:00:00');
  const cfg = { value: 10, unit: 'business_hours' };
  it('on time', () => {
    expect(evaluateSla(created, cfg, w('2026-11-18T12:00:00')).state).toBe('on_time');
  });
  it('near due at <= 20 % remaining', () => {
    // 9 h (day 1) - 1 h → 8 elapsed, 2 remaining = 20 %
    const r = evaluateSla(created, cfg, w('2026-11-18T16:00:00'));
    expect(r.state).toBe('near_due');
    expect(r.remainingHours).toBe(2);
  });
  it('honours a custom warn pct', () => {
    expect(evaluateSla(created, { ...cfg, warnPct: 50 }, w('2026-11-18T13:00:00')).state).toBe('near_due');
  });
  it('overdue', () => {
    const r = evaluateSla(created, cfg, w('2026-11-19T10:00:00'));
    expect(r.state).toBe('overdue');
    expect(r.remainingHours).toBe(-1);
  });
  it('no SLA', () => {
    expect(evaluateSla(created, { value: null, unit: null }, w('2026-11-19T10:00:00')).state).toBe('no_sla');
  });
});

describe('roundBaselineHours', () => {
  it('rounds up to hours below 9 h, to business days from 9 h', () => {
    expect(roundBaselineHours(0.2)).toBe(1);
    expect(roundBaselineHours(4.1)).toBe(5);
    expect(roundBaselineHours(8)).toBe(8);
    expect(roundBaselineHours(8.5)).toBe(9);
    expect(roundBaselineHours(9)).toBe(9);
    expect(roundBaselineHours(9.1)).toBe(18);
    expect(roundBaselineHours(40)).toBe(45);
    expect(roundBaselineHours(0)).toBeNull();
    expect(roundBaselineHours(Number.NaN)).toBeNull();
  });
});

describe('labels', () => {
  it('formats the SLA in Spanish', () => {
    expect(formatSla({ value: 27, unit: 'business_hours' })).toBe('3 días hábiles');
    expect(formatSla({ value: 9, unit: 'business_hours' })).toBe('1 día hábil');
    expect(formatSla({ value: 5, unit: 'business_hours' })).toBe('5 horas hábiles');
    expect(formatSla({ value: 2, unit: 'business_days' })).toBe('2 días hábiles');
    expect(formatSla({ value: null, unit: null })).toBe('Sin ANS');
  });
  it('formats remaining time', () => {
    expect(formatRemaining(3.2)).toBe('Vence en 3 h');
    expect(formatRemaining(-20)).toBe('Vencida hace 2 d');
    expect(formatRemaining(null)).toBe('');
  });
});

describe('parseSlaInput', () => {
  it('accepts empty as "no SLA"', () => {
    expect(parseSlaInput({ value: '' })).toEqual({ ok: true, value: null, unit: null, warnPct: null });
  });
  it('validates value, unit and warn pct', () => {
    expect(parseSlaInput({ value: '18', unit: 'business_hours', warnPct: '25' })).toEqual({ ok: true, value: 18, unit: 'business_hours', warnPct: 25 });
    expect(parseSlaInput({ value: '-1' }).ok).toBe(false);
    expect(parseSlaInput({ value: '1.5' }).ok).toBe(false);
    expect(parseSlaInput({ value: 3, unit: 'weeks' }).ok).toBe(false);
    expect(parseSlaInput({ value: 3, warnPct: 100 }).ok).toBe(false);
  });
});

describe('bogotaWallNow', () => {
  it('shifts UTC by -5 h', () => {
    expect(bogotaWallNow(new Date('2026-11-18T15:00:00Z')).toISOString()).toBe('2026-11-18T10:00:00.000Z');
  });
});
