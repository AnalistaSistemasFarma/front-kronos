import { describe, it, expect } from 'vitest';
import {
  normalizeHelpDeskTechnicianId,
  TECHNICIAN_PERSON_FILTER_SQL,
  TECHNICIAN_UNASSIGNED_FILTER_SQL,
  TECHNICIAN_UNASSIGNED_VALUE,
} from '../requesterSql';

// El dropdown "Técnico asignado" envía UN id_subprocess_user_company, pero una
// persona puede tener varias filas en subprocess_user_company (por empresa o
// subproceso) y sus casos quedar repartidos entre ellas. El filtro debe resolver
// la PERSONA (id_user) y traer los casos de TODOS sus id_subprocess_user_company,
// no solo el id que envió el dropdown.

describe('TECHNICIAN_PERSON_FILTER_SQL', () => {
  const sql = TECHNICIAN_PERSON_FILTER_SQL.replace(/\s+/g, ' ').trim();

  it('filtra por c.id_technical con un IN (…) en vez de igualdad a un solo id', () => {
    expect(sql).toMatch(/c\.id_technical\s+IN\s*\(/i);
    expect(sql).not.toMatch(/c\.id_technical\s*=\s*@technician/i);
  });

  it('mantiene @technician como único parámetro de entrada', () => {
    const params = sql.match(/@\w+/g) ?? [];
    expect([...new Set(params)]).toEqual(['@technician']);
  });

  it('resuelve la persona (id_user) del @technician recibido', () => {
    expect(sql).toMatch(/WHERE\s+ss\.id_subprocess_user_company\s*=\s*@technician/i);
    expect(sql).toMatch(/ca\.id_user\s*=\s*\(/i);
    expect(sql).toMatch(/SELECT\s+sa\.id_subprocess_user_company/i);
  });

  it('recorre subprocess_user_company vía company_user (todas las empresas de la persona)', () => {
    expect(sql).toMatch(/subprocess_user_company/i);
    expect(sql).toMatch(/company_user/i);
  });
});

describe('TECHNICIAN_UNASSIGNED_FILTER_SQL', () => {
  const sql = TECHNICIAN_UNASSIGNED_FILTER_SQL.replace(/\s+/g, ' ').trim();

  it('incluye NULL y 0 como sin asignar', () => {
    expect(sql).toMatch(/c\.id_technical\s+IS\s+NULL/i);
    expect(sql).toMatch(/c\.id_technical\s*=\s*0/i);
  });

  it('usa NOT EXISTS para no depender de LEFT JOIN del SELECT (evita falsos positivos)', () => {
    expect(sql).toMatch(/NOT\s+EXISTS/i);
    expect(sql).toMatch(/subprocess_user_company\s+suc_u/i);
    expect(sql).toMatch(/NULLIF\s*\(\s*LTRIM\s*\(\s*RTRIM\s*\(\s*u_u\.name\s*\)\s*\)\s*,\s*''\s*\)/i);
    // No debe usar los alias del SELECT (suc/cu/u) — eso mezclaba casos asignados.
    expect(sql).not.toMatch(/\bsuc\.id_subprocess_user_company\s+IS\s+NULL/i);
    expect(sql).not.toMatch(/\bu\.id\s+IS\s+NULL/i);
  });
});

describe('isTechnicianUnassignedDisplay', () => {
  it('trata vacío / null / espacios como sin asignar', async () => {
    const { isTechnicianUnassignedDisplay } = await import('../requesterSql');
    expect(isTechnicianUnassignedDisplay(null)).toBe(true);
    expect(isTechnicianUnassignedDisplay(undefined)).toBe(true);
    expect(isTechnicianUnassignedDisplay('')).toBe(true);
    expect(isTechnicianUnassignedDisplay('   ')).toBe(true);
    expect(isTechnicianUnassignedDisplay('Rafael Solarte')).toBe(false);
  });
});

describe('normalizeHelpDeskTechnicianId', () => {
  it('convierte vacío / unassigned / 0 a null', () => {
    expect(normalizeHelpDeskTechnicianId(null)).toBeNull();
    expect(normalizeHelpDeskTechnicianId(undefined)).toBeNull();
    expect(normalizeHelpDeskTechnicianId('')).toBeNull();
    expect(normalizeHelpDeskTechnicianId(TECHNICIAN_UNASSIGNED_VALUE)).toBeNull();
    expect(normalizeHelpDeskTechnicianId(0)).toBeNull();
    expect(normalizeHelpDeskTechnicianId('0')).toBeNull();
  });

  it('conserva ids válidos', () => {
    expect(normalizeHelpDeskTechnicianId(42)).toBe(42);
    expect(normalizeHelpDeskTechnicianId('15')).toBe(15);
  });
});
