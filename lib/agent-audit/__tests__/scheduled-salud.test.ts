import { describe, expect, it } from 'vitest';
import {
  evaluarSalud,
  fallasSeguidas,
  intervaloMinutos,
  parseHorario,
  pareceCorriendo,
  ultimaEsperada,
  umbralFallas,
  type EntradaSalud,
} from '../scheduled-salud';

/** Hora de Colombia → Date (UTC−5 fija). */
const cot = (s: string) => new Date(`${s}:00-05:00`);

const diaria16 = { cal: [{ h: 16, m: 0 }] };
const laborables8 = { cal: [1, 2, 3, 4, 5].map((wd) => ({ wd, h: 8, m: 0 })) };

const base = (x: Partial<EntradaSalud> = {}): EntradaSalud => ({
  cargada: true,
  habilitada: true,
  estado: 'activa',
  estadoDetalle: null,
  ultimaCorrida: null,
  ultimaOk: true,
  horario: diaria16,
  ultimas: [],
  vistoAt: null,
  ...x,
});

describe('parseHorario', () => {
  it('acepta intervalo y calendario, normaliza domingo 7 → 0 y minuto por defecto', () => {
    expect(parseHorario({ cada: 15 })).toEqual({ cada: 15 });
    expect(parseHorario({ cal: [{ wd: 7, h: 3 }] })).toEqual({ cal: [{ wd: 0, h: 3, m: 0 }] });
  });
  it('descarta lo inválido', () => {
    expect(parseHorario(null)).toBeNull();
    expect(parseHorario({ cada: 0 })).toBeNull();
    expect(parseHorario({ cal: [{ h: 25 }] })).toBeNull();
    expect(parseHorario({ cal: [] })).toBeNull();
    expect(parseHorario('cada 5')).toBeNull();
  });
});

describe('ultimaEsperada', () => {
  it('diaria: si aún no llega la hora de hoy, es la de ayer', () => {
    expect(ultimaEsperada(diaria16, cot('2026-11-04T15:00'))?.toISOString()).toBe(cot('2026-11-03T16:00').toISOString());
    expect(ultimaEsperada(diaria16, cot('2026-11-04T16:30'))?.toISOString()).toBe(cot('2026-11-04T16:00').toISOString());
  });
  it('de lunes a viernes: el domingo la última esperada es el viernes', () => {
    // 2026-11-08 es domingo.
    expect(ultimaEsperada(laborables8, cot('2026-11-08T12:00'))?.toISOString()).toBe(cot('2026-11-06T08:00').toISOString());
  });
  it('cada hora (sin h) y mensual', () => {
    expect(ultimaEsperada({ cal: [{ m: 5 }] }, cot('2026-11-04T10:30'))?.toISOString()).toBe(cot('2026-11-04T10:05').toISOString());
    expect(ultimaEsperada({ cal: [{ d: 1, h: 6, m: 0 }] }, cot('2026-11-04T10:30'))?.toISOString()).toBe(cot('2026-11-01T06:00').toISOString());
  });
  it('con intervalo no aplica', () => {
    expect(ultimaEsperada({ cada: 10 }, new Date())).toBeNull();
  });
});

describe('intervalo y umbral de fallas', () => {
  it('diaria = 1 falla basta; cada 15 min = 2 seguidas', () => {
    expect(intervaloMinutos(diaria16)).toBe(1440);
    expect(umbralFallas(diaria16)).toBe(1);
    expect(umbralFallas({ cada: 15 })).toBe(2);
    expect(umbralFallas(null)).toBe(1);
  });
  it('fallas seguidas al final, ignorando la que sigue en curso', () => {
    const u = (ts: string, ok: boolean | null) => ({ ts, ok, produccion: null, nota: null });
    expect(fallasSeguidas([u('2026-11-01T00:00:00Z', true), u('2026-11-02T00:00:00Z', false), u('2026-11-03T00:00:00Z', false), u('2026-11-04T00:00:00Z', null)])).toBe(2);
    expect(fallasSeguidas([u('2026-11-03T00:00:00Z', false), u('2026-11-04T00:00:00Z', true)])).toBe(0);
  });
});

describe('evaluarSalud', () => {
  const ahora = cot('2026-11-04T18:00');

  it('diaria que corrió hoy: activa', () => {
    const s = evaluarSalud(base({ ultimaCorrida: cot('2026-11-04T16:00').toISOString() }), ahora);
    expect(s.salud).toBe('ok');
  });

  it('diaria que no corrió hoy (pasó la hora + 1 h): muerta, con la hora esperada', () => {
    const s = evaluarSalud(base({ ultimaCorrida: cot('2026-11-03T16:01').toISOString() }), ahora);
    expect(s.salud).toBe('muerta');
    expect(s.esperada).toBe(cot('2026-11-04T16:00').toISOString());
    expect(s.detalle).toContain('2026-11-04 16:00');
  });

  it('dentro del margen de 1 h todavía no es muerta', () => {
    const s = evaluarSalud(base({ ultimaCorrida: cot('2026-11-03T16:00').toISOString() }), cot('2026-11-04T16:45'));
    expect(s.salud).toBe('ok');
  });

  it('se evalúa a la hora en que el recolector la vio, no a la de la consulta', () => {
    const s = evaluarSalud(
      base({ ultimaCorrida: cot('2026-11-03T16:00').toISOString(), vistoAt: cot('2026-11-04T10:00').toISOString() }),
      cot('2026-11-05T09:00'),
    );
    expect(s.salud).toBe('ok');
  });

  it('de lunes a viernes: el fin de semana no se muere', () => {
    const s = evaluarSalud(
      base({ horario: laborables8, ultimaCorrida: cot('2026-11-06T08:00').toISOString() }),
      cot('2026-11-08T20:00'),
    );
    expect(s.salud).toBe('ok');
  });

  it('cada 15 min: muerta si pasan más de 2 intervalos', () => {
    expect(evaluarSalud(base({ horario: { cada: 15 }, ultimaCorrida: cot('2026-11-04T17:40').toISOString() }), ahora).salud).toBe('ok');
    expect(evaluarSalud(base({ horario: { cada: 15 }, ultimaCorrida: cot('2026-11-04T17:20').toISOString() }), ahora).salud).toBe('muerta');
  });

  it('fallando: últimas N corridas fallaron', () => {
    const u = (h: string, ok: boolean) => ({ ts: cot(h).toISOString(), ok, produccion: null, nota: null });
    const frecuente = base({
      horario: { cada: 15 },
      ultimaCorrida: cot('2026-11-04T17:55').toISOString(),
      ultimas: [u('2026-11-04T17:25', true), u('2026-11-04T17:40', false), u('2026-11-04T17:55', false)],
    });
    expect(evaluarSalud(frecuente, ahora)).toMatchObject({ salud: 'fallando', detalle: 'Fallaron las últimas 2 corridas.' });
    const unaSola = { ...frecuente, ultimas: [u('2026-11-04T17:40', true), u('2026-11-04T17:55', false)] };
    expect(evaluarSalud(unaSola, ahora).salud).toBe('ok');
    const diaria = base({ ultimaCorrida: cot('2026-11-04T16:00').toISOString(), ultimas: [u('2026-11-04T16:00', false)] });
    expect(evaluarSalud(diaria, ahora).salud).toBe('fallando');
  });

  it('muerta manda sobre fallando', () => {
    const s = evaluarSalud(
      base({ ultimaCorrida: cot('2026-11-02T16:00').toISOString(), ultimas: [{ ts: cot('2026-11-02T16:00').toISOString(), ok: false, produccion: null, nota: null }] }),
      ahora,
    );
    expect(s.salud).toBe('muerta');
  });

  it('pausada nunca es muerta', () => {
    expect(evaluarSalud(base({ cargada: false, ultimaCorrida: cot('2026-10-01T16:00').toISOString() }), ahora).salud).toBe('pausada');
    expect(evaluarSalud(base({ habilitada: false }), ahora).salud).toBe('pausada');
  });

  it('sin corridas conocidas: sin datos (no se acusa de muerta)', () => {
    expect(evaluarSalud(base({ ultimaCorrida: null, ultimaOk: null }), ahora).salud).toBe('sin_datos');
  });

  it('sin programación estructurada: respeta lo que dijo el recolector', () => {
    expect(evaluarSalud(base({ horario: null, estado: 'fallando', estadoDetalle: 'x', ultimaOk: null, ultimaCorrida: cot('2026-11-04T10:00').toISOString() }), ahora)).toMatchObject({ salud: 'fallando', detalle: 'x' });
  });
});

describe('pareceCorriendo', () => {
  it('última corrida reciente sin resultado', () => {
    const ahora = new Date('2026-11-04T20:00:00Z');
    expect(pareceCorriendo({ ultimaCorrida: '2026-11-04T19:30:00Z', ultimaOk: null }, ahora)).toBe(true);
    expect(pareceCorriendo({ ultimaCorrida: '2026-11-04T12:00:00Z', ultimaOk: null }, ahora)).toBe(false);
    expect(pareceCorriendo({ ultimaCorrida: '2026-11-04T19:30:00Z', ultimaOk: true }, ahora)).toBe(false);
  });
});
