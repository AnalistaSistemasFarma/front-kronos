import 'server-only';
import dc from 'node:diagnostics_channel';
import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { getPool } from '../mssqlPool';
import { probeDatabase } from './dbProbe';
import { normalizeOutboundHost, normalizeRoutePath } from './routeKey';
import { DurationWindow, hostCpuPercent, round2, RouteAccumulator, UserAccumulator } from './stats';
import {
  deleteOldMetrics,
  insertDbSample,
  insertProcessSample,
  insertRouteSummaries,
  insertUserSummaries,
  isMissingTableError,
  type ProcessSample,
} from './store';
import { sessionTokenFromCookie, UserIdentityCache } from './userIdentity';

/**
 * Colector del Monitor del sistema. Se arranca una vez por proceso desde instrumentation.ts.
 *
 * Cómo mide sin tocar las rutas: Node publica eventos (diagnostics_channel) cada vez que el
 * servidor HTTP recibe/termina una petición y cada vez que `fetch` (undici) o `http` hacen una
 * llamada saliente. Aquí solo se escuchan esos eventos y se acumulan en memoria; cada minuto se
 * guarda UNA fila por proceso y cada 5 minutos el resumen por ruta. El costo por petición es un
 * `performance.now()` y una entrada en un Map.
 *
 * Activación: por defecto solo en producción. En desarrollo hay que poner
 * SYSTEM_METRICS_ENABLED=true (si no, cada máquina de desarrollo escribiría en la base
 * compartida). SYSTEM_METRICS_ENABLED=false lo apaga también en producción.
 *
 * Bajo pm2 cluster cada instancia guarda sus propias filas; la foto de SQL Server, la limpieza
 * de datos viejos y las alertas tempranas solo las hace la instancia 0 (mismo criterio que el
 * scheduler).
 */

const TICK_MS = 60_000;
const ROUTE_FLUSH_EVERY_TICKS = 5;
const DB_PROBE_EVERY_TICKS = 5;
const PAUSE_WHEN_TABLE_MISSING_MS = 10 * 60_000;
const CLEANUP_EVERY_MS = 24 * 60 * 60_000;
const FIRST_CLEANUP_DELAY_MS = 10 * 60_000;

export type SystemMetricsStatus = {
  enabled: boolean;
  startedAt: string | null;
  host: string;
  instance: string;
  pid: number;
  /** Motivo si el guardado está pausado (p. ej. faltan las tablas). */
  pausedReason: string | null;
  lastFlushAt: string | null;
  lastError: string | null;
  /** Falta la tabla de consumo por usuario (script 2026-10-06-system-metrics-usuarios.sql). */
  usersTableMissing: boolean;
  /** Última muestra de ESTE proceso (sirve aunque las tablas no existan). */
  latest: ProcessSample | null;
};

type InboundStart = { t: number; url: string; method: string; sessionToken: string | null };
type OutboundStart = { t: number; host: string };

type CollectorState = {
  status: SystemMetricsStatus;
  timer?: ReturnType<typeof setInterval>;
};

declare global {
  var __kronosSystemMetrics: CollectorState | undefined;
}

export function isSystemMetricsEnabled(): boolean {
  const flag = process.env.SYSTEM_METRICS_ENABLED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function instanceLabel(): string {
  return process.env.NODE_APP_INSTANCE ?? 'unica';
}

function isPrimaryInstance(): boolean {
  const instance = process.env.NODE_APP_INSTANCE;
  return instance === undefined || instance === '0';
}

function retentionDays(): number {
  const n = Number(process.env.SYSTEM_METRICS_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : 14;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

/** Estado del colector de ESTE proceso (para la API). */
export function getSystemMetricsStatus(): SystemMetricsStatus {
  return (
    globalThis.__kronosSystemMetrics?.status ?? {
      enabled: isSystemMetricsEnabled(),
      startedAt: null,
      host: os.hostname(),
      instance: instanceLabel(),
      pid: process.pid,
      pausedReason: null,
      lastFlushAt: null,
      lastError: null,
      usersTableMissing: false,
      latest: null,
    }
  );
}

export function startSystemMetrics(): void {
  if (globalThis.__kronosSystemMetrics) return;

  const status: SystemMetricsStatus = {
    enabled: isSystemMetricsEnabled(),
    startedAt: null,
    host: os.hostname(),
    instance: instanceLabel(),
    pid: process.pid,
    pausedReason: null,
    lastFlushAt: null,
    lastError: null,
    usersTableMissing: false,
    latest: null,
  };
  const state: CollectorState = { status };
  globalThis.__kronosSystemMetrics = state;

  if (!status.enabled) {
    console.log('[system-metrics] Deshabilitado (SYSTEM_METRICS_ENABLED no es true fuera de producción)');
    return;
  }
  status.startedAt = new Date().toISOString();

  const routes = new RouteAccumulator();
  const inbound = new DurationWindow();
  const outbound = new DurationWindow();
  const users = new UserAccumulator();
  const identities = new UserIdentityCache(async (token) => {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) return null;
    const { decode } = await import('next-auth/jwt');
    return (await decode({ token, secret })) as { email?: unknown; name?: unknown } | null;
  });

  // --- Peticiones que ENTRAN a Kronos -------------------------------------------------
  const inboundStarts = new WeakMap<object, InboundStart>();
  dc.subscribe('http.server.request.start', (message) => {
    const { request, response } = message as {
      request: { url?: string; method?: string; headers?: { cookie?: string } };
      response: object;
    };
    inboundStarts.set(response, {
      t: performance.now(),
      url: request?.url ?? '/',
      method: request?.method ?? 'GET',
      sessionToken: sessionTokenFromCookie(request?.headers?.cookie),
    });
  });
  dc.subscribe('http.server.response.finish', (message) => {
    const { response } = message as {
      response: { statusCode?: number; getHeader?: (name: string) => unknown };
    };
    const start = inboundStarts.get(response);
    if (!start) return;
    inboundStarts.delete(response);
    if (start.url.startsWith('/_next/webpack-hmr')) return;

    const info = normalizeRoutePath(start.url);
    const contentType = String(response.getHeader?.('content-type') ?? '');
    // Un stream SSE queda abierto minutos: contarlo, pero no meter su duración en los tiempos.
    const durationMs = contentType.includes('text/event-stream') ? null : performance.now() - start.t;
    const statusCode = response.statusCode ?? 0;
    routes.record({
      direction: 'in',
      key: `${start.method} ${info.path}`,
      module: info.module,
      durationMs,
      status: statusCode,
    });
    inbound.add(durationMs, statusCode);

    // Consumo por usuario: solo peticiones con sesión y que no sean archivos estáticos.
    if (start.sessionToken && info.module !== 'estaticos') {
      const entry = { module: info.module, durationMs, status: statusCode };
      const known = identities.peek(start.sessionToken);
      if (known) users.record({ ...entry, email: known.email, name: known.name });
      else if (known === undefined) {
        void identities.resolve(start.sessionToken).then((user) => {
          if (user) users.record({ ...entry, email: user.email, name: user.name });
        });
      }
    }
  });

  // --- Llamadas que SALEN de Kronos (Graph, Orion, SAP, IA…) ------------------------------
  const outboundStarts = new WeakMap<object, OutboundStart>();
  const finishOutbound = (request: object, statusCode: number) => {
    const start = outboundStarts.get(request);
    if (!start) return;
    outboundStarts.delete(request);
    const durationMs = performance.now() - start.t;
    routes.record({ direction: 'out', key: start.host, module: start.host, durationMs, status: statusCode });
    outbound.add(durationMs, statusCode);
  };

  // fetch() nativo (undici)
  dc.subscribe('undici:request:create', (message) => {
    const { request } = message as { request: { origin?: string } };
    outboundStarts.set(request, { t: performance.now(), host: normalizeOutboundHost(request?.origin) });
  });
  dc.subscribe('undici:request:headers', (message) => {
    const { request, response } = message as { request: object; response: { statusCode?: number } };
    finishOutbound(request, response?.statusCode ?? 0);
  });
  dc.subscribe('undici:request:error', (message) => {
    finishOutbound((message as { request: object }).request, 0);
  });

  // módulo http/https (axios, librerías antiguas, SAP Service Layer)
  dc.subscribe('http.client.request.start', (message) => {
    const { request } = message as {
      request: { host?: string; getHeader?: (name: string) => unknown };
    };
    const hostHeader = request?.getHeader?.('host');
    outboundStarts.set(request, {
      t: performance.now(),
      host: normalizeOutboundHost(null, typeof hostHeader === 'string' ? hostHeader : request?.host),
    });
  });
  dc.subscribe('http.client.response.finish', (message) => {
    const { request, response } = message as { request: object; response: { statusCode?: number } };
    finishOutbound(request, response?.statusCode ?? 0);
  });
  dc.subscribe('http.client.request.error', (message) => {
    finishOutbound((message as { request: object }).request, 0);
  });

  // --- Recursos del proceso y del servidor -------------------------------------------------
  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();

  let prevCpu = process.cpuUsage();
  let prevCpuAt = performance.now();
  let prevHostCpus = os.cpus();
  let tick = 0;
  let routeWindowStart = floorToMinute(new Date());
  let flushing = false;
  let pausedUntil = 0;
  let lastCleanupAt = Date.now() - CLEANUP_EVERY_MS + FIRST_CLEANUP_DELAY_MS;
  let alerting = false;
  let alertsPausedUntil = 0;
  let alertsTableWarned = false;

  // Alertas tempranas (alertJob.ts). Import diferido: trae Prisma y las notificaciones.
  const runAlerts = async (pool: Awaited<ReturnType<typeof getPool>>) => {
    if (alerting || Date.now() < alertsPausedUntil) return;
    alerting = true;
    try {
      const job = await import('./alertJob');
      if (!job.isEarlyWarningEnabled()) {
        alertsPausedUntil = Number.POSITIVE_INFINITY;
        return;
      }
      const { notified } = await job.runEarlyWarnings(pool, status.host, await job.defaultAlertDeps());
      alertsTableWarned = false;
      if (notified.length) {
        console.warn(`[system-metrics] Alertas tempranas enviadas: ${notified.map((w) => w.key).join(', ')}`);
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        alertsPausedUntil = Date.now() + PAUSE_WHEN_TABLE_MISSING_MS;
        if (!alertsTableWarned) {
          console.warn(
            '[system-metrics] Falta la tabla system_metric_alert (prisma/manual/2026-10-07-system-metrics-alertas.sql); alertas en pausa'
          );
        }
        alertsTableWarned = true;
      } else {
        console.warn('[system-metrics] Alertas tempranas:', errorMessage(error));
      }
    } finally {
      alerting = false;
    }
  };

  const collectSample = (): ProcessSample => {
    const now = performance.now();
    const cpu = process.cpuUsage(prevCpu);
    const elapsedMs = Math.max(1, now - prevCpuAt);
    const cores = Math.max(1, os.cpus().length);
    prevCpu = process.cpuUsage();
    prevCpuAt = now;

    const hostCpus = os.cpus();
    const hostCpu = hostCpuPercent(prevHostCpus, hostCpus);
    prevHostCpus = hostCpus;

    const mem = process.memoryUsage();
    const total = os.totalmem();
    const free = os.freemem();

    const p50 = loopDelay.percentile(50) / 1e6;
    const p99 = loopDelay.percentile(99) / 1e6;
    const max = loopDelay.max / 1e6;
    loopDelay.reset();

    const inWindow = inbound.drain();
    const outWindow = outbound.drain();
    const pool = global.__kronosMssqlPool;

    return {
      sampledAt: floorToMinute(new Date()),
      host: status.host,
      instance: status.instance,
      pid: process.pid,
      cpuPct: round2(((cpu.user + cpu.system) / 1000 / elapsedMs / cores) * 100),
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      eventLoopP50Ms: round2(Number.isFinite(p50) ? p50 : 0),
      eventLoopP99Ms: round2(Number.isFinite(p99) ? p99 : 0),
      eventLoopMaxMs: round2(Number.isFinite(max) ? max : 0),
      hostCpuPct: hostCpu,
      hostMemUsedPct: total > 0 ? round2(((total - free) / total) * 100) : 0,
      hostMemTotalMb: Math.round(total / 1048576),
      httpRequests: inWindow.requests,
      httpErrors: inWindow.errors,
      httpP95Ms: inWindow.p95Ms,
      outRequests: outWindow.requests,
      outErrors: outWindow.errors,
      outThrottled: outWindow.throttled,
      poolSize: pool ? pool.size : null,
      poolAvailable: pool ? pool.available : null,
      poolBorrowed: pool ? pool.borrowed : null,
      poolPending: pool ? pool.pending : null,
    };
  };

  const onTick = async () => {
    tick += 1;
    const sample = collectSample();
    status.latest = sample;

    const flushRoutes = tick % ROUTE_FLUSH_EVERY_TICKS === 0;
    // Se vacía siempre (aunque no se pueda guardar) para que la memoria no crezca.
    const routeRows = flushRoutes ? routes.drain() : [];
    const userRows = flushRoutes ? users.drain() : [];
    const routeBucket = routeWindowStart;
    if (flushRoutes) routeWindowStart = floorToMinute(new Date());

    if (flushing || Date.now() < pausedUntil) return;
    flushing = true;
    try {
      const pool = await getPool();
      await insertProcessSample(pool, sample);
      if (routeRows.length) {
        await insertRouteSummaries(pool, routeBucket, status.host, status.instance, routeRows);
      }
      if (userRows.length) {
        try {
          await insertUserSummaries(pool, routeBucket, status.host, status.instance, userRows);
          status.usersTableMissing = false;
        } catch (error) {
          // La tabla de usuarios va en un script aparte: si falta, lo demás se sigue guardando.
          if (!isMissingTableError(error)) throw error;
          if (!status.usersTableMissing) {
            console.warn('[system-metrics] Falta la tabla system_metric_user (prisma/manual/2026-10-06-system-metrics-usuarios.sql)');
          }
          status.usersTableMissing = true;
        }
      }
      if (isPrimaryInstance() && tick % DB_PROBE_EVERY_TICKS === 1) {
        const db = await probeDatabase(pool);
        await insertDbSample(pool, sample.sampledAt, db);
      }
      if (isPrimaryInstance() && Date.now() - lastCleanupAt >= CLEANUP_EVERY_MS) {
        lastCleanupAt = Date.now();
        const deleted = await deleteOldMetrics(pool, retentionDays());
        if (deleted > 0) console.log(`[system-metrics] Limpieza: ${deleted} filas de más de ${retentionDays()} días`);
      }
      status.lastFlushAt = new Date().toISOString();
      status.pausedReason = null;
      status.lastError = null;
      if (isPrimaryInstance()) void runAlerts(pool);
    } catch (error) {
      if (isMissingTableError(error)) {
        pausedUntil = Date.now() + PAUSE_WHEN_TABLE_MISSING_MS;
        if (!status.pausedReason) {
          console.warn(
            '[system-metrics] Faltan las tablas (prisma/manual/2026-10-05-system-metrics.sql); reintento en 10 min'
          );
        }
        status.pausedReason = 'Faltan las tablas del monitor en la base de datos';
      } else {
        status.lastError = errorMessage(error);
        console.warn('[system-metrics] No se pudo guardar la muestra:', status.lastError);
      }
    } finally {
      flushing = false;
    }
  };

  state.timer = setInterval(() => {
    void onTick();
  }, TICK_MS);
  state.timer.unref?.();

  console.log(
    `[system-metrics] Iniciado (host ${status.host}, instancia ${status.instance}, pid ${process.pid})`
  );
}

function floorToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}
