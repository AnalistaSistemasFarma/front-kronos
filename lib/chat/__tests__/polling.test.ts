import { describe, expect, it } from 'vitest';
import { POLL_MS, computeNextPollMs } from '../polling';

describe('computeNextPollMs', () => {
  const base = { hasNewMessages: false, agentState: null, msSinceLastActivity: 0 };

  it('va rápido cuando acaba de llegar algo', () => {
    expect(computeNextPollMs({ ...base, hasNewMessages: true })).toBe(POLL_MS.live);
  });

  it('va rápido mientras el agente está trabajando', () => {
    expect(computeNextPollMs({ ...base, agentState: 'thinking', msSinceLastActivity: 10 * 60_000 })).toBe(
      POLL_MS.live
    );
    expect(computeNextPollMs({ ...base, agentState: 'tool', msSinceLastActivity: 10 * 60_000 })).toBe(
      POLL_MS.live
    );
  });

  it('se va frenando a medida que la conversación se enfría', () => {
    expect(computeNextPollMs({ ...base, msSinceLastActivity: 5_000 })).toBe(POLL_MS.active);
    expect(computeNextPollMs({ ...base, msSinceLastActivity: 2 * 60_000 })).toBe(POLL_MS.warm);
    expect(computeNextPollMs({ ...base, msSinceLastActivity: 10 * 60_000 })).toBe(POLL_MS.idle);
    expect(computeNextPollMs({ ...base, msSinceLastActivity: 2 * 60 * 60_000 })).toBe(POLL_MS.dormant);
  });

  it('trata un hilo sin actividad conocida como dormido', () => {
    expect(computeNextPollMs({ ...base, msSinceLastActivity: Number.POSITIVE_INFINITY })).toBe(
      POLL_MS.dormant
    );
  });

  it('sondea en vivo mientras se espera la respuesta del agente', () => {
    // El usuario acaba de escribir: el estado sigue en 'idle' y la actividad es
    // reciente, así que sin `awaitingAgent` esto caería en `active` (2 s).
    expect(computeNextPollMs({ ...base, msSinceLastActivity: 1_500 })).toBe(POLL_MS.active);
    expect(
      computeNextPollMs({ ...base, msSinceLastActivity: 1_500, awaitingAgent: true })
    ).toBe(POLL_MS.live);
  });

  it('esperar al agente también acelera un hilo que ya se había enfriado', () => {
    expect(
      computeNextPollMs({ ...base, msSinceLastActivity: 10 * 60_000, awaitingAgent: true })
    ).toBe(POLL_MS.live);
  });

  it('con `awaitingAgent` en false la cadencia no cambia', () => {
    expect(
      computeNextPollMs({ ...base, msSinceLastActivity: 2 * 60_000, awaitingAgent: false })
    ).toBe(POLL_MS.warm);
  });

  it('con la pestaña oculta aplica el tope superior, pase lo que pase', () => {
    expect(
      computeNextPollMs({ ...base, hasNewMessages: true, agentState: 'thinking', hidden: true })
    ).toBe(POLL_MS.dormant);
  });

  it('la pestaña oculta gana también sobre `awaitingAgent`', () => {
    expect(
      computeNextPollMs({ ...base, awaitingAgent: true, hidden: true, msSinceLastActivity: 100 })
    ).toBe(POLL_MS.dormant);
  });

  it('nunca sondea más rápido de 1 s ni más lento de 30 s', () => {
    const casos = [0, 1, 59_000, 60_001, 299_999, 1_800_001, Number.POSITIVE_INFINITY];
    for (const ms of casos) {
      const v = computeNextPollMs({ ...base, msSinceLastActivity: ms });
      expect(v).toBeGreaterThanOrEqual(POLL_MS.live);
      expect(v).toBeLessThanOrEqual(POLL_MS.dormant);
    }
  });
});
