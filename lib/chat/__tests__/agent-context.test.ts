import { describe, expect, it } from 'vitest';
import {
  SESION_PRINCIPAL,
  colorDeContexto,
  contextoRancio,
  estaTrabajando,
  normalizarReporteContexto,
  normalizarSesion,
  tokensCortos,
  transicionValida,
} from '../agent-context';

const ahora = new Date('2026-10-29T15:00:00Z');

describe('normalizarSesion', () => {
  it('sesión principal de un bot de Claude Code: calcula el % si no viene', () => {
    const s = normalizarSesion({ sessionKey: 'principal', runtime: 'claude-code', tokens: 412000, window: 1000000, model: 'claude-opus-5-5' }, ahora);
    expect(s).toMatchObject({ sessionKey: SESION_PRINCIPAL, idConversation: null, tokens: 412000, window: 1000000, percent: 41.2 });
  });

  it('openclaw: exige la conversación', () => {
    expect(normalizarSesion({ sessionKey: 'agent:duo:synerlink-108', runtime: 'openclaw', tokens: 1 }, ahora)).toBeNull();
    expect(
      normalizarSesion({ sessionKey: 'agent:duo:synerlink-108', runtime: 'openclaw', idConversation: 108, tokens: 586408, window: 1000000 }, ahora)
    ).toMatchObject({ idConversation: 108, percent: 58.64 });
  });

  it('la principal no puede traer conversación', () => {
    expect(normalizarSesion({ sessionKey: 'principal', runtime: 'claude-code', idConversation: 5 }, ahora)).toBeNull();
  });

  it('rechaza claves raras y runtimes desconocidos', () => {
    expect(normalizarSesion({ sessionKey: '../etc', runtime: 'claude-code' }, ahora)).toBeNull();
    expect(normalizarSesion({ sessionKey: 'principal', runtime: 'gpt' }, ahora)).toBeNull();
  });

  it('acota el porcentaje y recorta una marca del futuro', () => {
    const s = normalizarSesion({ sessionKey: 'principal', runtime: 'claude-code', percent: 140, measuredAt: '2027-01-01T00:00:00Z' }, ahora);
    expect(s?.percent).toBe(100);
    expect(s?.measuredAt.toISOString()).toBe(ahora.toISOString());
  });

  it('sesión nueva sin turnos: tokens y % nulos', () => {
    expect(normalizarSesion({ sessionKey: 'principal', runtime: 'claude-code', tokens: null, window: 1000000 }, ahora)).toMatchObject({
      tokens: null,
      percent: null,
    });
  });
});

describe('normalizarReporteContexto', () => {
  it('descarta las inválidas y deduplica por clave', () => {
    const r = normalizarReporteContexto(
      {
        sesiones: [
          { sessionKey: 'principal', runtime: 'claude-code', tokens: 1, window: 10 },
          { sessionKey: 'principal', runtime: 'claude-code', tokens: 5, window: 10 },
          { sessionKey: 'x', runtime: 'nada' },
        ],
      },
      ahora
    );
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.sesiones).toHaveLength(1);
    expect(r.sesiones[0].percent).toBe(50);
    expect(r.descartadas).toBe(1);
  });

  it('error si nada sirve o no es objeto', () => {
    expect(normalizarReporteContexto(null)).toHaveProperty('error');
    expect(normalizarReporteContexto({ sesiones: [] })).toHaveProperty('error');
    expect(normalizarReporteContexto({ sesiones: [{ sessionKey: 'principal' }] })).toHaveProperty('error');
  });
});

describe('colorDeContexto', () => {
  it('verde < 60, ámbar 60–85, rojo ≥ 85', () => {
    expect(colorDeContexto(59.99)).toBe('green');
    expect(colorDeContexto(60)).toBe('yellow');
    expect(colorDeContexto(84.9)).toBe('yellow');
    expect(colorDeContexto(85)).toBe('red');
    expect(colorDeContexto(null)).toBe('gray');
  });
});

describe('transiciones de la orden', () => {
  it('pendiente → en_curso → final; nada después del final', () => {
    expect(transicionValida('pendiente', 'en_curso')).toBe(true);
    expect(transicionValida('pendiente', 'ocupado')).toBe(true);
    expect(transicionValida('en_curso', 'ok')).toBe(true);
    expect(transicionValida('en_curso', 'en_curso')).toBe(false);
    expect(transicionValida('ok', 'error')).toBe(false);
    expect(transicionValida('vencida', 'ok')).toBe(false);
  });
});

describe('estaTrabajando', () => {
  const t = ahora.getTime();
  it('cuenta solo estados no idle y recientes', () => {
    expect(estaTrabajando([{ state: 'idle', updatedAt: ahora }], t)).toBe(false);
    expect(estaTrabajando([{ state: 'tool', updatedAt: ahora }], t)).toBe(true);
    expect(estaTrabajando([{ state: 'thinking', updatedAt: new Date(t - 11 * 60_000) }], t)).toBe(false);
  });
});

describe('presentación', () => {
  it('tokens en corto', () => {
    expect(tokensCortos(412000)).toBe('412 mil');
    expect(tokensCortos(1_000_000)).toBe('1 M');
    expect(tokensCortos(null)).toBe('—');
  });
  it('rancio pasados 10 min', () => {
    expect(contextoRancio({ measuredAt: new Date(ahora.getTime() - 9 * 60_000).toISOString() }, ahora.getTime())).toBe(false);
    expect(contextoRancio({ measuredAt: new Date(ahora.getTime() - 11 * 60_000).toISOString() }, ahora.getTime())).toBe(true);
  });
});
