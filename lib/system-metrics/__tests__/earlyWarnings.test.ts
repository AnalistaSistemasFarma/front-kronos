import { describe, expect, it } from 'vitest';
import {
  alertsToNotify,
  evaluateEarlyWarnings,
  notificationPayload,
  type EarlyWarning,
  type WatchDbSample,
  type WatchSample,
} from '../earlyWarnings';

// 9:30 a. m. en Bogotá.
const NOW = new Date('2026-10-07T14:30:20Z');

const minuteIso = (minsAgo: number, now = NOW) =>
  new Date(Math.floor(now.getTime() / 60_000) * 60_000 - minsAgo * 60_000).toISOString();

const sample = (minsAgo: number, over: Partial<WatchSample> = {}, now = NOW): WatchSample => ({
  sampledAt: minuteIso(minsAgo, now),
  host: 'SERFARMA05',
  instance: '0',
  pid: 100,
  hostCpuPct: 20,
  hostMemUsedPct: 50,
  hostMemTotalMb: 20480,
  rssMb: 500,
  eventLoopP99Ms: 20,
  eventLoopMaxMs: 40,
  httpRequests: 30,
  httpErrors: 0,
  poolPending: 0,
  ...over,
});

type Proc = { pid: number; instance: string; from: number; to: number };

/** Muestras de cada proceso entre `from` y `to` minutos atrás (ambos incluidos). */
function series(procs: Proc[], over: (minsAgo: number, p: Proc) => Partial<WatchSample> = () => ({}), now = NOW) {
  const out: WatchSample[] = [];
  for (const p of procs) {
    for (let m = p.from; m >= p.to; m -= 1) out.push(sample(m, { pid: p.pid, instance: p.instance, ...over(m, p) }, now));
  }
  return out;
}

const normal: Proc[] = [
  { pid: 100, instance: '0', from: 60, to: 0 },
  { pid: 101, instance: '1', from: 60, to: 0 },
];

const run = (samples: WatchSample[], db: WatchDbSample[] = [], now = NOW) =>
  evaluateEarlyWarnings({ now, samples, db, expectedProcesses: 2 });

const rules = (ws: EarlyWarning[]) => ws.map((w) => w.rule).sort();

describe('evaluateEarlyWarnings', () => {
  it('una hora normal no genera alertas', () => {
    expect(run(series(normal))).toEqual([]);
  });

  it('detecta Kronos duplicado (4 copias en vez de 2)', () => {
    const samples = series([
      ...normal,
      { pid: 200, instance: '0', from: 3, to: 0 },
      { pid: 201, instance: '1', from: 3, to: 0 },
    ]);
    const [w] = run(samples);
    expect(w).toMatchObject({ rule: 'duplicados', severity: 'critical' });
    expect(w.title).toContain('4 copias en vez de 2');
    expect(w.why).toMatch(/a mano/);
  });

  it('un reinicio normal (un minuto con el pid viejo y el nuevo) no es duplicado ni alerta', () => {
    const samples = series([
      { pid: 100, instance: '0', from: 60, to: 10 },
      { pid: 102, instance: '0', from: 10, to: 0 },
      { pid: 101, instance: '1', from: 60, to: 0 },
    ]);
    expect(run(samples)).toEqual([]);
  });

  it('todos los procesos congelados a la vez = la máquina, no Kronos', () => {
    const samples = series(normal, (m) => (m === 3 ? { eventLoopMaxMs: 10_500 } : {}));
    const [w] = run(samples);
    expect(w).toMatchObject({ rule: 'congelamiento', severity: 'critical' });
    expect(w.title).toContain('10,5 s a las 09:27');
    expect(w.happening).toContain('Todos los procesos');
    expect(w.action).toContain('153');
  });

  it('un solo proceso con una pausa no se toma como congelamiento de la máquina', () => {
    const samples = series(normal, (m, p) => (m === 3 && p.pid === 100 ? { eventLoopMaxMs: 4000 } : {}));
    expect(run(samples)).toEqual([]);
  });

  it('avisa ANTES de que la memoria se llene, por la tendencia', () => {
    // De 70 % a 84 % en 20 minutos (0,7 puntos por minuto): llega a 95 % en ~16 minutos.
    const samples = series(normal, (m) => ({ hostMemUsedPct: m > 20 ? 70 : 84 - m * 0.7 }));
    const [w] = run(samples);
    expect(w).toMatchObject({ rule: 'memoria', severity: 'warning' });
    expect(w.title).toMatch(/se llenaría en unos 1[5-7] minutos/);
    expect(w.happening).toContain('de 20 GB');
  });

  it('memoria por encima del 92 % es crítica', () => {
    const [w] = run(series(normal, () => ({ hostMemUsedPct: 93 })));
    expect(w).toMatchObject({ rule: 'memoria', severity: 'critical' });
  });

  it('CPU arriba 5 minutos seguidos sí; un pico de 3 minutos no', () => {
    const sustained = run(series(normal, (m) => (m <= 5 ? { hostCpuPct: 95 } : {})));
    expect(sustained).toHaveLength(1);
    expect(sustained[0]).toMatchObject({ rule: 'cpu', severity: 'critical' });
    expect(sustained[0].action).toContain('pm2 list');

    expect(run(series(normal, (m) => (m <= 2 ? { hostCpuPct: 95 } : {})))).toEqual([]);
  });

  it('minutos sin datos (máquina congelada o reiniciándose)', () => {
    const samples = series(normal).filter((s) => {
      const minsAgo = Math.round((Date.parse(minuteIso(0)) - Date.parse(s.sampledAt)) / 60_000);
      return minsAgo > 40 || minsAgo < 30;
    });
    const [w] = run(samples);
    expect(w).toMatchObject({ rule: 'sin-datos', severity: 'critical' });
    expect(w.title).toBe('El servidor estuvo 11 minutos sin dar señales (de 08:50 a 09:01)');
    expect(w.key).toBe('sin-datos-2026-10-07T13:50');
  });

  it('Kronos se reinició completo fuera de medianoche (p. ej. al cerrar la sesión de Windows)', () => {
    const samples = series([
      { pid: 100, instance: '0', from: 60, to: 8 },
      { pid: 101, instance: '1', from: 60, to: 8 },
      { pid: 300, instance: '0', from: 7, to: 0 },
      { pid: 301, instance: '1', from: 7, to: 0 },
    ]);
    const [w] = run(samples);
    expect(w).toMatchObject({ rule: 'reinicio-total', severity: 'warning' });
    expect(w.title).toBe('Kronos se reinició completo a las 09:23');
    expect(w.why).toMatch(/cerró la sesión de Windows/);
  });

  it('el reinicio programado de las 00:02 no alerta', () => {
    const midnight = new Date('2026-10-07T05:10:20Z'); // 00:10 en Bogotá
    const samples = series(
      [
        { pid: 100, instance: '0', from: 60, to: 9 },
        { pid: 101, instance: '1', from: 60, to: 9 },
        { pid: 300, instance: '0', from: 8, to: 0 },
        { pid: 301, instance: '1', from: 8, to: 0 },
      ],
      () => ({}),
      midnight
    );
    expect(run(samples, [], midnight)).toEqual([]);
  });

  it('Kronos reiniciándose en bucle', () => {
    const loop: Proc[] = [
      { pid: 100, instance: '0', from: 60, to: 31 },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ pid: 500 + i, instance: '0', from: 30 - i * 5, to: Math.max(0, 26 - i * 5) })),
      { pid: 101, instance: '1', from: 60, to: 0 },
    ];
    const [w] = run(series(loop));
    expect(w).toMatchObject({ rule: 'reinicios', severity: 'critical' });
    expect(w.title).toBe('Kronos arrancó 6 veces en la última hora');
  });

  it('SQL: bloqueos y log de transacciones; una foto vieja no cuenta', () => {
    const db: WatchDbSample[] = [{ sampledAt: minuteIso(2), blockedRequests: 6, longestWaitMs: 12_000, logUsedPct: 96 }];
    expect(rules(run(series(normal), db))).toEqual(['bloqueos-sql', 'log-sql']);
    const found = run(series(normal), db);
    expect(found.find((w) => w.rule === 'bloqueos-sql')?.severity).toBe('warning');
    expect(found.find((w) => w.rule === 'log-sql')?.severity).toBe('critical');

    const stale: WatchDbSample[] = [{ ...db[0], sampledAt: minuteIso(30) }];
    expect(run(series(normal), stale)).toEqual([]);
  });

  it('fila para conexiones SQL y errores del servidor', () => {
    const samples = series(normal, (m) => (m <= 4 ? { poolPending: 4, httpErrors: 3 } : {}));
    expect(rules(run(samples))).toEqual(['conexiones-sql', 'errores']);
  });

  it('un proceso de Kronos bloqueado o con demasiada memoria', () => {
    const samples = series(normal, (m, p) =>
      p.pid === 100 ? { eventLoopP99Ms: m <= 3 ? 800 : 20, rssMb: 1800 } : {}
    );
    expect(rules(run(samples))).toEqual(['memoria-kronos', 'proceso-bloqueado']);
  });
});

describe('alertsToNotify', () => {
  const warning: EarlyWarning = {
    key: 'cpu',
    rule: 'cpu',
    severity: 'warning',
    title: 't',
    happening: 'h',
    why: 'w',
    risk: 'r',
    action: 'a',
  };
  const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

  it('nueva: se avisa', () => {
    expect(alertsToNotify([warning], new Map(), NOW)).toHaveLength(1);
  });

  it('repetida dentro del tiempo de espera: no se repite', () => {
    const last = new Map([['cpu', { severity: 'warning' as const, raisedAt: minutesAgo(30) }]]);
    expect(alertsToNotify([warning], last, NOW)).toHaveLength(0);
  });

  it('empeoró a crítica: se avisa aunque esté en espera', () => {
    const last = new Map([['cpu', { severity: 'warning' as const, raisedAt: minutesAgo(5) }]]);
    expect(alertsToNotify([{ ...warning, severity: 'critical' }], last, NOW)).toHaveLength(1);
  });

  it('pasó el tiempo de espera (2 h advertencia, 30 min crítica): se repite', () => {
    expect(alertsToNotify([warning], new Map([['cpu', { severity: 'warning' as const, raisedAt: minutesAgo(121) }]]), NOW)).toHaveLength(1);
    const critical = { ...warning, severity: 'critical' as const };
    expect(alertsToNotify([critical], new Map([['cpu', { severity: 'critical' as const, raisedAt: minutesAgo(20) }]]), NOW)).toHaveLength(0);
    expect(alertsToNotify([critical], new Map([['cpu', { severity: 'critical' as const, raisedAt: minutesAgo(31) }]]), NOW)).toHaveLength(1);
  });
});

describe('notificationPayload', () => {
  it('marca la gravedad en el título y resume qué puede pasar', () => {
    const p = notificationPayload({
      key: 'memoria',
      rule: 'memoria',
      severity: 'critical',
      title: 'La memoria del servidor está al 93 %',
      happening: 'El servidor está usando el 93 %.',
      why: 'w',
      risk: 'Todo se vuelve lento.',
      action: 'a',
    });
    expect(p.title).toBe('Alerta crítica: La memoria del servidor está al 93 % · SynerLink');
    expect(p.body).toBe('El servidor está usando el 93 %. Qué puede pasar: Todo se vuelve lento.');
  });
});
