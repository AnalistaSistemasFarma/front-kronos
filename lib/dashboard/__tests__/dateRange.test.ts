import { describe, it, expect } from 'vitest';
import {
  parseCalendarDate,
  formatDateLocal,
  getDashboardDateRange,
  shiftReferenceMonth,
  canShiftReferenceForward,
  clampReferenceToPresent,
  getQuarterLabel,
  getSemesterLabel,
  isReferenceAtCurrentPeriod,
} from '../dateRange';

// Pruebas de los RANGOS DE PERIODO del tablero (mes/trimestre/semestre/año) y la
// navegación temporal. Reglas de negocio clave: interpretar fechas como día de
// calendario LOCAL (sin desfase UTC) y NUNCA permitir avanzar a un periodo que
// aún no ha comenzado. Lógica pura salvo por la referencia a "hoy" del sistema.

describe('parseCalendarDate — sin desfase UTC', () => {
  it('interpreta YYYY-MM-DD como día local, no como medianoche UTC', () => {
    const d = parseCalendarDate('2026-07-28');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(6); // julio (0-index)
    expect(d?.getDate()).toBe(28);
  });

  it('toma solo la parte de fecha de un ISO con hora', () => {
    const d = parseCalendarDate('2026-07-28T23:59:59');
    expect(d?.getDate()).toBe(28);
    expect(d?.getHours()).toBe(0); // se normaliza a inicio del día local
  });

  it('devuelve null para vacío, nulo o inválido', () => {
    expect(parseCalendarDate(null)).toBeNull();
    expect(parseCalendarDate('')).toBeNull();
    expect(parseCalendarDate('no-fecha')).toBeNull();
  });
});

describe('formatDateLocal', () => {
  it('formatea a YYYY-MM-DD con ceros a la izquierda', () => {
    expect(formatDateLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDateLocal(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('getDashboardDateRange — límites de calendario reales', () => {
  it('"all" no restringe fechas (devuelve null)', () => {
    expect(getDashboardDateRange('all')).toBeNull();
  });

  it('mes: primer y último día del mes de referencia', () => {
    // Referencia en un mes pasado para que no lo tope "hoy".
    const range = getDashboardDateRange('month', new Date(2020, 2, 1)); // marzo 2020
    expect(range).toEqual({ startDate: '2020-03-01', endDate: '2020-03-31' });
  });

  it('trimestre: cubre los tres meses del trimestre de la referencia', () => {
    const range = getDashboardDateRange('quarter', new Date(2020, 4, 15)); // mayo -> Q2
    expect(range).toEqual({ startDate: '2020-04-01', endDate: '2020-06-30' });
  });

  it('semestre: segundo semestre va de julio a diciembre', () => {
    const range = getDashboardDateRange('semester', new Date(2020, 8, 10)); // septiembre
    expect(range).toEqual({ startDate: '2020-07-01', endDate: '2020-12-31' });
  });

  it('año: del 1 de enero al 31 de diciembre', () => {
    const range = getDashboardDateRange('year', new Date(2020, 5, 1));
    expect(range).toEqual({ startDate: '2020-01-01', endDate: '2020-12-31' });
  });
});

describe('shiftReferenceMonth — navegación por periodo', () => {
  const ref = new Date(2026, 5, 1); // junio 2026

  it('mes: avanza/retrocede un mes', () => {
    expect(shiftReferenceMonth(ref, 'month', 1).getMonth()).toBe(6); // julio
    expect(shiftReferenceMonth(ref, 'month', -1).getMonth()).toBe(4); // mayo
  });

  it('trimestre: salta de a tres meses', () => {
    expect(shiftReferenceMonth(ref, 'quarter', 1).getMonth()).toBe(8); // septiembre
  });

  it('semestre: salta de a seis meses', () => {
    expect(shiftReferenceMonth(ref, 'semester', 1).getMonth()).toBe(11); // diciembre
  });

  it('año: cambia el año conservando el mes', () => {
    const next = shiftReferenceMonth(ref, 'year', 1);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(5);
  });
});

describe('canShiftReferenceForward — no adelantarse al futuro', () => {
  it('no deja avanzar más allá del periodo actual', () => {
    const now = new Date();
    const currentMonthRef = new Date(now.getFullYear(), now.getMonth(), 1);
    // El mes actual NO puede avanzar (el siguiente mes aún no comienza).
    expect(canShiftReferenceForward(currentMonthRef, 'month')).toBe(false);
    // Estar en el periodo actual equivale a no poder avanzar.
    expect(isReferenceAtCurrentPeriod(currentMonthRef, 'month')).toBe(true);
  });

  it('sí deja avanzar cuando la referencia está en el pasado', () => {
    const pastRef = new Date(2000, 0, 1);
    expect(canShiftReferenceForward(pastRef, 'month')).toBe(true);
  });

  it('con "all" nunca se avanza', () => {
    expect(canShiftReferenceForward(new Date(2000, 0, 1), 'all')).toBe(false);
  });
});

describe('clampReferenceToPresent', () => {
  it('recorta una referencia futura al periodo actual', () => {
    const future = new Date(new Date().getFullYear() + 5, 0, 1);
    const clamped = clampReferenceToPresent(future, 'month');
    const now = new Date();
    expect(clamped.getFullYear()).toBe(now.getFullYear());
    expect(clamped.getMonth()).toBe(now.getMonth());
  });

  it('deja intacta una referencia pasada', () => {
    const past = new Date(2010, 3, 1);
    const clamped = clampReferenceToPresent(past, 'month');
    expect(formatDateLocal(clamped)).toBe('2010-04-01');
  });
});

describe('etiquetas de periodo', () => {
  it('trimestre muestra Tn AAAA', () => {
    expect(getQuarterLabel(new Date(2026, 7, 1))).toBe('T3 2026'); // agosto -> Q3
  });

  it('semestre distingue primer y segundo', () => {
    expect(getSemesterLabel(new Date(2026, 2, 1))).toBe('1.er semestre'); // marzo
    expect(getSemesterLabel(new Date(2026, 9, 1))).toBe('2.º semestre'); // octubre
  });
});
