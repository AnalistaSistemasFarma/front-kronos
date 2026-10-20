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

import { localParts, WARNING_THRESHOLDS } from './earlyWarnings';
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
  /** Minutos distintos con dato (si falta, se usa `samples`). */
  minutes?: number;
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
  bucket?: string;
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
  /** Consultas bloqueadas en la foto en vivo de esta base. */
  blocked?: unknown[];
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

/** Hallazgos de "algo que pasó" solo son atención/crítico si pasó en este último tramo. */
const RECENT_MIN = 15;
const TIME_ZONE = 'America/Bogota';

/**
 * El periodo anterior solo se compara si tiene datos de al menos el 80 % del tiempo del
 * actual: si el monitor estuvo apagado parte de él, la variación sale inflada.
 */
export function comparable(cur: Summary | undefined, prev: Summary | undefined): boolean {
  if (!cur || !prev || prev.samples <= 0) return false;
  const c = cur.minutes ?? cur.samples;
  const p = prev.minutes ?? prev.samples;
  return p >= c * 0.8;
}

/** Valor más alto entre el último dato de cada servidor (con varios servidores no basta la última fila). */
function latestPerHostMax(rows: ProcessPoint[], pick: (r: ProcessPoint) => number | null): number | null {
  const byHost = new Map<string, number>();
  for (const r of rows) {
    const v = pick(r);
    if (v != null) byHost.set(r.host, v);
  }
  return byHost.size ? Math.max(...byHost.values()) : null;
}

/** Filas cuyo `bucket` cae en los últimos RECENT_MIN minutos del dato más reciente. */
function recentRows<T extends { bucket?: string }>(rows: T[]): T[] {
  const times = rows.map((r) => (r.bucket ? Date.parse(r.bucket) : NaN)).filter(Number.isFinite);
  if (!times.length) return rows;
  const from = Math.max(...times) - RECENT_MIN * 60_000;
  return rows.filter((r) => !r.bucket || Date.parse(r.bucket) >= from);
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
  const hostCpu = latestPerHostMax(input.processSeries, (r) => r.hostCpuPct);
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

  const hostMem = latestPerHostMax(input.processSeries, (r) => r.hostMemUsedPct);
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

  // Reinicios: cada pid nuevo de una instancia (el primero del rango no cuenta). Los que nacen
  // en la franja del reinicio programado de pm2 (00:02, cron_restart) no son caídas: antes, en
  // 7 días salían ~6 "reinicios" por instancia y el panel quedaba en Atención sin motivo.
  const pidsByInstance = new Map<string, Lifetime[]>();
  for (const l of input.lifetimes) {
    const k = `${l.host}|${l.instance}`;
    pidsByInstance.set(k, [...(pidsByInstance.get(k) ?? []), l]);
  }
  const { fromMin, toMin } = WARNING_THRESHOLDS.cronWindow;
  const inCron = (iso: string) => {
    if (!Number.isFinite(Date.parse(iso))) return false;
    const m = localParts(iso, TIME_ZONE).minuteOfDay;
    return m >= fromMin && m < toMin;
  };
  for (const [key, pids] of pidsByInstance) {
    const later = [...pids].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen)).slice(1);
    const scheduled = later.filter((l) => inCron(l.firstSeen)).length;
    const restarts = later.length - scheduled;
    if (restarts <= 0) continue;
    const instance = key.split('|')[1];
    const scheduledNote =
      scheduled > 0 ? ` Sin contar ${scheduled === 1 ? 'el reinicio programado' : `${scheduled} reinicios programados`} de las 00:02.` : '';
    add({
      id: `restarts-${key}`,
      severity: restarts >= 3 ? 'warning' : 'info',
      area: 'servidor',
      title: `${instanceName(instance)} se reinició ${restarts === 1 ? '1 vez' : `${restarts} veces`} en ${input.rangeLabel}`,
      detail:
        (restarts >= 3
          ? 'Varios reinicios fuera del horario programado suelen ser caídas (error no controlado o falta de memoria) o despliegues. Revise los logs de pm2.'
          : 'Puede ser un despliegue o una caída: revise los logs de pm2 si no hubo despliegue.') + scheduledNote,
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
        detail: `${fmt(cur.errors)} de ${fmt(cur.requests)} respuestas fueron errores del servidor (5xx) o conexiones cortadas. La tabla "Rutas más pesadas" muestra cuáles fallan.`,
      });
    }
  }

  const prevComparable = comparable(cur, prev);
  if (cur?.p95Ms != null && prev?.p95Ms != null && prev.p95Ms > 0 && prevComparable) {
    const change = ((cur.p95Ms - prev.p95Ms) / prev.p95Ms) * 100;
    if (change >= THRESHOLDS.slowerPct && cur.p95Ms >= THRESHOLDS.slowerMinMs) {
      add({
        id: 'slower',
        severity: 'warning',
        area: 'trafico',
        title: `Kronos responde ${fmt(change)} % más lento que en el periodo anterior`,
        detail: `El p95 aproximado (promedio de los p95 de cada minuto) subió a ${fmt(cur.p95Ms)} ms (antes ${fmt(prev.p95Ms)} ms).`,
      });
    }
  }

  if (cur && prev && prevComparable && prev.requests >= THRESHOLDS.minRequestsForRates) {
    // Se comparan tasas (peticiones por minuto con dato), no totales.
    const rate = (s: Summary) => s.requests / Math.max(1, s.minutes ?? s.samples);
    const change = ((rate(cur) - rate(prev)) / rate(prev)) * 100;
    if (Math.abs(change) >= 50) {
      add({
        id: 'traffic-change',
        severity: 'info',
        area: 'trafico',
        title: `El tráfico ${change > 0 ? 'subió' : 'bajó'} ${fmt(Math.abs(change))} % frente al periodo anterior`,
        detail: `${fmt(rate(cur), 1)} peticiones por minuto ahora contra ${fmt(rate(prev), 1)} antes.`,
      });
    }
  }

  // Conexiones SQL agotadas: atención/crítico solo si pasó en los últimos 15 min; si fue antes
  // en el rango queda como información (antes un pico de hace 6 días dejaba el panel en rojo).
  const pendingOf = (rows: ProcessPoint[]) => rows.reduce((acc, r) => Math.max(acc, r.poolPending ?? 0), 0);
  const recentPending = pendingOf(recentRows(input.processSeries));
  const rangePending = Math.max(cur?.maxPoolPending ?? 0, pendingOf(input.processSeries));
  const pending = recentPending > 0 ? recentPending : rangePending;
  if (pending > 0) {
    add({
      id: 'pool-pending',
      severity: recentPending >= 5 ? 'critical' : recentPending > 0 ? 'warning' : 'info',
      area: 'base',
      title:
        (pending === 1
          ? 'Una petición tuvo que esperar una conexión libre a SQL'
          : `Hasta ${fmt(pending)} peticiones esperaron una conexión libre a SQL`) +
        (recentPending > 0 ? '' : ` en ${input.rangeLabel} (no en los últimos ${RECENT_MIN} min)`),
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

  // Igual que el pool: solo es atención/crítico si el bloqueo se vio en los últimos 15 min.
  const blockedOf = (rows: DbPoint[]) => rows.reduce((acc, r) => Math.max(acc, r.blockedRequests ?? 0), 0);
  const recentBlocked = blockedOf(recentRows(input.db));
  const maxBlocked = blockedOf(input.db);
  const blockedLevel = level(maxBlocked, THRESHOLDS.blocked);
  if (blockedLevel) {
    const wait = input.db.reduce((acc, r) => Math.max(acc, r.longestWaitMs ?? 0), 0);
    add({
      id: 'blocked',
      severity: recentBlocked > 0 ? (level(recentBlocked, THRESHOLDS.blocked) ?? 'warning') : 'info',
      area: 'base',
      title:
        (maxBlocked === 1
          ? 'Hubo una consulta bloqueada esperando a otra'
          : `Hubo hasta ${fmt(maxBlocked)} consultas bloqueadas al mismo tiempo`) +
        (recentBlocked > 0 ? '' : ` en ${input.rangeLabel} (no en los últimos ${RECENT_MIN} min)`),
      detail:
        (wait > 0 ? `La espera más larga fue de ${fmt(wait / 1000, 1)} s. ` : '') +
        'Un bloqueo largo congela a todos los usuarios que tocan esas tablas. Se revisa cada 5 minutos.',
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
      title: `Query Store está ${
        live.queryStore === 'READ_ONLY' ? 'en solo lectura (suele ser porque se llenó)' : live.queryStore === 'ERROR' ? 'con error' : 'apagado'
      }${live.databaseName ? ` en ${live.databaseName}` : ''}`,
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

const MAX_HIGHLIGHTS = 4;

/**
 * Lo que va BIEN, para mostrarlo primero en el panel y que no todo se lea como problemas.
 * Solo se dice lo que los datos respaldan, con los mismos umbrales de buildInsights: si un
 * área ya tiene un hallazgo (p. ej. CPU alta) no se celebra esa misma área.
 */
export function buildHighlights(input: InsightInput, insights: Insight[]): Insight[] {
  const out: Insight[] = [];
  const flagged = new Set(insights.filter((i) => i.severity !== 'ok').map((i) => i.id));
  const flaggedPrefix = (prefix: string) => Array.from(flagged).some((id) => id.startsWith(prefix));
  const cur = input.summary?.current;

  if (cur && cur.requests >= THRESHOLDS.minRequestsForRates && !flagged.has('error-rate')) {
    // Se trunca (no se redondea): 99,96 % no debe leerse "100 %" si hubo errores.
    const okPct = Math.floor(((cur.requests - cur.errors) / cur.requests) * 1000) / 10;
    out.push({
      id: 'good-errors',
      severity: 'ok',
      area: 'trafico',
      title: cur.errors === 0 ? 'Todas las peticiones respondieron sin error' : `${fmt(okPct, 1)} % de las peticiones respondieron sin error`,
      detail: `${fmt(cur.requests)} peticiones de pantallas y API en ${input.rangeLabel}.`,
    });
  }

  if (cur?.p95Ms != null && !flagged.has('slower') && cur.p95Ms < 1000) {
    out.push({
      id: 'good-speed',
      severity: 'ok',
      area: 'trafico',
      title: `Las pantallas responden rápido: unos ${fmt(cur.p95Ms)} ms`,
      detail: 'p95 aproximado: casi todas las peticiones de cada minuto terminan en ese tiempo o menos.',
    });
  }

  // Con margen real (no solo "debajo del umbral de atención") y el servidor más cargado.
  const hostCpu = latestPerHostMax(input.processSeries, (r) => r.hostCpuPct);
  const hostMem = latestPerHostMax(input.processSeries, (r) => r.hostMemUsedPct);
  if (hostCpu != null && hostMem != null && !flagged.has('host-cpu') && !flagged.has('host-mem')) {
    const roomy = hostCpu < 40 && hostMem < 65;
    out.push({
      id: 'good-server',
      severity: 'ok',
      area: 'servidor',
      title: roomy ? 'El servidor tiene capacidad de sobra' : 'CPU y memoria del servidor dentro de lo normal',
      detail: `Último dato: CPU al ${fmt(hostCpu)} % y memoria al ${fmt(hostMem)} %.`,
    });
  }

  const dbProblem =
    flagged.has('blocked') || flagged.has('sql-cpu') || flagged.has('pool-pending') || (input.dbLive?.blocked?.length ?? 0) > 0;
  if (input.db.some((r) => r.hasServerState) && !dbProblem) {
    out.push({
      id: 'good-db',
      severity: 'ok',
      area: 'base',
      title: 'Sin bloqueos en la base de datos',
      detail: 'No se vieron consultas esperando a otra en las revisiones de SQL (cada 5 min) ni en la foto en vivo.',
    });
  }

  // Cualquier servicio con fallas o rechazos (aunque tenga pocas llamadas) impide la frase.
  const outCalls = input.outbound.reduce((acc, o) => acc + o.requests, 0);
  const outbad = input.outbound.some((o) => o.throttled > 0 || (o.requests > 0 && o.errors / o.requests >= 0.05));
  if (outCalls > 0 && !outbad && !flaggedPrefix('throttled-') && !flaggedPrefix('outbound-errors-')) {
    const names = Array.from(new Set(input.outbound.filter((o) => o.requests > 0).map((o) => o.label ?? o.key)));
    out.push({
      id: 'good-external',
      severity: 'ok',
      area: 'externos',
      title: 'Los servicios externos responden bien',
      detail: `${fmt(outCalls)} llamadas sin rechazos ni fallas relevantes: ${names.slice(0, 3).join(', ')}${
        names.length > 3 ? ` y ${names.length - 3} más` : ''
      }.`,
    });
  }

  return out.slice(0, MAX_HIGHLIGHTS);
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
