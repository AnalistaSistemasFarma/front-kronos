import { afterEach, describe, expect, it } from 'vitest';
import { classifyAccount, statementKind } from '../sqlLive.js';

describe('cuentas conectadas a SAPSEND', () => {
  it('servidor SERFARMA con un programa normal = servicio', () => {
    expect(classifyAccount('AdminSAPSEND', 'SERFARMA05', '.Net SqlClient Data Provider').type).toBe('servicio');
  });
  it('SSMS o Excel = persona, aunque sea desde el servidor', () => {
    expect(classifyAccount('GSS\\ana', 'PC-ANA', 'Microsoft SQL Server Management Studio - Query').type).toBe('persona');
    expect(classifyAccount('AdminSAPSEND', 'SERFARMA05', 'Microsoft SQL Server Management Studio').type).toBe('persona');
    expect(classifyAccount('lector', 'PC-LUIS', 'Microsoft Office 2016').type).toBe('persona');
  });
  it('cuenta de Windows desde un equipo personal = persona', () => {
    expect(classifyAccount('GSSLATAM\\pedro', 'LAPTOP-PEDRO', 'algo').type).toBe('persona');
  });
  it('SSMS con el usuario compartido AdminSAPSEND lo dice en el motivo', () => {
    const r = classifyAccount('AdminSAPSEND', 'POR005', 'Microsoft SQL Server Management Studio - Query');
    expect(r.type).toBe('persona');
    expect(r.reason).toContain('usuario compartido AdminSAPSEND');
  });
  it('usuario SQL desde otra máquina = revisar', () => {
    expect(classifyAccount('appuser', 'OTRO-SERVIDOR', 'MiApp').type).toBe('revisar');
  });
});
import {
  __resetSapsendAlertsForTests,
  buildSapsendHighlights,
  evaluateSapsendAlerts,
} from '../earlyWarnings.js';

afterEach(() => __resetSapsendAlertsForTests());

const company = (over = {}) => ({
  company: 'GSS',
  sapsend: { sessions: 2, running: 0, blocked: 0 },
  sl: { host: 'sl:50000', inflight: 0, pulse: { ok: true, latencyMs: 200, error: null } },
  ...over,
});

const base = {
  companies: [company()],
  blocks: [],
  runningNow: [],
  hasServerState: true,
  health: { ok: true, skipped: false, latencyMs: 100 },
};

describe('tipo de consulta', () => {
  it('distingue lectura, escritura y procedimiento', () => {
    expect(statementKind('SELECT * FROM t')).toBe('lectura');
    expect(statementKind('(@P1 int)UPDATE t SET a=@P1')).toBe('escritura');
    expect(statementKind('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')).toBe('escritura');
    expect(statementKind('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('lectura');
    expect(statementKind('/* c */ EXEC sp_x')).toBe('procedimiento');
  });
});

describe('alertas tempranas SAPSEND', () => {
  it('todo sano: sin alertas y con "lo que va bien"', () => {
    expect(evaluateSapsendAlerts(base, 'h').alerts).toHaveLength(0);
    const ids = buildSapsendHighlights(base).map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['sl-ok', 'no-blocks', 'no-slow', 'concurrency-ok', 'sapsend-up']));
  });

  it('bloqueo y Service Layer caído levantan alertas críticas', () => {
    const r = evaluateSapsendAlerts(
      {
        ...base,
        blocks: [{ blockingSessionId: 1, blockedSessionId: 2, waitMs: 4000, database: 'SAPSEND_GSS' }],
        companies: [company({ sl: { host: 'sl:50000', inflight: 0, pulse: { ok: false, latencyMs: null, error: 'Timeout' } } })],
      },
      'h'
    );
    expect(r.alerts.map((a) => a.rule).sort()).toEqual(['bloqueos', 'service-layer-caido']);
    expect(r.alerts.every((a) => a.severity === 'critical')).toBe(true);
  });

  it('la misma condición seguida no duplica la alerta', () => {
    const input = { ...base, health: { ok: false, skipped: false, latencyMs: 8000, error: 'Timeout' } };
    evaluateSapsendAlerts(input, 'h');
    const r = evaluateSapsendAlerts(input, 'h');
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].rule).toBe('sapsend-caido');
  });

  it('empresa sin Service Layer configurado no rompe', () => {
    expect(() => evaluateSapsendAlerts({ ...base, companies: [company({ sl: null })] }, 'h')).not.toThrow();
    expect(() => buildSapsendHighlights({ ...base, companies: [company({ sl: null })] })).not.toThrow();
  });

  it('varias empresas en el mismo Service Layer lento: una sola alerta', () => {
    const slow = { host: 'sl:50000', inflight: 0, pulse: { ok: true, latencyMs: 4000, error: null } };
    const r = evaluateSapsendAlerts(
      { ...base, companies: [company({ company: 'A', sl: slow }), company({ company: 'B', sl: slow })] },
      'h'
    );
    expect(r.alerts.filter((a) => a.rule === 'service-layer-lento')).toHaveLength(1);
  });
});
