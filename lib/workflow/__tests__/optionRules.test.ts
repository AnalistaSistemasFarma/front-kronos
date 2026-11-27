import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatConsecutive, normalizePrefix, pickRules } from '../optionRules';

/** Option rules of flows (2026-11-24, Calidad OLP): consecutive AU/NC, SLA by classification, assignee by area. */
describe('Flujos · reglas por opción', () => {
  it('el consecutivo lleva prefijo y 4 dígitos (crece si hace falta)', () => {
    expect(formatConsecutive('AU', 7)).toBe('AU-0007');
    expect(formatConsecutive('NC', 12345)).toBe('NC-12345');
  });

  it('el prefijo se normaliza a mayúsculas; vacío = sin consecutivo; con espacios o guiones se rechaza', () => {
    expect(normalizePrefix(' au ')).toBe('AU');
    expect(normalizePrefix('')).toBeNull();
    expect(() => normalizePrefix('A-U')).toThrow('prefijo');
    expect(() => normalizePrefix('DEMASIADOLARGO')).toThrow('prefijo');
  });

  it('gana la primera regla por orden del campo y la opción; sin regla de prefijo se usa el del flujo', () => {
    const rules = [
      { id_option: 2, prefix: null, sla_value: 8, sla_unit: 'business_days', order: 2001 },
      { id_option: 1, prefix: 'AU', sla_value: null, sla_unit: null, order: 1001 },
    ];
    expect(pickRules(rules, 'NC')).toEqual({ prefix: 'AU', sla: { value: 8, unit: 'business_days' } });
    expect(pickRules([rules[0]!], 'NC')).toEqual({ prefix: 'NC', sla: { value: 8, unit: 'business_days' } });
    expect(pickRules([], null)).toEqual({ prefix: null, sla: null });
  });
});

describe('Flujos · reglas por opción · SQL', () => {
  const root = path.resolve(__dirname, '../../..');
  const leer = (p: string) => readFileSync(path.join(root, p), 'utf8');
  const pruebas = leer('prisma/manual/2026-11-24-flujos-reglas-opcion-PRUEBAS.sql');
  const prod = leer('prisma/manual/2026-11-24-flujos-reglas-opcion-PROD.sql');
  const reversa = leer('prisma/manual/2026-11-24-flujos-reglas-opcion-reversa.sql');
  const cuerpo = (s: string) => s.slice(s.indexOf('BEGIN TRY'));

  it('PRUEBAS y PROD llevan el mismo cuerpo con su guarda; solo aditivo; reversa con bandera', () => {
    expect(cuerpo(pruebas)).toBe(cuerpo(prod));
    expect(prod.indexOf("DB_NAME() <> N'KRONOSDB'")).toBeLessThan(prod.indexOf('BEGIN TRY'));
    expect(cuerpo(prod)).not.toMatch(/DROP |DELETE FROM|UPDATE dbo\./);
    expect(cuerpo(prod)).toContain('CONSTRAINT UQ_task_option_assignee UNIQUE (id_task, id_option)');
    expect(reversa).toContain("SESSION_CONTEXT(N'flujos_reglas_reversa_acepta_perdida')");
    expect(reversa.indexOf('THROW 51823')).toBeLessThan(reversa.indexOf('DROP TABLE'));
  });

  it('los objetos nuevos quedan en la lista del despliegue azul/verde', () => {
    const o = JSON.parse(leer('prisma/manual/objetos-requeridos.json')) as { columnas: string[][]; tablas: string[] };
    expect(o.columnas).toEqual(expect.arrayContaining([['requests_general', 'consecutive'], ['requests_general', 'sla_value'], ['process_category', 'consecutive_prefix']]));
    expect(o.tablas).toEqual(expect.arrayContaining(['process_option_rule', 'task_option_assignee', 'request_consecutive_counter']));
  });
});
