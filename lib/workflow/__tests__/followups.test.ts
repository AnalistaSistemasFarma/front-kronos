import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { businessDaysUntil, checkCommittedDates, classifyRows, type DateTrackingConfig } from '../followups';

/** Fechas comprometidas (2026-11-26, Calidad OLP): no se cambia la fecha, una sola prórroga, avisos antes y al vencer. */
const cfg: DateTrackingConfig = { id_form_field: 1, date_col: 'fecha', extension_col: 'nueva_fecha', status_col: 'estado', done_value: 'Cumplida', warn_business_days: 7, single_extension: true };

describe('Flujos · fechas comprometidas', () => {
  it('la fecha comprometida no se cambia ni se borra la acción; la prórroga es una sola, posterior y antes de vencer', () => {
    const before = [{ accion: 'Comprar equipos', fecha: '2026-12-15', nueva_fecha: '' }];
    expect(checkCommittedDates(before, [{ ...before[0], fecha: '2026-12-30' }], cfg, '2026-11-26')).toMatch('no se cambia');
    expect(checkCommittedDates(before, [], cfg, '2026-11-26')).toMatch('no se borra');
    expect(checkCommittedDates(before, [{ ...before[0], nueva_fecha: '2026-12-10' }], cfg, '2026-11-26')).toMatch('posterior');
    expect(checkCommittedDates(before, [{ ...before[0], nueva_fecha: '2027-01-15' }], cfg, '2026-12-20')).toMatch('antes de que venza');
    expect(checkCommittedDates(before, [{ ...before[0], nueva_fecha: '2027-01-15' }], cfg, '2026-11-26')).toBeNull();
    const extended = [{ ...before[0], nueva_fecha: '2027-01-15' }];
    expect(checkCommittedDates(extended, [{ ...before[0], nueva_fecha: '2027-02-15' }], cfg, '2026-11-26')).toMatch('una prórroga');
    expect(checkCommittedDates([], [{ accion: 'Nueva', fecha: '2026-12-20' }], cfg, '2026-11-26')).toBeNull();
  });

  it('días hábiles sin fines de semana ni festivos de Colombia', () => {
    expect(businessDaysUntil('2026-11-27', '2026-11-30')).toBe(1); // viernes → lunes
    expect(businessDaysUntil('2026-12-07', '2026-12-09')).toBe(1); // 8 de diciembre es festivo
    expect(businessDaysUntil('2026-11-30', '2026-11-27')).toBe(-1);
  });

  it('clasifica vencidas y por vencer (usa la prórroga si existe) y omite las cumplidas', () => {
    const rows = [
      { accion: 'Vencida', fecha: '2026-11-20' },
      { accion: 'Prorrogada', fecha: '2026-11-20', nueva_fecha: '2026-12-01' },
      { accion: 'Lejana', fecha: '2027-03-01' },
      { accion: 'Hecha', fecha: '2026-11-01', estado: 'Cumplida' },
    ];
    const c = classifyRows(rows, cfg, '2026-11-26');
    expect(c.overdue.map((r) => r.label)).toEqual(['Vencida']);
    expect(c.dueSoon.map((r) => [r.label, r.extended])).toEqual([['Prorrogada', true]]);
  });

  it('SQL: PRUEBAS y PROD iguales con guarda, solo aditivo, trabajo diario sembrado y reversa con bandera', () => {
    const root = path.resolve(__dirname, '../../..');
    const leer = (p: string) => readFileSync(path.join(root, p), 'utf8');
    const pr = leer('prisma/manual/2026-11-26-flujos-fechas-eficacia-PRUEBAS.sql');
    const pd = leer('prisma/manual/2026-11-26-flujos-fechas-eficacia-PROD.sql');
    const rv = leer('prisma/manual/2026-11-26-flujos-fechas-eficacia-reversa.sql');
    const cuerpo = (s: string) => s.slice(s.indexOf('BEGIN TRY'));
    expect(cuerpo(pr)).toBe(cuerpo(pd));
    expect(pd.indexOf("DB_NAME() <> N'KRONOSDB'")).toBeLessThan(pd.indexOf('BEGIN TRY'));
    expect(cuerpo(pd)).toContain("job_type = N'workflow_followups'");
    expect(cuerpo(pd)).not.toMatch(/DROP |DELETE FROM|UPDATE dbo\./);
    expect(rv).toContain("SESSION_CONTEXT(N'flujos_fechas_reversa_acepta_perdida')");
  });
});
