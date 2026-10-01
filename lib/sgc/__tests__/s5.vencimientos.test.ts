import { describe, expect, it } from 'vitest';
import { filterCalendarItems, groupByDate, longDate, monthGrid, monthLabel, shiftMonth, startOfWeek, weekDays, type SgcCalendarItem } from '../calendar';
import { SGC_REVIEW_STATE_LABELS } from '../review';
import {
  SGC_ALERT_TITLES,
  SGC_CALENDAR_STATE_COLORS,
  SGC_CALENDAR_STATE_LABELS,
  SGC_DEFAULT_ALERT_OFFSETS,
  addDays,
  alertBody,
  alertKey,
  daysBetween,
  getCalendarState,
  normalizeAlertOffsets,
  normalizeExtraEmails,
  parseStoredOffsets,
  planReviewAlert,
  resolveAlertConfig,
  type SgcAlertConfigRow,
} from '../reviewAlerts';

/**
 * Sprint 5 — vencimientos: cálculo de fechas y ventanas de aviso con RELOJ
 * CONTROLADO, estados y colores del calendario, configuración efectiva y
 * vistas (mes, semana, agenda). La ejecución contra la base está en
 * tests/integration/sgc/vencimientos.integration.test.ts.
 */

const DUE = '2026-12-31';

/** Simula el programador día a día y devuelve qué salió cada día. */
function simulate(from: string, to: string, opts: { offsets?: number[]; every?: number; skip?: Set<string> } = {}) {
  const already = new Set<string>();
  const sent: { day: string; kind: string; offset: number }[] = [];
  const omitted: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1).toISOString().slice(0, 10)) {
    if (opts.skip?.has(d)) continue; // el programador no corrió ese día
    const plan = planReviewAlert({ idVersion: 9, dueDate: DUE, today: d, offsets: opts.offsets ?? SGC_DEFAULT_ALERT_OFFSETS, overdueEveryDays: opts.every ?? 7, already });
    for (const o of plan.omit) {
      already.add(o.key);
      omitted.push(`${o.kind}:${o.offsetDays}`);
    }
    if (plan.send) {
      already.add(plan.send.key);
      sent.push({ day: d, kind: plan.send.kind, offset: plan.send.offsetDays });
    }
  }
  return { sent, omitted };
}

describe('SGC · S5 · ventanas de aviso con reloj controlado', () => {
  it('[SGC-REQ-068] por defecto avisa a 60, 30, 15 y 7 días y el día del vencimiento, cada uno UNA sola vez y en su día', () => {
    const { sent, omitted } = simulate('2026-10-01', '2026-12-31');
    expect(sent).toEqual([
      { day: '2026-11-01', kind: 'anticipado', offset: 60 },
      { day: '2026-12-01', kind: 'anticipado', offset: 30 },
      { day: '2026-12-16', kind: 'anticipado', offset: 15 },
      { day: '2026-12-24', kind: 'anticipado', offset: 7 },
      { day: '2026-12-31', kind: 'vencimiento', offset: 0 },
    ]);
    expect(omitted).toEqual([]);
  });

  it('[SGC-REQ-069] vencido: sigue escalando a Calidad cada N días (7 por defecto, configurable), una vez por ciclo', () => {
    const { sent } = simulate('2026-12-31', '2027-01-25');
    expect(sent.map((s) => `${s.day}:${s.kind}:${s.offset}`)).toEqual([
      '2026-12-31:vencimiento:0',
      '2027-01-07:vencido:7',
      '2027-01-14:vencido:14',
      '2027-01-21:vencido:21',
    ]);
    const quincenal = simulate('2026-12-31', '2027-01-31', { every: 15 });
    expect(quincenal.sent.map((s) => s.offset)).toEqual([0, 15, 30]);
    // Un valor inválido de repetición cae al valor por defecto (nunca deja de escalar).
    expect(planReviewAlert({ idVersion: 1, dueDate: DUE, today: '2027-01-07', offsets: [0], overdueEveryDays: 0, already: new Set() }).send?.offsetDays).toBe(7);
  });

  it('[SGC-REQ-068] si el programador no corrió el día de un aviso, sale SOLO el más urgente y los atrasados quedan «omitidos»', () => {
    // No corrió del 31-oct al 20-nov: el 21-nov sale el de 60 días (tarde, una vez).
    const skip = new Set(Array.from({ length: 21 }, (_, i) => addDays('2026-10-31', i).toISOString().slice(0, 10)));
    expect(simulate('2026-10-25', '2026-11-30', { skip }).sent).toEqual([{ day: '2026-11-21', kind: 'anticipado', offset: 60 }]);
    // Primera corrida a 10 días del vencimiento: sale el de 15 y quedan omitidos el de 60 y el de 30.
    const late = planReviewAlert({ idVersion: 9, dueDate: DUE, today: '2026-12-21', offsets: SGC_DEFAULT_ALERT_OFFSETS, overdueEveryDays: 7, already: new Set() });
    expect(late.send).toMatchObject({ kind: 'anticipado', offsetDays: 15, scheduledFor: '2026-12-16' });
    expect(late.omit.map((o) => o.offsetDays)).toEqual([60, 30]);
    // Primera corrida ya vencido (20 días): sale el ciclo 14 y el día del vencimiento queda omitido.
    const overdue = planReviewAlert({ idVersion: 9, dueDate: DUE, today: '2027-01-20', offsets: SGC_DEFAULT_ALERT_OFFSETS, overdueEveryDays: 7, already: new Set() });
    expect(overdue.send).toMatchObject({ kind: 'vencido', offsetDays: 14, scheduledFor: '2027-01-14' });
    expect(overdue.omit.map((o) => `${o.kind}:${o.offsetDays}`).sort()).toEqual(['anticipado:15', 'anticipado:30', 'anticipado:60', 'anticipado:7', 'vencimiento:0']);
    // Vencido hace 3 días sin aviso del día: sale el del día (tarde).
    expect(planReviewAlert({ idVersion: 9, dueDate: DUE, today: '2027-01-03', offsets: [0], overdueEveryDays: 7, already: new Set() }).send).toMatchObject({ kind: 'vencimiento', offsetDays: 0 });
  });

  it('[SGC-REQ-068] avisos configurables por tipo o documento: otros días, sin «el día», y la clave cambia con la versión y la fecha', () => {
    expect(simulate('2026-10-01', '2026-12-31', { offsets: [45, 10] }).sent.map((s) => `${s.day}:${s.offset}`)).toEqual(['2026-11-16:45', '2026-12-21:10']);
    expect(alertKey(9, DUE, 'anticipado', 30)).toBe('v9|2026-12-31|anticipado|30');
    expect(alertKey(10, DUE, 'anticipado', 30)).not.toBe(alertKey(9, DUE, 'anticipado', 30));
    expect(planReviewAlert({ idVersion: 9, dueDate: DUE, today: '2026-06-01', offsets: [60], overdueEveryDays: 7, already: new Set() })).toEqual({ send: null, omit: [] });
  });

  it('[SGC-REQ-068] días de aviso: enteros de 0 a 365, sin repetir, de mayor a menor, máximo 10', () => {
    expect(normalizeAlertOffsets('7, 60 ;30 15 0 7')).toEqual({ offsets: [60, 30, 15, 7, 0] });
    expect(normalizeAlertOffsets([1])).toEqual({ offsets: [1] });
    expect(normalizeAlertOffsets([])).toHaveProperty('error');
    expect(normalizeAlertOffsets('')).toHaveProperty('error');
    expect(normalizeAlertOffsets(null)).toHaveProperty('error');
    expect(normalizeAlertOffsets([-1])).toHaveProperty('error');
    expect(normalizeAlertOffsets([1.5])).toHaveProperty('error');
    expect(normalizeAlertOffsets([366])).toHaveProperty('error');
    expect(normalizeAlertOffsets(Array.from({ length: 11 }, (_, i) => i))).toHaveProperty('error');
    expect(parseStoredOffsets('[30,0]')).toEqual([30, 0]);
    expect(parseStoredOffsets('no-json')).toEqual([...SGC_DEFAULT_ALERT_OFFSETS]);
    expect(parseStoredOffsets('[]')).toEqual([...SGC_DEFAULT_ALERT_OFFSETS]);
    expect(parseStoredOffsets(null)).toEqual([...SGC_DEFAULT_ALERT_OFFSETS]);
  });

  it('[SGC-REQ-067] cálculo de fechas de calendario', () => {
    expect(daysBetween('2026-12-01', '2026-12-31')).toBe(30);
    expect(daysBetween('2027-01-07', '2026-12-31')).toBe(-7);
    expect(addDays('2026-12-31', 1).toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1).toISOString().slice(0, 10)).toBe('2024-02-29');
  });
});

describe('SGC · S5 · estado y colores del calendario', () => {
  const base = { today: '2026-10-01', firstAlertDays: 60, hasOpenRequest: false };
  it('[SGC-REQ-067] al día, próximo a vencer, en revisión y «vencido — en revisión» (que sigue vigente)', () => {
    expect(getCalendarState({ ...base, dueDate: '2027-01-01' })).toBe('al_dia');
    expect(getCalendarState({ ...base, dueDate: '2026-11-30' })).toBe('proximo');
    expect(getCalendarState({ ...base, dueDate: '2026-11-30', hasOpenRequest: true })).toBe('en_revision');
    expect(getCalendarState({ ...base, dueDate: '2026-10-01' })).toBe('vencido');
    expect(getCalendarState({ ...base, dueDate: '2026-09-01', hasOpenRequest: true })).toBe('vencido');
    expect(getCalendarState({ ...base, dueDate: null })).toBe('sin_fecha');
    expect(getCalendarState({ ...base, dueDate: '2026-10-05', firstAlertDays: -3 })).toBe('al_dia');
    expect(SGC_CALENDAR_STATE_LABELS.vencido).toBe('Vencido — en revisión');
    expect(SGC_REVIEW_STATE_LABELS.vencido).toBe('Vencido — en revisión');
    expect(SGC_CALENDAR_STATE_COLORS).toMatchObject({ al_dia: 'teal', proximo: 'yellow', vencido: 'red', en_revision: 'blue' });
  });

  it('[SGC-REQ-068] configuración efectiva: documento > tipo documental > empresa > por defecto; los adicionales se suman', () => {
    const row = (p: Partial<SgcAlertConfigRow>): SgcAlertConfigRow => ({ scope: 'empresa', idDocumentType: null, idDocument: null, offsets: [60, 30, 15, 7, 0], overdueEveryDays: 7, readingReminderDays: 7, emailEnabled: true, extraEmails: [], isActive: true, ...p });
    const rows = [
      row({ extraEmails: ['A@x.co'] }),
      row({ scope: 'tipo', idDocumentType: 5, offsets: [90, 30], overdueEveryDays: 15, extraEmails: ['b@x.co', 'a@x.co'] }),
      row({ scope: 'documento', idDocument: 77, offsets: [10], extraEmails: ['c@x.co'] }),
      row({ scope: 'documento', idDocument: 78, offsets: [1], isActive: false }),
    ];
    expect(resolveAlertConfig(rows, { idDocumentType: 5, idDocument: 77 })).toEqual({ source: 'documento', offsets: [10], overdueEveryDays: 7, emailEnabled: true, extraEmails: ['a@x.co', 'b@x.co', 'c@x.co'] });
    expect(resolveAlertConfig(rows, { idDocumentType: 5, idDocument: 78 })).toMatchObject({ source: 'tipo', offsets: [90, 30], overdueEveryDays: 15 });
    expect(resolveAlertConfig(rows, { idDocumentType: 6, idDocument: 1 })).toMatchObject({ source: 'empresa', extraEmails: ['a@x.co'] });
    expect(resolveAlertConfig([row({ emailEnabled: false })], { idDocumentType: 1, idDocument: 1 }).emailEnabled).toBe(false);
    expect(resolveAlertConfig([], { idDocumentType: 1, idDocument: 1 })).toEqual({ source: 'defecto', offsets: [...SGC_DEFAULT_ALERT_OFFSETS], overdueEveryDays: 7, emailEnabled: true, extraEmails: [] });
  });

  it('[SGC-REQ-068] destinatarios adicionales: correos válidos sin repetir, máximo 20', () => {
    expect(normalizeExtraEmails('A@x.co, b@x.co;a@x.co')).toEqual({ emails: ['a@x.co', 'b@x.co'] });
    expect(normalizeExtraEmails(['c@x.co'])).toEqual({ emails: ['c@x.co'] });
    expect(normalizeExtraEmails(null)).toEqual({ emails: [] });
    expect(normalizeExtraEmails(undefined)).toEqual({ emails: [] });
    expect(normalizeExtraEmails(5)).toHaveProperty('error');
    expect(normalizeExtraEmails('no-es-correo')).toHaveProperty('error');
    expect(normalizeExtraEmails(Array.from({ length: 21 }, (_, i) => `p${i}@x.co`))).toHaveProperty('error');
  });

  it('[SGC-REQ-070] textos de los avisos: anticipado, el día y vencido (sigue vigente, escalado a Calidad)', () => {
    const b = { code: 'OLP-GC-PR-001', versionNumber: 2, title: 'Control de documentos', dueDate: DUE, openRequestId: null };
    expect(alertBody({ ...b, kind: 'anticipado', offsetDays: 30 })).toContain('vence en 30 días (2026-12-31)');
    expect(alertBody({ ...b, kind: 'anticipado', offsetDays: 1 })).toContain('vence en 1 día ');
    expect(alertBody({ ...b, kind: 'vencimiento', offsetDays: 0 })).toContain('vence hoy');
    expect(alertBody({ ...b, kind: 'vencido', offsetDays: 7, openRequestId: 12 })).toMatch(/sigue vigente.*solicitud #12 en curso/);
    expect(SGC_ALERT_TITLES.vencido).toContain('escalado a Calidad');
  });
});

describe('SGC · S5 · vistas del calendario', () => {
  const item = (p: Partial<SgcCalendarItem>): SgcCalendarItem => ({
    idDocument: 1, code: 'OLP-GC-PR-001', title: 'Control', versionNumber: 1, idVersion: 1, dueDate: '2026-10-20', state: 'proximo', idProcessType: 1, processType: 'Misionales', processTypeColor: 'blue',
    idProcess: 10, process: 'GC · Gestión de calidad', idDepartment: 3, department: 'Calidad', idDocumentType: 5, documentType: 'PR · Procedimiento', owners: ['a@x.co'], lastElaborator: 'b@x.co',
    responsibles: ['a@x.co', 'b@x.co'], openRequestId: null, isMine: true, confidentiality: 'publica', offsets: [60, 30, 15, 7, 0], ...p,
  });

  it('[SGC-REQ-067] mes de lunes a domingo con semanas completas; semana; agenda ordenada por fecha', () => {
    const oct = monthGrid(2026, 10);
    expect(oct[0][0]).toEqual({ date: '2026-09-28', inMonth: false });
    expect(oct.at(-1)!.at(-1)).toEqual({ date: '2026-11-01', inMonth: false });
    expect(oct.every((w) => w.length === 7)).toBe(true);
    expect(oct.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(monthGrid(2027, 2).length).toBe(4); // feb-2027 empieza en lunes
    expect(weekDays('2026-10-01')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(startOfWeek('2026-10-04').toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthLabel(2026, 10)).toBe('octubre de 2026');
    expect(longDate('2026-05-13')).toBe('13 de mayo de 2026');
    const groups = groupByDate([item({ idDocument: 2, code: 'B', dueDate: '2026-10-20' }), item({ code: 'A', dueDate: '2026-10-20' }), item({ code: 'C', dueDate: '2026-10-01' }), item({ dueDate: null })], null, null);
    expect(groups.map((g) => [g.date, g.items.map((i) => i.code)])).toEqual([['2026-10-01', ['C']], ['2026-10-20', ['A', 'B']]]);
    expect(groupByDate([item({ dueDate: '2026-10-01' }), item({ dueDate: '2026-12-01' })], '2026-10-02', '2026-11-30')).toEqual([]);
  });

  it('[SGC-REQ-067] filtros por área, proceso, tipo documental, responsable, estado, texto y «Mis vencimientos»', () => {
    const items = [item({}), item({ idDocument: 2, code: 'OLP-GC-FO-002', title: 'Formato', idDepartment: 4, idProcess: 11, idDocumentType: 6, responsibles: ['z@x.co'], state: 'vencido', isMine: false })];
    expect(filterCalendarItems(items, {}).length).toBe(2);
    expect(filterCalendarItems(items, { mine: true }).map((i) => i.idDocument)).toEqual([1]);
    expect(filterCalendarItems(items, { idDepartment: 4 }).map((i) => i.idDocument)).toEqual([2]);
    expect(filterCalendarItems(items, { idProcess: 10 }).map((i) => i.idDocument)).toEqual([1]);
    expect(filterCalendarItems(items, { idDocumentType: 6 }).map((i) => i.idDocument)).toEqual([2]);
    expect(filterCalendarItems(items, { responsible: 'Z@x.co' }).map((i) => i.idDocument)).toEqual([2]);
    expect(filterCalendarItems(items, { states: ['proximo'] }).map((i) => i.idDocument)).toEqual([1]);
    expect(filterCalendarItems(items, { states: [] }).length).toBe(2);
    expect(filterCalendarItems(items, { text: 'formato' }).map((i) => i.idDocument)).toEqual([2]);
    expect(filterCalendarItems(items, { text: 'fo-002' }).map((i) => i.idDocument)).toEqual([2]);
  });
});
