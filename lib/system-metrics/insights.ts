/**
 * Motor de diagnóstico del Monitor del sistema.
 *
 * Convierte números en frases: lee las métricas del rango y devuelve "hallazgos" en español
 * (qué pasa, por qué importa y qué mirar), ordenados por gravedad. La pantalla muestra primero
 * el veredicto general y estos hallazgos; los gráficos quedan como evidencia.
 *
 * Es una función PURA (sin SQL ni fetch) para poder probar cada regla. Los umbrales viven en
 * THRESHOLDS para ajustarlos en un solo lugar (el log de transacciones, en logHealth.ts).
 */

import { judgeLog, type LogContext } from './logHealth';

export type Severity = 'critical' | 'warning' | 'info' | 'ok';
export type InsightArea = 'servidor' | 'trafico' | 'base' | 'externos';

export type Insight = {
  id: string;
  severity: Severity;
  area: InsightArea;
  title: string;
  detail: string;
};

export const THRESHOLDS = {
  hostCpu: { warning: 60, critical: 85 },
  hostMem: { warning: 75, critical: 90 },
  eventLoopMs: { warning: 100, critical: 500 },
  errorPct: { warning: 1, critical: 5 },
  sqlCpu: { warning: 60, critical: 85 },
  blocked: { warning: 1, critical: 5 },
  /** Variación de latencia frente al periodo anterior para avisar. */
  slowerPct: 50,
  slowerMinMs: 300,
  /** Crecimiento de memoria sin bajar que sugiere una fuga. */
  memoryGrowthPct: 25,
  /** Ejecuciones por minuto de una misma consulta que vale la pena señalar. */
  hotQueryPerMin: 100,
  prismaConnections: 20,
  minRequestsForRates: 50,
} as const;

type Summary = {
  samples: number;
  requests: number;
  errors: number;
  p95Ms: number | null;
  outRequests: number;
  outErrors: number;
  outThrottled: number;
  maxPoolPending: number | null;
};

type ProcessPoint = {
  bucket: string;
  host: string;
  instance: string;
  rssMb: number | null;
  hostCpuPct: number | null;
  hostMemUsedPct: number | null;
  eventLoopP99Ms: number | null;
  poolPending: number | null;
};

type DbPoint = {
  hasServerState: boolean;
  sqlCpuPct: number | null;
  blockedRequests: number | null;
  longestWaitMs: number | null;
  logUsedPct: number | null;
};

type OutboundRow = { key: string; label?: string; requests: number; errors: number; throttled: number; p95Ms: number };

type DbLive = {
  hasServerState: boolean;
  queryStore: string | null;
  databaseName?: string | null;
  sqlServerStartedAt: string | null;
  connections: Array<{ programName: string; sessions: number }>;
  topQueries: Array<{ statement: string; executions: number; totalCpuMs: number }>;
  logUsedPct?: number | null;
  log?: LogContext | null;
};

type Lifetime = { host: string; instance: string; pid: number; firstSeen: string };

export type InsightInput = {
  rangeLabel: string;
  summary: { current: Summary; previous: Summary } | null;
  processSeries: ProcessPoint[];
  db: DbPoint[];
  outbound: OutboundRow[];
  dbLive: DbLive | null;
  lifetimes: Lifetime[];
  now?: Date;
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

function level(value: number | null | undefined, t: { warning: number; critical: number }): Severity | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= t.critical) return 'critical';
  if (value >= t.warning) return 'warning';
  return null;
}

const fmt = (n: number, digits = 0) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits }).format(n);

function instanceName(instance: string): string {
  return instance === 'unica' ? 'Kronos' : `Kronos #${instance}`;
}

/** Último valor no nulo de una serie. */
function lastValue<T>(rows: T[], pick: (r: T) => number | null): number | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const v = pick(rows[i]);
    if (v != null) return v;
  }
  return null;
}

/** Tabla principal de una consulta SQL (`FROM [dbo].[chat_message]` → `chat_message`). */
export function mainTableOf(statement: string): string | null {
  const m = /\b(?:from|into|update)\s+([\w.[\]]+)/i.exec(statement);
  if (!m) return null;
  const last = m[1].split('.').pop()?.replace(/[[\]]/g, '') ?? '';
  return last || null;
}

/**
 * Detecta memoria que solo crece: el promedio del último tercio supera al del primero en más
 * de THRESHOLDS.memoryGrowthPct y el último valor está cerca del máximo (no hubo bajada).
 */
export function looksLikeMemoryLeak(values: number[]): { growthPct: number } | null {
  if (values.length < 12) return null;
  const third = Math.floor(values.length / 3);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = avg(values.slice(0, third));
  const lastThird = avg(values.slice(-third));
  if (first <= 0) return null;
  const growthPct = ((lastThird - first) / first) * 100;
  const max = Math.max(...values);
  const last = values[values.length - 1];
  if (growthPct >= THRESHOLDS.memoryGrowthPct && last >= max * 0.95) return { growthPct };
  return null;
}

export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const add = (i: Insight) => out.push(i);
  const now = input.now ?? new Date();
  const cur = input.summary?.current;
  const prev = input.summary?.previous;

  // --- Servidor de la aplicación -----------------------------------------------------------
  const hostCpu = lastValue(input.processSeries, (r) => r.hostCpuPct);
  const cpuLevel = level(hostCpu, THRESHOLDS.hostCpu);
  if (cpuLevel && hostCpu != null) {
    add({
      id: 'host-cpu',
      severity: cpuLevel,
      area: 'servidor',
      title: `El servidor está usando ${fmt(hostCpu)} % de CPU`,
      detail:
        'Con la CPU tan ocupada todas las pantallas responden más lento. Revise en "Tiempo de servidor" qué módulo está consumiendo más.',
    });
  }

  const hostMem = lastValue(input.processSeries, (r) => r.hostMemUsedPct);
  const memLevel = level(hostMem, THRESHOLDS.hostMem);
  if (memLevel && hostMem != null) {
    add({
      id: 'host-mem',
      severity: memLevel,
      area: 'servidor',
      title: `La memoria del servidor está al ${fmt(hostMem)} %`,
      detail: 'Si se llena, el sistema operativo empieza a usar disco y todo se vuelve lento, o pm2 reinicia Kronos.',
    });
  }

  const byInstance = new Map<string, ProcessPoint[]>();
  for (const r of input.processSeries) {
    const k = `${r.host}|${r.instance}`;
    const list = byInstance.get(k) ?? [];
    list.push(r);
    byInstance.set(k, list);
  }

  for (const [key, rows] of byInstance) {
    const instance = key.split('|')[1];
    const loop = lastValue(rows, (r) => r.eventLoopP99Ms);
    const loopLevel = level(loop, THRESHOLDS.eventLoopMs);
    if (loopLevel && loop != null) {
      add({
        id: `event-loop-${key}`,
        severity: loopLevel,
        area: 'servidor',
        title: `${instanceName(instance)} tarda ${fmt(loop)} ms en atender trabajo nuevo`,
        detail:
          'Algo está bloqueando el proceso (un cálculo pesado, un PDF, un archivo grande). Mientras dure, ninguna petición de esa instancia avanza.',
      });
    }

    const rss = rows.map((r) => r.rssMb).filter((v): v is number => v != null);
    const leak = looksLikeMemoryLeak(rss);
    if (leak) {
      add({
        id: `memory-leak-${key}`,
        severity: 'warning',
        area: 'servidor',
        title: `La memoria de ${instanceName(instance)} solo crece (+${fmt(leak.growthPct)} % en ${input.rangeLabel})`,
        detail:
          'No baja en ningún momento: suele ser una fuga (cachés sin límite, conexiones sin cerrar). El reinicio diario de pm2 la esconde.',
      });
    }
  }

  const restartsByInstance = new Map<string, number>();
  for (const l of input.lifetimes) {
    const k = `${l.host}|${l.instance}`;
    restartsByInstance.set(k, (restartsByInstance.get(k) ?? 0) + 1);
  }
  for (const [key, processes] of restartsByInstance) {
    const restarts = processes - 1;
    if (restarts <= 0) continue;
    const instance = key.split('|')[1];
    add({
      id: `restarts-${key}`,
      severity: restarts >= 3 ? 'warning' : 'info',
      area: 'servidor',
      title: `${instanceName(instance)} se reinició ${restarts === 1 ? '1 vez' : `${restarts} veces`} en ${input.rangeLabel}`,
      detail:
        restarts >= 3
          ? 'Varios reinicios seguidos suelen ser caídas (error no controlado o falta de memoria). Revise los logs de pm2.'
          : 'Puede ser el reinicio programado de las 00:02 o un despliegue.',
    });
  }

  // --- Tráfico y errores ----------------------------------------------------------------------
  if (cur && cur.requests >= THRESHOLDS.minRequestsForRates) {
    const errorPct = (cur.errors / cur.requests) * 100;
    const errLevel = level(errorPct, THRESHOLDS.errorPct);
    if (errLevel) {
      add({
        id: 'error-rate',
        severity: errLevel,
        area: 'trafico',
        title: `${fmt(errorPct, 1)} % de las peticiones terminan en error`,
        detail: `${fmt(cur.errors)} de ${fmt(cur.requests)} respuestas fueron errores del servidor (5xx). La tabla "Rutas más pesadas" muestra cuáles fallan.`,
      });
    }
  }

  if (cur?.p95Ms != null && prev?.p95Ms != null && prev.p95Ms > 0 && prev.samples > 0) {
    const change = ((cur.p95Ms - prev.p95Ms) / prev.p95Ms) * 100;
    if (change >= THRESHOLDS.slowerPct && cur.p95Ms >= THRESHOLDS.slowerMinMs) {
      add({
        id: 'slower',
        severity: 'warning',
        area: 'trafico',
        title: `Kronos responde ${fmt(change)} % más lento que en el periodo anterior`,
        detail: `El 95 % de las peticiones tarda hasta ${fmt(cur.p95Ms)} ms (antes ${fmt(prev.p95Ms)} ms).`,
      });
    }
  }

  if (cur && prev && prev.samples > 0 && prev.requests >= THRESHOLDS.minRequestsForRates) {
    const change = ((cur.requests - prev.requests) / prev.requests) * 100;
    if (Math.abs(change) >= 50) {
      add({
        id: 'traffic-change',
        severity: 'info',
        area: 'trafico',
        title: `El tráfico ${change > 0 ? 'subió' : 'bajó'} ${fmt(Math.abs(change))} % frente al periodo anterior`,
        detail: `${fmt(cur.requests)} peticiones ahora contra ${fmt(prev.requests)} antes.`,
      });
    }
  }

  const pending = cur?.maxPoolPending ?? lastValue(input.processSeries, (r) => r.poolPending);
  if (pending != null && pending > 0) {
    add({
      id: 'pool-pending',
      severity: pending >= 5 ? 'critical' : 'warning',
      area: 'base',
      title:
        pending === 1
          ? 'Una petición tuvo que esperar una conexión libre a SQL'
          : `Hasta ${fmt(pending)} peticiones esperaron una conexión libre a SQL`,
      detail:
        'El pool de conexiones de Kronos se quedó corto: o hay consultas lentas que retienen conexiones, o llamadas externas lentas dentro de una transacción.',
    });
  }

  // --- Base de datos ------------------------------------------------------------------------
  const sqlCpu = lastValue(input.db, (r) => r.sqlCpuPct);
  const sqlLevel = level(sqlCpu, THRESHOLDS.sqlCpu);
  if (sqlLevel && sqlCpu != null) {
    add({
      id: 'sql-cpu',
      severity: sqlLevel,
      area: 'base',
      title: `SQL Server está usando ${fmt(sqlCpu)} % de CPU`,
      detail: 'Mire "Consultas que más CPU consumen": normalmente una o dos explican casi todo el consumo.',
    });
  }

  const maxBlocked = input.db.reduce((acc, r) => Math.max(acc, r.blockedRequests ?? 0), 0);
  const blockedLevel = level(maxBlocked, THRESHOLDS.blocked);
  if (blockedLevel) {
    const wait = input.db.reduce((acc, r) => Math.max(acc, r.longestWaitMs ?? 0), 0);
    add({
      id: 'blocked',
      severity: blockedLevel,
      area: 'base',
      title:
        maxBlocked === 1
          ? 'Hubo una consulta bloqueada esperando a otra'
          : `Hubo hasta ${fmt(maxBlocked)} consultas bloqueadas al mismo tiempo`,
      detail: `La espera más larga fue de ${fmt(wait / 1000, 1)} s. Un bloqueo largo congela a todos los usuarios que tocan esas tablas.`,
    });
  }

  const logVerdict = judgeLog(input.dbLive?.logUsedPct ?? lastValue(input.db, (r) => r.logUsedPct), input.dbLive?.log ?? null);
  if (logVerdict) {
    add({
      id: 'log-used',
      severity: logVerdict.severity,
      area: 'base',
      title: logVerdict.title,
      detail: `${logVerdict.happening} ${logVerdict.risk} ${logVerdict.action}`,
    });
  }

  const live = input.dbLive;
  if (live?.hasServerState && live.sqlServerStartedAt) {
    const minutesUp = Math.max(1, (now.getTime() - new Date(live.sqlServerStartedAt).getTime()) / 60000);
    const hot = live.topQueries
      .map((q) => ({ ...q, perMin: q.executions / minutesUp }))
      .filter((q) => q.perMin >= THRESHOLDS.hotQueryPerMin)
      .sort((a, b) => b.perMin - a.perMin)[0];
    if (hot) {
      const table = mainTableOf(hot.statement);
      add({
        id: 'hot-query',
        severity: 'info',
        area: 'base',
        title: `${table ? `La consulta a ${table}` : 'Una consulta'} se ejecuta ~${fmt(hot.perMin)} veces por minuto`,
        detail:
          'Cada ejecución es rápida, pero por volumen es de lo que más carga a SQL. Suele venir de pantallas que se actualizan solas (polling); una caché corta o subir el intervalo la reduce mucho.',
      });
    }

    const prisma = live.connections
      .filter((c) => c.programName.toLowerCase() === 'tiberius')
      .reduce((acc, c) => acc + c.sessions, 0);
    if (prisma >= THRESHOLDS.prismaConnections) {
      add({
        id: 'prisma-connections',
        severity: 'info',
        area: 'base',
        title: `Prisma mantiene ${fmt(prisma)} conexiones abiertas a la base`,
        detail:
          'Además del pool de mssql. Cada instancia de pm2 abre las suyas; si sumadas se acercan al límite del servidor, conviene bajar connection_limit.',
      });
    }
  }

  if (live && !live.hasServerState) {
    add({
      id: 'no-server-state',
      severity: 'info',
      area: 'base',
      title: 'Faltan permisos para ver la actividad de SQL Server',
      detail: 'Sin VIEW SERVER STATE no se ven CPU de SQL, bloqueos ni consultas pesadas.',
    });
  } else if (live && live.queryStore && live.queryStore !== 'READ_WRITE') {
    add({
      id: 'query-store',
      severity: 'info',
      area: 'base',
      title: live.databaseName ? `Query Store está apagado en ${live.databaseName}` : 'Query Store está apagado',
      detail:
        'Sin él, el historial de consultas se pierde cada vez que SQL Server reinicia o limpia su caché. Activarlo permite comparar "antes y después" de un cambio.',
    });
  }

  // --- Servicios externos ---------------------------------------------------------------------
  for (const o of input.outbound) {
    const name = o.label ?? o.key;
    if (o.throttled > 0) {
      add({
        id: `throttled-${o.key}`,
        severity: o.throttled >= 20 ? 'warning' : 'info',
        area: 'externos',
        title: `${name} rechazó ${fmt(o.throttled)} llamadas por exceso (429)`,
        detail:
          'El servicio está limitando a Kronos. Hay que reintentar respetando el encabezado Retry-After y evitar ráfagas de llamadas.',
      });
    }
    if (o.requests >= 20) {
      const failPct = (o.errors / o.requests) * 100;
      if (failPct >= 5) {
        add({
          id: `outbound-errors-${o.key}`,
          severity: failPct >= 20 ? 'critical' : 'warning',
          area: 'externos',
          title: `${fmt(failPct)} % de las llamadas a ${name} fallan`,
          detail: `${fmt(o.errors)} de ${fmt(o.requests)} llamadas terminaron en error o sin respuesta.`,
        });
      }
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export type Verdict = { severity: Severity; headline: string; sub: string };

const morePoints = (n: number, suffix: string) =>
  n === 1 ? `Y 1 punto más ${suffix}.` : `Y ${n} puntos más ${suffix}.`;

/** Frase principal del panel a partir de los hallazgos. */
export function verdictFrom(insights: Insight[], hasData: boolean): Verdict {
  if (!hasData) {
    return {
      severity: 'info',
      headline: 'Esperando los primeros datos',
      sub: 'El colector guarda un resumen cada minuto. En unos minutos aparece el diagnóstico.',
    };
  }
  const critical = insights.filter((i) => i.severity === 'critical');
  const warning = insights.filter((i) => i.severity === 'warning');
  if (critical.length) {
    return {
      severity: 'critical',
      headline: critical[0].title,
      sub:
        critical.length + warning.length > 1
          ? morePoints(critical.length + warning.length - 1, 'que requieren atención')
          : 'Requiere atención ahora.',
    };
  }
  if (warning.length) {
    return {
      severity: 'warning',
      headline: warning[0].title,
      sub: warning.length > 1 ? morePoints(warning.length - 1, 'para revisar') : 'Conviene revisarlo pronto.',
    };
  }
  return {
    severity: 'ok',
    headline: 'Todo funciona con normalidad',
    sub:
      insights.length === 1
        ? 'Hay 1 observación informativa abajo.'
        : insights.length > 1
          ? `Hay ${insights.length} observaciones informativas abajo.`
          : 'Servidor, base de datos y servicios externos dentro de lo esperado.',
  };
}
