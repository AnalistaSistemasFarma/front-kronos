import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths,
  computeReviewAlertDate,
  computeReviewDueDate,
  formatCalendarDate,
  getReviewState,
  toCalendarDate,
} from '../review';

const d = (s: string) => toCalendarDate(s);

describe('SGC · vencimiento (revisión trienal, alerta 2 meses antes)', () => {
  it('[SGC-REQ-021] la próxima revisión es la vigencia + 36 meses', () => {
    expect(formatCalendarDate(computeReviewDueDate('2026-09-30', 36))).toBe('2029-09-30');
  });

  it('[SGC-REQ-021] la alerta empieza 2 meses antes de la revisión', () => {
    expect(formatCalendarDate(computeReviewAlertDate('2029-09-30', 2))).toBe('2029-07-30');
  });

  it('[SGC-REQ-021] fin de mes: 31 de diciembre − 2 meses = 31 de octubre; 31 de enero + 1 = fin de febrero', () => {
    expect(formatCalendarDate(computeReviewAlertDate('2029-12-31', 2))).toBe('2029-10-31');
    expect(formatCalendarDate(addCalendarMonths(d('2027-01-31'), 1))).toBe('2027-02-28');
    expect(formatCalendarDate(addCalendarMonths(d('2028-01-31'), 1))).toBe('2028-02-29');
  });

  it('[SGC-REQ-021] estado de revisión con reloj controlado: al día, por vencer y vencido', () => {
    const due = '2029-09-30';
    expect(getReviewState(due, 2, new Date('2029-07-29T12:00:00Z'))).toBe('al_dia');
    expect(getReviewState(due, 2, new Date('2029-07-30T00:00:00Z'))).toBe('por_vencer');
    expect(getReviewState(due, 2, new Date('2029-09-29T23:00:00Z'))).toBe('por_vencer');
    expect(getReviewState(due, 2, new Date('2029-09-30T00:00:00Z'))).toBe('vencido');
    expect(getReviewState(null, 2)).toBe('sin_fecha');
  });

  it('[SGC-REQ-021] rechaza fechas y periodos inválidos', () => {
    expect(() => toCalendarDate('2026-02-30')).toThrow();
    expect(() => toCalendarDate('ayer')).toThrow();
    expect(() => toCalendarDate(new Date('x'))).toThrow();
    expect(() => computeReviewDueDate('2026-01-01', 0)).toThrow();
    expect(() => computeReviewAlertDate('2026-01-01', -1)).toThrow();
    expect(formatCalendarDate(null)).toBeNull();
  });

  it('[SGC-REQ-021] toma la fecha de calendario de un Date sin la hora', () => {
    expect(formatCalendarDate(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09-30');
  });
});
