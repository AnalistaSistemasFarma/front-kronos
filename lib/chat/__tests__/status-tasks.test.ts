import { describe, expect, it } from 'vitest';
import { normalizeAgentTasks, parseAgentTasks } from '../status-tasks';
import { MAX_STATUS_TASKS, MAX_TASK_DESC_CHARS } from '../constants';

describe('normalizeAgentTasks', () => {
  it('trata la ausencia como "no hay nada que guardar"', () => {
    expect(normalizeAgentTasks(undefined)).toBeNull();
    expect(normalizeAgentTasks(null)).toBeNull();
    expect(normalizeAgentTasks([])).toBeNull();
  });

  it('distingue "lista vacía" de "esto no es una lista"', () => {
    // undefined = error del llamador; la ruta responde 400 con esto.
    expect(normalizeAgentTasks('phishing')).toBeUndefined();
    expect(normalizeAgentTasks({ desc: 'phishing' })).toBeUndefined();
  });

  it('descarta entradas sin descripción utilizable', () => {
    expect(normalizeAgentTasks([{ desc: '   ' }, null, 42, { otra: 'cosa' }])).toBeNull();
  });

  it('recorta la descripción al tope', () => {
    const tasks = normalizeAgentTasks([{ desc: 'x'.repeat(MAX_TASK_DESC_CHARS + 50) }]);
    expect(tasks?.[0].desc).toHaveLength(MAX_TASK_DESC_CHARS);
  });

  it('corta la lista en el tope en vez de rechazarla', () => {
    const many = Array.from({ length: MAX_STATUS_TASKS + 5 }, (_, i) => ({ desc: `tarea ${i}` }));
    expect(normalizeAgentTasks(many)).toHaveLength(MAX_STATUS_TASKS);
  });

  it('acepta startedAt en segundos, milisegundos e ISO', () => {
    const iso = '2026-09-07T13:20:00.000Z';
    const ms = Date.parse(iso);
    const seconds = Math.floor(ms / 1000);

    // El hook de bash manda SEGUNDOS (date +%s); el resto del código, ms.
    expect(normalizeAgentTasks([{ desc: 'a', startedAt: seconds }])?.[0].startedAt).toBe(iso);
    expect(normalizeAgentTasks([{ desc: 'a', startedAt: ms }])?.[0].startedAt).toBe(iso);
    expect(normalizeAgentTasks([{ desc: 'a', startedAt: iso }])?.[0].startedAt).toBe(iso);
  });

  it('deja startedAt en null cuando no se puede interpretar', () => {
    expect(normalizeAgentTasks([{ desc: 'a' }])?.[0].startedAt).toBeNull();
    expect(normalizeAgentTasks([{ desc: 'a', startedAt: 'ayer' }])?.[0].startedAt).toBeNull();
    expect(normalizeAgentTasks([{ desc: 'a', startedAt: {} }])?.[0].startedAt).toBeNull();
  });
});

describe('parseAgentTasks', () => {
  it('devuelve lista vacía ante nada o basura', () => {
    expect(parseAgentTasks(null)).toEqual([]);
    expect(parseAgentTasks('')).toEqual([]);
    expect(parseAgentTasks('{no es json')).toEqual([]);
    // Una fila vieja con otra forma no puede tumbar el chat.
    expect(parseAgentTasks('{"desc":"suelto"}')).toEqual([]);
  });

  it('lee lo que se guardó', () => {
    const raw = JSON.stringify([{ desc: 'Muestra de phishing', startedAt: '2026-09-07T13:20:00.000Z' }]);
    expect(parseAgentTasks(raw)).toEqual([
      { desc: 'Muestra de phishing', startedAt: '2026-09-07T13:20:00.000Z' },
    ]);
  });
});
