import { describe, expect, it } from 'vitest';
import { runAfterSettled } from './afterDecision';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Tareas SAP después de la decisión del autorizador', () => {
  it('el motor arranca solo cuando terminaron las escrituras de la decisión', async () => {
    const log: string[] = [];
    const decision = sleep(30).then(() => log.push('decision'));
    const compras = sleep(5).then(() => log.push('compras'));
    await runAfterSettled([compras, decision], async () => {
      log.push('motor');
    });
    expect(log).toEqual(['compras', 'decision', 'motor']);
  });

  it('una decisión que falla no impide que corra el motor', async () => {
    const r = await runAfterSettled([Promise.reject(new Error('SAP caído'))], () => 'corrió');
    expect(r).toBe('corrió');
  });

  it('sin decisiones (tarea que no es autorización) corre de inmediato', async () => {
    expect(await runAfterSettled([], () => 7)).toBe(7);
    expect(await runAfterSettled([undefined], () => 8)).toBe(8);
  });
});
