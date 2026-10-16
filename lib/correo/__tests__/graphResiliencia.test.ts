import { describe, expect, it } from 'vitest';
import { conReintentos, esperaReintento, LimitadorConcurrencia, leerRetryAfter, POLITICA_GRAPH, type PoliticaReintento } from '../graphResiliencia';

const resp = (status: number, retryAfter?: string) => new Response(status === 204 ? null : '{}', { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} });

/** Secuencia de respuestas y registro de esperas (sin dormir de verdad). */
function secuencia(...estados: Array<number | [number, string]>) {
  let i = 0;
  const esperas: number[] = [];
  const intentar = async () => {
    const e = estados[Math.min(i++, estados.length - 1)];
    return Array.isArray(e) ? resp(e[0], e[1]) : resp(e);
  };
  return { intentar, esperas, dormir: async (ms: number) => void esperas.push(ms), intentos: () => i };
}

describe('Correo · reintentos ante el throttling de Graph', () => {
  it('Retry-After en segundos o fecha HTTP', () => {
    expect(leerRetryAfter('2')).toBe(2000);
    expect(leerRetryAfter('0')).toBe(0);
    expect(leerRetryAfter(null)).toBeNull();
    expect(leerRetryAfter('')).toBeNull();
    expect(leerRetryAfter('basura')).toBeNull();
    const ahora = Date.parse('2026-10-16T16:13:00Z');
    expect(leerRetryAfter('Fri, 16 Oct 2026 16:13:05 GMT', ahora)).toBe(5000);
  });

  it('respeta Retry-After con un jitter pequeño (0–250 ms)', () => {
    expect(esperaReintento(0, 2000, POLITICA_GRAPH, () => 0)).toBe(2000);
    expect(esperaReintento(0, 2000, POLITICA_GRAPH, () => 0.999)).toBe(2250);
  });

  it('sin Retry-After: retroceso exponencial con jitter entre la mitad y el total, con tope', () => {
    const p: PoliticaReintento = { reintentos: 3, baseMs: 500, maxEsperaMs: 3000, presupuestoMs: 60_000 };
    expect(esperaReintento(0, null, p, () => 0)).toBe(250);
    expect(esperaReintento(0, null, p, () => 1)).toBe(500);
    expect(esperaReintento(1, null, p, () => 1)).toBe(1000);
    expect(esperaReintento(2, null, p, () => 0)).toBe(1000);
    expect(esperaReintento(10, null, p, () => 1)).toBe(3000);
    for (let k = 0; k < 50; k++) {
      const v = esperaReintento(2, null, p);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(2000);
    }
  });

  it('429 → 200: reintenta y devuelve la respuesta buena', async () => {
    const s = secuencia([429, '2'], 200);
    const r = await conReintentos(s.intentar, { dormir: s.dormir, azar: () => 0 });
    expect(r.status).toBe(200);
    expect(s.intentos()).toBe(2);
    expect(s.esperas).toEqual([2000]);
  });

  it('hasta 3 reintentos: después devuelve el último 429', async () => {
    const s = secuencia(429);
    const r = await conReintentos(s.intentar, { dormir: s.dormir, azar: () => 0 });
    expect(r.status).toBe(429);
    expect(s.intentos()).toBe(4);
    expect(s.esperas).toEqual([250, 500, 1000]);
  });

  it('503 solo se reintenta si la operación es idempotente (un envío nunca se duplica)', async () => {
    const a = secuencia(503, 200);
    expect((await conReintentos(a.intentar, { dormir: a.dormir, idempotente: true })).status).toBe(200);
    const b = secuencia(503, 200);
    expect((await conReintentos(b.intentar, { dormir: b.dormir, idempotente: false })).status).toBe(503);
    expect(b.intentos()).toBe(1);
  });

  it('no reintenta otros errores ni éxitos', async () => {
    for (const st of [200, 204, 400, 401, 403, 404, 500]) {
      const s = secuencia(st, 200);
      expect((await conReintentos(s.intentar, { dormir: s.dormir, idempotente: true })).status).toBe(st);
      expect(s.intentos()).toBe(1);
    }
  });

  it('si Graph pide esperar más que el tope, o se agota el presupuesto, no se queda colgado', async () => {
    const a = secuencia([429, '120'], 200);
    expect((await conReintentos(a.intentar, { dormir: a.dormir })).status).toBe(429);
    expect(a.esperas).toEqual([]);
    const b = secuencia([429, '8'], [429, '8'], [429, '8'], 200);
    const r = await conReintentos(b.intentar, { dormir: b.dormir, azar: () => 0, politica: { ...POLITICA_GRAPH, presupuestoMs: 17_000 } });
    expect(r.status).toBe(429);
    expect(b.esperas).toEqual([8000, 8000]);
  });

  it('avisa cada reintento (para el registro del servidor)', async () => {
    const s = secuencia([429, '1'], 200);
    const avisos: unknown[] = [];
    await conReintentos(s.intentar, { dormir: s.dormir, azar: () => 0, alReintentar: (i) => avisos.push(i) });
    expect(avisos).toEqual([{ intento: 1, status: 429, esperaMs: 1000 }]);
  });
});

describe('Correo · límite de concurrencia por buzón', () => {
  const diferido = () => {
    let resolver!: () => void;
    const p = new Promise<void>((r) => (resolver = r));
    return { p, resolver };
  };

  it('máximo 3 a la vez por buzón; el resto espera en orden de llegada', async () => {
    const lim = new LimitadorConcurrencia(3);
    let activas = 0;
    let pico = 0;
    const orden: number[] = [];
    const tareas = Array.from({ length: 8 }, (_, i) =>
      lim.correr('ana@gss.com', async () => {
        activas++;
        pico = Math.max(pico, activas);
        orden.push(i);
        await new Promise((r) => setTimeout(r, 5));
        activas--;
        return i;
      })
    );
    expect(lim.enCurso('ana@gss.com')).toBe(3);
    expect(lim.enEspera('ana@gss.com')).toBe(5);
    expect(await Promise.all(tareas)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(pico).toBe(3);
    expect(orden).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(lim.enCurso('ana@gss.com')).toBe(0);
    expect(lim.enEspera('ana@gss.com')).toBe(0);
  });

  it('cada buzón tiene su propio cupo', async () => {
    const lim = new LimitadorConcurrencia(3);
    const d = diferido();
    const a = Array.from({ length: 3 }, () => lim.correr('a@x.com', () => d.p));
    let corrioB = false;
    const b = lim.correr('b@x.com', async () => {
      corrioB = true;
    });
    await b;
    expect(corrioB).toBe(true);
    expect(lim.enCurso('a@x.com')).toBe(3);
    d.resolver();
    await Promise.all(a);
  });

  it('una tarea que falla libera su cupo', async () => {
    const lim = new LimitadorConcurrencia(1);
    await expect(lim.correr('a@x.com', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await lim.correr('a@x.com', async () => 'ok')).toBe('ok');
    expect(lim.enCurso('a@x.com')).toBe(0);
  });
});
