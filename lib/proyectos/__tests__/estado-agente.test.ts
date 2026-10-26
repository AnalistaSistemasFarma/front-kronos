import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EVENTO_ESTADO_PROYECTOS,
  avisarEstadoProyectos,
  cursorDeEstado,
  estadosDelEvento,
  mapaDeEstados,
  mezclarEstados,
  resumenTrabajando,
  textoSubagentes,
  vistaEstadoAgente,
  type EstadoAgenteProyectoDto,
} from '../estado-agente';

/*
 * Estado en vivo del agente en Proyectos (2026-10-20, Nicolás Rivera: «cuando un
 * agente está trabajando no hay ningún estado por fuera que diga que está
 * trabajando»). Lógica pura: qué se pinta, cómo se mezclan los cambios del pulso
 * y que un estado viejo no pise uno nuevo.
 */

const AHORA = new Date('2026-10-20T16:00:00.000Z').getTime();
const hace = (s: number) => new Date(AHORA - s * 1000).toISOString();

function estado(p: Partial<EstadoAgenteProyectoDto> = {}): EstadoAgenteProyectoDto {
  return {
    idConversation: 28,
    idProject: 4,
    projectName: 'Farmalógica — Orus (piloto)',
    conversationTitle: 'Conversación inicial',
    agent: { idAgent: 7, code: 'horus', displayName: 'Orus', avatarUrl: null, avatarVersion: null },
    state: 'tool',
    label: 'Consultando SAP…',
    tasks: [],
    updatedAt: hace(5),
    ...p,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('vistaEstadoAgente', () => {
  it('trabajando con herramienta: «Orus está trabajando…», la actividad y el logo rápido', () => {
    vi.useFakeTimers({ now: AHORA });
    const v = vistaEstadoAgente(estado(), 'Orus');
    expect(v).toEqual({ trabajando: true, texto: 'Orus está trabajando…', actividad: 'Consultando SAP…', subagentes: [], variante: 'tool' });
  });

  it('pensando sin etiqueta: trabaja, sin actividad inventada', () => {
    vi.useFakeTimers({ now: AHORA });
    const v = vistaEstadoAgente(estado({ state: 'thinking', label: null }), 'Orus');
    expect(v.trabajando).toBe(true);
    expect(v.actividad).toBeNull();
    expect(v.variante).toBe('thinking');
  });

  it('en reposo o sin estado: vuelve a lo normal', () => {
    vi.useFakeTimers({ now: AHORA });
    expect(vistaEstadoAgente(estado({ state: 'idle', label: null }), 'Orus').trabajando).toBe(false);
    expect(vistaEstadoAgente(null, 'Orus')).toMatchObject({ trabajando: false, texto: '', actividad: null });
  });

  it('un «trabajando» rancio (más de 10 min sin refrescar) NO se pinta: misma regla del chat', () => {
    vi.useFakeTimers({ now: AHORA });
    expect(vistaEstadoAgente(estado({ updatedAt: hace(11 * 60) }), 'Orus').trabajando).toBe(false);
  });

  it('subagentes en curso: se muestran, aunque el principal ya esté en reposo', () => {
    vi.useFakeTimers({ now: AHORA });
    const tasks = [
      { desc: 'Analista de cartera: revisa vencidos', startedAt: hace(40) },
      { desc: 'Analista de inventario: cruza bodega 01', startedAt: hace(20) },
    ];
    const v = vistaEstadoAgente(estado({ tasks }), 'Orus');
    expect(v.subagentes).toHaveLength(2);
    const enReposo = vistaEstadoAgente(estado({ state: 'idle', label: null, tasks }), 'Orus');
    expect(enReposo.trabajando).toBe(true);
    expect(enReposo.actividad).toBeNull();
  });

  it('nombre vacío: «El asistente está trabajando…»', () => {
    vi.useFakeTimers({ now: AHORA });
    expect(vistaEstadoAgente(estado(), '  ').texto).toBe('El asistente está trabajando…');
  });
});

describe('textos', () => {
  it('subagentes en singular y plural', () => {
    expect(textoSubagentes(0)).toBe('');
    expect(textoSubagentes(1)).toBe('1 subagente en curso');
    expect(textoSubagentes(3)).toBe('3 subagentes en curso');
  });

  it('resumen de un proyecto: uno, el mismo en varias conversaciones, o varios asistentes', () => {
    vi.useFakeTimers({ now: AHORA });
    expect(resumenTrabajando([]).n).toBe(0);
    expect(resumenTrabajando([estado(), estado({ idConversation: 29, state: 'idle', label: null })]).texto).toBe('Orus está trabajando…');
    expect(resumenTrabajando([estado(), estado({ idConversation: 29 })]).texto).toBe('Orus está trabajando en 2 conversaciones…');
    const play = estado({ idConversation: 31, agent: { idAgent: 9, code: 'silvia', displayName: 'Play', avatarUrl: null, avatarVersion: null } });
    expect(resumenTrabajando([estado(), play]).texto).toBe('2 asistentes trabajando…');
  });
});

describe('mezclarEstados', () => {
  it('gana el más reciente: un evento viejo que llega tarde no pisa el nuevo', () => {
    const nuevo = estado({ state: 'idle', label: null, updatedAt: hace(1) });
    const viejo = estado({ state: 'tool', updatedAt: hace(30) });
    const m = mezclarEstados(mapaDeEstados([nuevo]), [viejo]);
    expect(m.get(28)?.state).toBe('idle');
  });

  it('al terminar (reposo) reemplaza el «trabajando»', () => {
    const m = mezclarEstados(mapaDeEstados([estado({ updatedAt: hace(30) })]), [estado({ state: 'idle', label: null, updatedAt: hace(1) })]);
    expect(m.get(28)?.state).toBe('idle');
  });

  it('sin cambios devuelve el MISMO mapa (React no vuelve a pintar)', () => {
    const base = mapaDeEstados([estado()]);
    expect(mezclarEstados(base, [estado()])).toBe(base);
    expect(mezclarEstados(base, [])).toBe(base);
  });

  it('agrega conversaciones nuevas sin tocar las demás', () => {
    const base = mapaDeEstados([estado()]);
    const m = mezclarEstados(base, [estado({ idConversation: 40 })]);
    expect([...m.keys()].sort()).toEqual([28, 40]);
    expect(base.size).toBe(1);
  });
});

describe('evento del navegador', () => {
  it('estadosDelEvento descarta lo que no tiene forma de estado', () => {
    expect(estadosDelEvento(null)).toEqual([]);
    expect(estadosDelEvento({ estados: 'x' })).toEqual([]);
    expect(estadosDelEvento({ estados: [estado(), { idConversation: 'x' }, null, { ...estado(), agent: null }] })).toHaveLength(1);
  });

  it('avisarEstadoProyectos emite EVENTO_ESTADO_PROYECTOS con los estados', () => {
    const dispatchEvent = vi.fn();
    class FakeCustomEvent {
      constructor(public type: string, public init: { detail: unknown }) {}
    }
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', FakeCustomEvent);
    avisarEstadoProyectos([]);
    expect(dispatchEvent).not.toHaveBeenCalled();
    avisarEstadoProyectos([estado()]);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const ev = dispatchEvent.mock.calls[0][0] as FakeCustomEvent;
    expect(ev.type).toBe(EVENTO_ESTADO_PROYECTOS);
    expect(estadosDelEvento(ev.init.detail)).toHaveLength(1);
  });
});

describe('cursorDeEstado', () => {
  it('acepta ISO; «0», vacío o basura = sin cursor', () => {
    expect(cursorDeEstado('2026-10-20T16:00:00.000Z')?.toISOString()).toBe('2026-10-20T16:00:00.000Z');
    expect(cursorDeEstado('0')).toBeNull();
    expect(cursorDeEstado('')).toBeNull();
    expect(cursorDeEstado(null)).toBeNull();
    expect(cursorDeEstado('mañana')).toBeNull();
  });
});
