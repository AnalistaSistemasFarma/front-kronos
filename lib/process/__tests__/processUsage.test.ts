import { describe, expect, it, beforeEach } from 'vitest';
import {
  HALF_LIFE_DAYS,
  MIN_USES_TO_PROMOTE,
  buildUsageIndex,
  currentScore,
  readCompressedPreference,
  readLocalUsage,
  recordLocalOpen,
  registerOpen,
  sortByRecurrence,
  writeCompressedPreference,
  type SubprocessUsage,
} from '../processUsage';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 4);

const local = new Map<string, string>();
const session = new Map<string, string>();

beforeEach(() => {
  local.clear();
  session.clear();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (k: string) => local.get(k) ?? null,
        setItem: (k: string, v: string) => {
          local.set(k, v);
        },
      },
      sessionStorage: {
        getItem: (k: string) => session.get(k) ?? null,
        setItem: (k: string, v: string) => {
          session.set(k, v);
        },
      },
    },
  });
});

function abrir(veces: number, ids: { id_subprocess: number; id_process: number }, at = NOW) {
  let entry: SubprocessUsage | undefined;
  for (let i = 0; i < veces; i++) entry = registerOpen(entry, ids, at);
  return entry!;
}

describe('orden por recurrencia (sortByRecurrence)', () => {
  const lista = [
    { id: 1, nombre: 'Compras' },
    { id: 2, nombre: 'Solicitudes' },
    { id: 3, nombre: 'Usuarios' },
  ];
  const ordenar = (puntos: Record<number, number>) =>
    sortByRecurrence(lista, (p) => puntos[p.id]).map((p) => p.id);

  it('abrir algo una o dos veces (uso ocasional) no lo sube', () => {
    expect(ordenar({ 3: 1 })).toEqual([1, 2, 3]);
    expect(ordenar({ 3: MIN_USES_TO_PROMOTE - 1 })).toEqual([1, 2, 3]);
  });

  it('al llegar al mínimo sube, y manda el que más se abre', () => {
    expect(ordenar({ 3: MIN_USES_TO_PROMOTE })).toEqual([3, 1, 2]);
    expect(ordenar({ 2: 10, 3: 4 })).toEqual([2, 3, 1]);
  });

  it('en empate conserva el orden de siempre (no premia al último abierto)', () => {
    expect(ordenar({ 2: 5, 3: 5 })).toEqual([2, 3, 1]);
  });
});

describe('olvido de lo viejo', () => {
  it(`cada ${HALF_LIFE_DAYS} días los puntos valen la mitad`, () => {
    const e = abrir(8, { id_subprocess: 1, id_process: 10 });
    expect(currentScore(e, NOW)).toBeCloseTo(8);
    expect(currentScore(e, NOW + HALF_LIFE_DAYS * DAY)).toBeCloseTo(4);
    expect(currentScore(e, NOW + 2 * HALF_LIFE_DAYS * DAY)).toBeCloseTo(2);
  });

  it('lo muy usado hace meses deja de estar arriba; lo de este mes lo pasa', () => {
    const viejo = abrir(20, { id_subprocess: 1, id_process: 10 }, NOW - 150 * DAY); // 20 → ~0.6
    const nuevo = abrir(4, { id_subprocess: 2, id_process: 20 }, NOW - 2 * DAY);
    const { byProcess } = buildUsageIndex([viejo, nuevo], NOW);
    const orden = sortByRecurrence([10, 20], (id) => byProcess.get(id));
    expect(orden).toEqual([20, 10]);
  });

  it('registrar una apertura suma 1 a lo que quedaba (no al total viejo)', () => {
    const viejo = abrir(4, { id_subprocess: 1, id_process: 10 }, NOW - HALF_LIFE_DAYS * DAY);
    const e = registerOpen(viejo, { id_subprocess: 1, id_process: 10 }, NOW);
    expect(e.score).toBeCloseTo(3);
    expect(e.count).toBe(5);
  });

  it('el proceso suma los puntos de todos sus accesos', () => {
    const a = abrir(2, { id_subprocess: 1, id_process: 10 });
    const b = abrir(2, { id_subprocess: 2, id_process: 10 });
    expect(buildUsageIndex([a, b], NOW).byProcess.get(10)).toBeCloseTo(4);
  });
});

describe('copia en el navegador', () => {
  it('guarda y suma aperturas por usuario', () => {
    recordLocalOpen('u1', { id_subprocess: 5, id_process: 20 });
    recordLocalOpen('u1', { id_subprocess: 5, id_process: 20 });
    const [e] = readLocalUsage('u1');
    expect(e).toMatchObject({ id_subprocess: 5, id_process: 20, count: 2 });
    expect(readLocalUsage('otro')).toEqual([]);
  });

  it('guarda comprimir en sessionStorage', () => {
    expect(readCompressedPreference()).toBe(false);
    writeCompressedPreference(true);
    expect(readCompressedPreference()).toBe(true);
    writeCompressedPreference(false);
    expect(readCompressedPreference()).toBe(false);
  });
});
