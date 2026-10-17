import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ColaHilos } from '../src/cola.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ejecutor que registra cuántos corren a la vez, en total y por hilo. */
function ejecutorMedido(duracionMs = 20) {
  const m = { maxGlobal: 0, actual: 0, porHilo: new Map(), maxPorHilo: 0, lotes: [] };
  m.ejecutar = async (clave, lote) => {
    m.actual += 1;
    m.maxGlobal = Math.max(m.maxGlobal, m.actual);
    const enHilo = (m.porHilo.get(clave) ?? 0) + 1;
    m.porHilo.set(clave, enHilo);
    m.maxPorHilo = Math.max(m.maxPorHilo, enHilo);
    m.lotes.push({ clave, lote: [...lote] });
    await pausa(duracionMs);
    m.porHilo.set(clave, m.porHilo.get(clave) - 1);
    m.actual -= 1;
  };
  return m;
}

test('una misma sesión nunca corre dos veces a la vez', async () => {
  const m = ejecutorMedido();
  const cola = new ColaHilos({ maxConcurrencia: 2, ejecutar: m.ejecutar });
  for (let i = 0; i < 5; i++) cola.encolar('A', i);
  await pausa(5);
  for (let i = 5; i < 8; i++) cola.encolar('A', i);
  await cola.vacia();
  assert.equal(m.maxPorHilo, 1);
  // Lo que llegó mientras corría sale JUNTO en el turno siguiente.
  assert.deepEqual(m.lotes.map((l) => l.lote), [[0, 1, 2, 3, 4], [5, 6, 7]]);
});

test('tope de 2 hilos simultáneos por agente', async () => {
  const m = ejecutorMedido(30);
  const esperando = [];
  const cola = new ColaHilos({ maxConcurrencia: 2, ejecutar: m.ejecutar, alEsperar: (c) => esperando.push(c) });
  for (const c of ['A', 'B', 'C', 'D']) cola.encolar(c, c);
  await pausa(1);
  assert.deepEqual(cola.estado().corriendo.sort(), ['A', 'B']);
  assert.deepEqual(cola.estado().esperando, ['C', 'D']);
  await cola.vacia();
  assert.equal(m.maxGlobal, 2);
  // Se avisa UNA vez a los que se quedaron sin cupo.
  assert.deepEqual(esperando, ['C', 'D']);
  assert.deepEqual(m.lotes.map((l) => l.clave).sort(), ['A', 'B', 'C', 'D']);
});

test('un hilo con mensajes nuevos vuelve al final de la fila (no acapara el turno)', async () => {
  const m = ejecutorMedido(20);
  const cola = new ColaHilos({ maxConcurrencia: 1, ejecutar: m.ejecutar });
  cola.encolar('A', 1);
  cola.encolar('B', 1);
  await pausa(5);
  cola.encolar('A', 2); // llega mientras A corre; B ya esperaba
  await cola.vacia();
  assert.deepEqual(m.lotes.map((l) => l.clave), ['A', 'B', 'A']);
});

test('un error en un hilo no frena a los demás', async () => {
  const errores = [];
  const lotes = [];
  const cola = new ColaHilos({
    maxConcurrencia: 2,
    ejecutar: async (clave, lote) => {
      lotes.push(clave);
      if (clave === 'A') throw new Error('falló');
    },
    alError: (clave) => errores.push(clave),
  });
  cola.encolar('A', 1);
  cola.encolar('B', 1);
  cola.encolar('C', 1);
  await cola.vacia();
  assert.deepEqual(errores, ['A']);
  assert.deepEqual(lotes.sort(), ['A', 'B', 'C']);
});

test('rechaza una concurrencia inválida', () => {
  assert.throws(() => new ColaHilos({ maxConcurrencia: 0, ejecutar: async () => {} }));
});
