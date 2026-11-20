import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetSapCallMetricsForTests,
  beginSapCall,
  getSapLiveStats,
  noteSapLogin,
  noteSapLogout,
  sapMetricKey,
} from '../callMetrics';

describe('callMetrics Service Layer', () => {
  beforeEach(() => {
    __resetSapCallMetricsForTests();
  });

  it('cuenta inflight y registra latencia al terminar', async () => {
    const end = beginSapCall('https://sl.example:50000/b1s/v1/Items', 'FARMALOGICA_PROD');
    let mid = getSapLiveStats().find((s) => s.companyDB === 'FARMALOGICA_PROD');
    expect(mid?.inflight).toBe(1);

    await new Promise((r) => setTimeout(r, 5));
    end(200);

    mid = getSapLiveStats().find((s) => s.companyDB === 'FARMALOGICA_PROD');
    expect(mid?.inflight).toBe(0);
    expect(mid?.requests).toBe(1);
    expect(mid?.errors).toBe(0);
    expect(mid?.p95Ms).toBeGreaterThanOrEqual(0);
    expect(mid?.peakInflight).toBe(1);
  });

  it('cuenta errores en status 0 o >=400', () => {
    beginSapCall('https://sl.example:50000/b1s/v1/Login', 'OLP')(500);
    beginSapCall('https://sl.example:50000/b1s/v1/Login', 'OLP')(0);
    beginSapCall('https://sl.example:50000/b1s/v1/Login', 'OLP')(200);
    const row = getSapLiveStats().find((s) => s.companyDB === 'OLP');
    expect(row?.requests).toBe(3);
    expect(row?.errors).toBe(2);
  });

  it('sesiones abiertas por login/logout', () => {
    noteSapLogin('sess-1', 'https://sl.example:50000', 'GSS', Date.now() + 60_000);
    noteSapLogin('sess-2', 'https://sl.example:50000', 'GSS', Date.now() + 60_000);
    expect(getSapLiveStats().find((s) => s.companyDB === 'GSS')?.openSessions).toBe(2);
    noteSapLogout('sess-1');
    expect(getSapLiveStats().find((s) => s.companyDB === 'GSS')?.openSessions).toBe(1);
  });

  it('normaliza la clave host|companyDB', () => {
    expect(sapMetricKey('SL.Example:50000', ' farmalogica_prod ')).toBe(
      'sl.example:50000|FARMALOGICA_PROD'
    );
  });
});
