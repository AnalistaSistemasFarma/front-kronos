import { describe, it, expect } from 'vitest';
import {
  normalizePageParams,
  buildPageSql,
  buildCountSql,
  buildExportSql,
  totalPages,
} from '../pagination';
import { assertReadOnlySql } from '../../sql/readonly';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../access';

const INNER = 'SELECT a, b FROM vw_requests_general';

describe('normalizePageParams', () => {
  it('aplica defaults con entradas ausentes/ inválidas', () => {
    const p = normalizePageParams(undefined, undefined);
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(p.offset).toBe(0);
  });

  it('calcula el offset = (page-1)*pageSize', () => {
    expect(normalizePageParams(1, 50).offset).toBe(0);
    expect(normalizePageParams(2, 50).offset).toBe(50);
    expect(normalizePageParams(4, 5).offset).toBe(15);
    expect(normalizePageParams(3, 20).offset).toBe(40);
  });

  it('page mínimo 1 (rechaza 0, negativos, NaN)', () => {
    expect(normalizePageParams(0, 50).page).toBe(1);
    expect(normalizePageParams(-3, 50).page).toBe(1);
    expect(normalizePageParams('x', 50).page).toBe(1);
  });

  it('pageSize se acota a [1, MAX_PAGE_SIZE]', () => {
    expect(normalizePageParams(1, 0).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageParams(1, 99999).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizePageParams(1, 25).pageSize).toBe(25);
  });

  it('trunca valores fraccionarios', () => {
    const p = normalizePageParams(2.9, 10.7);
    expect(p.page).toBe(2);
    expect(p.pageSize).toBe(10);
    expect(p.offset).toBe(10);
  });
});

describe('buildPageSql', () => {
  it('pagina con OFFSET/FETCH y ORDER BY (SELECT NULL)', () => {
    const sql = buildPageSql(INNER, "Empresa = @f0");
    expect(sql).toContain('OFFSET @__off ROWS FETCH NEXT @__ps ROWS ONLY');
    expect(sql).toContain('ORDER BY (SELECT NULL)');
    expect(sql).toContain('AS _v');
    expect(sql).toContain('WHERE Empresa = @f0');
  });

  it('sin WHERE usa 1 = 1', () => {
    const sql = buildPageSql(INNER, '');
    expect(sql).toContain('WHERE 1 = 1');
  });

  it('quita el ; final del inner', () => {
    const sql = buildPageSql('SELECT 1 AS a FROM vw_requests_general;', '');
    expect(sql).not.toContain(';');
  });

  it('el SQL de página PASA el candado de solo lectura', () => {
    const sql = buildPageSql(INNER, "Empresa = @f0");
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });
});

describe('buildCountSql', () => {
  it('usa COUNT_BIG y el mismo WHERE', () => {
    const sql = buildCountSql(INNER, "Estado = @f0");
    expect(sql).toContain('COUNT_BIG(*) AS total');
    expect(sql).toContain('AS _c');
    expect(sql).toContain('WHERE Estado = @f0');
  });

  it('el SQL de total PASA el candado de solo lectura', () => {
    const sql = buildCountSql(INNER, '');
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });
});

describe('buildExportSql', () => {
  it('usa TOP con el tope y el mismo WHERE', () => {
    const sql = buildExportSql(INNER, "Empresa = @f0", 50000);
    expect(sql).toContain('SELECT TOP (50000)');
    expect(sql).toContain('WHERE Empresa = @f0');
    // El export NO pagina (sin OFFSET/FETCH).
    expect(sql).not.toContain('OFFSET');
  });

  it('el SQL de export PASA el candado de solo lectura', () => {
    const sql = buildExportSql(INNER, '', 50000);
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });
});

describe('totalPages', () => {
  it('calcula el número de páginas', () => {
    expect(totalPages(18, 50)).toBe(1);
    expect(totalPages(18, 5)).toBe(4); // 5+5+5+3
    expect(totalPages(100, 50)).toBe(2);
    expect(totalPages(101, 50)).toBe(3);
  });
  it('total 0 → 0 páginas', () => {
    expect(totalPages(0, 50)).toBe(0);
    expect(totalPages(-1, 50)).toBe(0);
  });
});
