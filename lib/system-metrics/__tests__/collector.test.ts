import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const insertProcessSample = vi.fn(async (..._args: unknown[]) => {});
const insertRouteSummaries = vi.fn(async (..._args: unknown[]) => {});
const insertDbSample = vi.fn(async () => {});
const deleteOldMetrics = vi.fn(async () => 0);

vi.mock('../../mssqlPool', () => ({ getPool: vi.fn(async () => ({})) }));
vi.mock('../dbProbe', () => ({
  probeDatabase: vi.fn(async () => ({ hasServerState: false })),
}));
vi.mock('../store', () => ({
  insertProcessSample,
  insertRouteSummaries,
  insertDbSample,
  deleteOldMetrics,
  isMissingTableError: (e: { number?: number }) => e?.number === 208,
}));

describe('collector (peticiones reales, base simulada)', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    process.env.SYSTEM_METRICS_ENABLED = 'true';
    globalThis.__kronosSystemMetrics = undefined;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    server = http.createServer((req, res) => {
      res.statusCode = req.url?.startsWith('/api/falla') ? 500 : 200;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { startSystemMetrics } = await import('../collector');
    startSystemMetrics();
  });

  afterAll(async () => {
    vi.useRealTimers();
    clearInterval(globalThis.__kronosSystemMetrics?.timer);
    globalThis.__kronosSystemMetrics = undefined;
    delete process.env.SYSTEM_METRICS_ENABLED;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('cuenta peticiones entrantes y salientes y guarda el resumen', async () => {
    await fetch(`${baseUrl}/api/demo/123?x=1`);
    await fetch(`${baseUrl}/api/demo/456`);
    await fetch(`${baseUrl}/api/falla`);

    // Un minuto: se guarda la muestra del proceso.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(insertProcessSample).toHaveBeenCalledTimes(1);
    const sample = insertProcessSample.mock.calls[0][1] as unknown as Record<string, number>;
    expect(sample.httpRequests).toBe(3);
    expect(sample.httpErrors).toBe(1);
    expect(sample.outRequests).toBe(3);
    expect(sample.rssMb).toBeGreaterThan(0);

    // Cinco minutos: se guarda el detalle por ruta.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(insertRouteSummaries).toHaveBeenCalledTimes(1);
    const rows = insertRouteSummaries.mock.calls[0][4] as unknown as Array<Record<string, unknown>>;
    const demo = rows.find((r) => r.direction === 'in' && r.key === 'GET /api/demo/:id');
    expect(demo).toMatchObject({ requests: 2, module: 'demo', errors: 0 });
    expect(rows.find((r) => r.direction === 'in' && r.key === 'GET /api/falla')).toMatchObject({ errors: 1 });
    const out = rows.find((r) => r.direction === 'out');
    expect(out).toMatchObject({ key: new URL(baseUrl).host, requests: 3, errors: 1 });

    // La instancia principal también toma la foto de SQL.
    expect(insertDbSample).toHaveBeenCalled();
  });
});
