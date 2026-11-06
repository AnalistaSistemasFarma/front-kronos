import { describe, expect, it } from 'vitest';
import { sqlDateOnly, sqlDateRange } from '../dateRangeSql';

describe('fechas de los filtros para SQL', () => {
  it('AAAA-MM-DD queda a medianoche UTC (el día exacto, sin zona horaria)', () => {
    expect(sqlDateOnly('2026-11-04')?.toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });

  it('descarta textos y fechas imposibles', () => {
    expect(sqlDateOnly('')).toBeNull();
    expect(sqlDateOnly('04/11/2026')).toBeNull();
    expect(sqlDateOnly('2026-02-31')).toBeNull();
    expect(sqlDateOnly(null)).toBeNull();
  });

  it('si vienen al revés se ordenan', () => {
    const r = sqlDateRange('2026-11-30', '2026-11-01');
    expect(r.from?.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(r.to?.toISOString().slice(0, 10)).toBe('2026-11-30');
  });

  it('una sola fecha deja la otra abierta', () => {
    expect(sqlDateRange('', '2026-11-04')).toEqual({ from: null, to: sqlDateOnly('2026-11-04') });
  });
});
