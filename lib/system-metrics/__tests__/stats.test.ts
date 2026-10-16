import { describe, expect, it } from 'vitest';
import {
  DurationWindow,
  hostCpuPercent,
  OVERFLOW_KEY,
  percentile,
  RouteAccumulator,
} from '../stats';

describe('percentile', () => {
  it('nearest-rank sobre datos ordenados', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(data, 95)).toBe(95);
    expect(percentile(data, 50)).toBe(50);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('RouteAccumulator', () => {
  it('cuenta peticiones, errores, 4xx y 429 por clave', () => {
    const acc = new RouteAccumulator();
    const base = { direction: 'in' as const, key: 'GET /api/x', module: 'x' };
    acc.record({ ...base, durationMs: 100, status: 200 });
    acc.record({ ...base, durationMs: 300, status: 500 });
    acc.record({ ...base, durationMs: 50, status: 404 });
    acc.record({ ...base, durationMs: 10, status: 429 });
    acc.record({ ...base, durationMs: null, status: 0 });

    const [row] = acc.drain();
    expect(row).toMatchObject({
      requests: 5,
      errors: 2,
      clientErrors: 1,
      throttled: 1,
      totalMs: 460,
      maxMs: 300,
      avgMs: 115,
      p95Ms: 300,
    });
    expect(acc.size).toBe(0);
  });

  it('separa entrantes de salientes con la misma clave', () => {
    const acc = new RouteAccumulator();
    acc.record({ direction: 'in', key: 'k', module: 'm', durationMs: 1, status: 200 });
    acc.record({ direction: 'out', key: 'k', module: 'm', durationMs: 1, status: 200 });
    expect(acc.drain()).toHaveLength(2);
  });

  it('manda las claves que pasan el tope a "(otras rutas)"', () => {
    const acc = new RouteAccumulator();
    for (let i = 0; i < 305; i += 1) {
      acc.record({ direction: 'in', key: `GET /r${i}`, module: 'm', durationMs: 1, status: 200 });
    }
    const rows = acc.drain();
    expect(rows).toHaveLength(301);
    expect(rows.find((r) => r.key === OVERFLOW_KEY)?.requests).toBe(5);
  });
});

describe('DurationWindow', () => {
  it('resume la ventana y se reinicia', () => {
    const w = new DurationWindow();
    for (let i = 1; i <= 20; i += 1) w.add(i * 10, 200);
    w.add(5, 503);
    w.add(null, 429);
    expect(w.drain()).toEqual({ requests: 22, errors: 1, throttled: 1, p95Ms: 190 });
    expect(w.drain()).toEqual({ requests: 0, errors: 0, throttled: 0, p95Ms: 0 });
  });
});

describe('hostCpuPercent', () => {
  it('calcula el uso con la diferencia de tiempos', () => {
    const prev = [{ times: { user: 100, sys: 0, idle: 900 } }];
    const next = [{ times: { user: 150, sys: 50, idle: 1000 } }];
    expect(hostCpuPercent(prev, next)).toBe(50);
    expect(hostCpuPercent(prev, prev)).toBe(0);
  });
});
