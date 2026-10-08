import { describe, expect, it } from 'vitest';
import {
  MAX_SUBAGENTES,
  METRICAS_RANCIAS_MS,
  colorContexto,
  metricasRancias,
  normalizeMetricsPayload,
  totalEntrada,
} from '../agent-metrics';

/** Forma exacta que arma buildMetricsPayload() en el mod synerlink-metrics (hooks/core.js). */
const delMod = {
  idConversation: 46,
  sessionId: '3433f201-aaaa-bbbb-cccc-1234567890ab',
  model: 'claude-opus-5',
  state: 'tool',
  tool: { name: 'Bash', label: 'Ejecutando comando' },
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  turn: { input: 12, output: 900, cacheRead: 80_000, cacheCreation: 3_000 },
  session: { input: 300, output: 25_000, cacheRead: 2_500_000, cacheCreation: 90_000 },
  subagentTokens: { input: 10, output: 20, cacheRead: 0, cacheCreation: 0 },
  costUsd: 1.23456,
  subagents: [{ id: 'a1', type: 'general-purpose', description: 'Revisar logs', status: 'running' }],
  at: '2026-10-06T21:00:00.000Z',
};

describe('normalizeMetricsPayload', () => {
  it('acepta el payload del mod tal cual', () => {
    const r = normalizeMetricsPayload(delMod);
    if ('error' in r) throw new Error(r.error);
    expect(r.idConversation).toBe(46);
    expect(r.metrics.model).toBe('claude-opus-5');
    expect(r.metrics.state).toBe('tool');
    expect(r.metrics.toolLabel).toBe('Ejecutando comando');
    expect(r.metrics.context).toEqual({ tokens: 84_000, window: 200_000, percent: 42 });
    expect(r.metrics.turn.cacheRead).toBe(80_000);
    expect(r.metrics.session.output).toBe(25_000);
    expect(r.metrics.subagentTokens).toEqual({ input: 10, output: 20 });
    expect(r.metrics.costUsd).toBe(1.2346);
    expect(r.metrics.subagents).toHaveLength(1);
    expect(r.metrics.subagentCount).toBe(1);
    expect(r.metrics.reportedAt).toBe('2026-10-06T21:00:00.000Z');
  });

  it('exige la conversación', () => {
    expect(normalizeMetricsPayload({ ...delMod, idConversation: undefined })).toHaveProperty('error');
    expect(normalizeMetricsPayload({ ...delMod, idConversation: -3 })).toHaveProperty('error');
    expect(normalizeMetricsPayload({ ...delMod, idConversation: 'abc' })).toHaveProperty('error');
  });

  it('calcula el % si tras /compact llegan tokens sin porcentaje', () => {
    const r = normalizeMetricsPayload({ ...delMod, context: { tokens: 50_000, window: 200_000 } });
    if ('error' in r) throw new Error(r.error);
    expect(r.metrics.context.percent).toBe(25);
  });

  it('deja el contexto en null cuando no hay medida (recién /clear)', () => {
    const r = normalizeMetricsPayload({ ...delMod, context: { window: 200_000 } });
    if ('error' in r) throw new Error(r.error);
    expect(r.metrics.context).toEqual({ tokens: null, window: 200_000, percent: null });
  });

  it('no se deja meter basura: negativos, textos y porcentajes fuera de rango', () => {
    const r = normalizeMetricsPayload({
      idConversation: 7,
      state: 'hackeando',
      context: { tokens: -5, window: 'x', percent: 250 },
      turn: { input: -1, output: 'mucho' },
      costUsd: -2,
      subagents: 'no es lista',
      at: 'ayer',
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.metrics.state).toBeNull();
    expect(r.metrics.context.tokens).toBeNull();
    expect(r.metrics.context.percent).toBe(100);
    expect(r.metrics.turn).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    expect(r.metrics.costUsd).toBeNull();
    expect(r.metrics.subagents).toEqual([]);
    expect(r.metrics.reportedAt).toBeNull();
  });

  it('corta la lista de sub-agentes pero conserva el conteo real', () => {
    const muchos = Array.from({ length: MAX_SUBAGENTES + 7 }, (_, i) => ({ id: `s${i}`, description: 'x'.repeat(500) }));
    const r = normalizeMetricsPayload({ ...delMod, subagents: muchos });
    if ('error' in r) throw new Error(r.error);
    expect(r.metrics.subagents).toHaveLength(MAX_SUBAGENTES);
    expect(r.metrics.subagentCount).toBe(MAX_SUBAGENTES + 7);
    expect(r.metrics.subagents[0].description).toHaveLength(200);
  });
});

describe('colorContexto', () => {
  it('verde por debajo de 60, ámbar de 60 a 85, rojo por encima de 85', () => {
    expect(colorContexto(0)).toBe('green');
    expect(colorContexto(59.9)).toBe('green');
    expect(colorContexto(60)).toBe('yellow');
    expect(colorContexto(85)).toBe('yellow');
    expect(colorContexto(85.01)).toBe('red');
    expect(colorContexto(null)).toBe('gray');
  });
});

describe('metricasRancias', () => {
  const ahora = Date.parse('2026-10-06T21:10:00.000Z');
  it('a los 5 minutos sin reporte pasa a "sin datos"', () => {
    expect(metricasRancias({ updatedAt: new Date(ahora - 60_000).toISOString() }, ahora)).toBe(false);
    expect(metricasRancias({ updatedAt: new Date(ahora - METRICAS_RANCIAS_MS - 1).toISOString() }, ahora)).toBe(true);
    expect(metricasRancias(null, ahora)).toBe(true);
  });
});

describe('totalEntrada', () => {
  it('suma lo nuevo y la caché, no la salida', () => {
    expect(totalEntrada({ input: 1, output: 100, cacheRead: 10, cacheCreation: 5 })).toBe(16);
  });
});
