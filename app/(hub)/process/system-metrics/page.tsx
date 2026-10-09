'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Breadcrumbs,
  Code,
  Group,
  Loader,
  SegmentedControl,
  Switch,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconChevronRight,
  IconClockHour4,
  IconCloud,
  IconDatabase,
  IconGauge,
  IconInfoCircle,
  IconLayoutDashboard,
  IconRefresh,
  IconTopologyStar3,
  IconUsers,
} from '@tabler/icons-react';
import {
  buildInsights,
  mainTableOf,
  verdictFrom,
  type Insight,
  type Severity,
} from '../../../../lib/system-metrics/insights';
import { DetailSheet } from '../../../../components/system-metrics/DetailSheet';
import { EarlyWarnings } from '../../../../components/system-metrics/EarlyWarnings';
import { MetricLineChart, type LineSeries } from '../../../../components/system-metrics/MetricLineChart';
import { OverviewMap } from '../../../../components/system-metrics/OverviewMap';
import type { SystemOverview } from '../../../../lib/system-metrics/overviewModel';
import { ResourceRings, type RingSpec } from '../../../../components/system-metrics/ResourceRings';
import { ServerTime } from '../../../../components/system-metrics/ServerTime';
import { SignalTile } from '../../../../components/system-metrics/SignalTile';
import { StatusHero, ToneChip } from '../../../../components/system-metrics/StatusHero';
import { SystemMap, type MapData } from '../../../../components/system-metrics/SystemMap';
import { UserBehavior } from '../../../../components/system-metrics/UserBehavior';
import { AlertSubscriptionSwitch } from '../../../../components/system-metrics/AlertSubscriptionSwitch';
import { MonitorBoard } from '../../../../components/system-metrics/MonitorBoard';
import { UserConsumption } from '../../../../components/system-metrics/UserConsumption';
import type { StatusTone } from '../../../../components/system-metrics/colors';
import {
  formatAgo,
  formatBucket,
  formatDateTime,
  formatInt,
  formatMs,
  formatValue,
  percentChange,
  programLabel,
} from '../../../../components/system-metrics/format';
import {
  BUCKET_MINUTES,
  RANGE_MINUTES,
  RANGE_OPTIONS,
  type DbLive,
  type DetailTarget,
  type MetricsResponse,
  type ProcessSeriesRow,
  type RangeKey,
} from '../../../../components/system-metrics/types';
import styles from '../../../../components/system-metrics/monitor.module.css';

/**
 * Monitor del sistema: qué está pasando con SynerLink (Kronos), su servidor y SQL Server.
 *
 * Arriba, siempre visible, el veredicto en una frase + hallazgos (lib/system-metrics/insights.ts).
 * Debajo, pestañas para no hacer una página eterna: Resumen (alertas, señales, saturación),
 * Mapas (vista general + detalle de este Kronos), Usuarios, Rendimiento (tiempo de servidor,
 * rutas, tendencias), Base de datos y Servicios externos. La pestaña va en el # de la URL.
 *
 * Datos: /api/system-metrics (histórico del colector), /api/system-metrics/db-live (foto de
 * SQL Server) y /api/system-metrics/route-series (hoja de detalle). Módulo restringido
 * (subproceso '/process/system-metrics').
 */

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

type TabKey = 'resumen' | 'mapas' | 'usuarios' | 'rendimiento' | 'base' | 'externos';
const TAB_KEYS: TabKey[] = ['resumen', 'mapas', 'usuarios', 'rendimiento', 'base', 'externos'];
/** Enlaces viejos (p. ej. las notificaciones abren #alertas) a su pestaña. */
const HASH_ALIASES: Record<string, TabKey> = { alertas: 'resumen', 'vista-general': 'mapas', 'base-de-datos': 'base' };

function tabFromHash(hash: string): TabKey | null {
  const key = hash.replace(/^#/, '');
  return (TAB_KEYS as string[]).includes(key) ? (key as TabKey) : HASH_ALIASES[key] ?? null;
}

function worstTone(insights: Insight[], fallback: StatusTone = 'ok'): StatusTone {
  const relevant = insights.filter((i) => i.severity === 'critical' || i.severity === 'warning');
  if (!relevant.length) return fallback;
  return relevant.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0].severity as StatusTone;
}

function instanceName(instance: string, host: string, multiHost: boolean): string {
  const base = instance === 'unica' ? 'Kronos' : `Kronos #${instance}`;
  return multiHost ? `${base} · ${host}` : base;
}

/** Series alineadas al mismo eje de tiempo para las gráficas de tendencia. */
function useProcessCharts(rows: ProcessSeriesRow[], range: RangeKey) {
  return useMemo(() => {
    const buckets = Array.from(new Set(rows.map((r) => r.bucket))).sort();
    const bucketIndex = new Map(buckets.map((b, i) => [b, i]));
    const labels = buckets.map((b) => formatBucket(b, range));
    const hosts = Array.from(new Set(rows.map((r) => r.host))).sort();
    const instances = Array.from(new Set(rows.map((r) => `${r.host}|${r.instance}`))).sort();
    const multiHost = hosts.length > 1;
    const empty = () => buckets.map(() => null as number | null);

    const perInstance = (pick: (r: ProcessSeriesRow) => number | null, offset = 0): LineSeries[] =>
      instances.map((key, i) => {
        const [host, instance] = key.split('|');
        const values = empty();
        for (const r of rows) {
          if (`${r.host}|${r.instance}` === key) values[bucketIndex.get(r.bucket)!] = pick(r);
        }
        return { label: instanceName(instance, host, multiHost), colorIndex: offset + i, values };
      });

    const perHostAvg = (pick: (r: ProcessSeriesRow) => number | null): LineSeries[] =>
      hosts.map((host, i) => {
        const sums = buckets.map(() => ({ total: 0, n: 0 }));
        for (const r of rows) {
          const v = pick(r);
          if (r.host !== host || v == null) continue;
          const s = sums[bucketIndex.get(r.bucket)!];
          s.total += v;
          s.n += 1;
        }
        return {
          label: multiHost ? `Servidor ${host}` : 'Servidor (total)',
          colorIndex: i,
          values: sums.map((s) => (s.n ? Math.round((s.total / s.n) * 10) / 10 : null)),
        };
      });

    const totals = (pick: (r: ProcessSeriesRow) => number | null, agg: 'sum' | 'max', perMinute = false) => {
      const values = empty();
      for (const r of rows) {
        const v = pick(r);
        if (v == null) continue;
        const i = bucketIndex.get(r.bucket)!;
        const current = values[i];
        values[i] = current == null ? v : agg === 'sum' ? current + v : Math.max(current, v);
      }
      if (!perMinute) return values;
      return values.map((v) => (v == null ? null : Math.round((v / BUCKET_MINUTES[range]) * 10) / 10));
    };

    const requests = totals((r) => r.httpRequests, 'sum');
    const errors = totals((r) => r.httpErrors, 'sum');
    const errorPct = requests.map((req, i) =>
      req == null || req === 0 ? null : Math.round((((errors[i] ?? 0) / req) * 100) * 100) / 100
    );
    const hostCpu = perHostAvg((r) => r.hostCpuPct);

    return {
      labels,
      bucketCount: buckets.length,
      multiHost,
      cpu: [...hostCpu, ...perInstance((r) => r.cpuPct, hosts.length)],
      hostCpuTrend: hostCpu[0]?.values ?? [],
      hostMem: perHostAvg((r) => r.hostMemUsedPct),
      rss: perInstance((r) => r.rssMb),
      eventLoop: perInstance((r) => r.eventLoopP99Ms),
      trafficPerMin: totals((r) => r.httpRequests, 'sum', true),
      errorPct,
      p95: totals((r) => r.httpP95Ms, 'max'),
      pool: [
        { label: 'Conexiones en uso', colorIndex: 0, values: totals((r) => r.poolBorrowed, 'sum') },
        { label: 'Peticiones esperando conexión', colorIndex: 1, values: totals((r) => r.poolPending, 'sum') },
      ] as LineSeries[],
      outbound: [
        { label: 'Llamadas externas', colorIndex: 0, values: totals((r) => r.outRequests, 'sum', true) },
        { label: 'Limitadas (429)', colorIndex: 1, values: totals((r) => r.outThrottled, 'sum', true) },
        { label: 'Fallidas', colorIndex: 2, values: totals((r) => r.outErrors, 'sum', true) },
      ] as LineSeries[],
    };
  }, [rows, range]);
}

export default function SystemMetricsPage() {
  const { data: session } = useSession();

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [range, setRange] = useState<RangeKey>('6h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [dbLive, setDbLive] = useState<DbLive | null>(null);
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [, setClock] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/system-metrics/access');
        if (!res.ok) throw new Error('No se pudo verificar el acceso al módulo');
        const data = await res.json();
        if (!cancelled) setHasAccess(Boolean(data.canAccess));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error inesperado');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const loadMetrics = useCallback(async (selectedRange: RangeKey) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/system-metrics?range=${selectedRange}`, { signal: controller.signal });
      if (!res.ok) throw new Error('No se pudieron cargar las métricas');
      setMetrics(await res.json());
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      if (abortRef.current === controller) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  const loadDbLive = useCallback(async () => {
    setDbLoading(true);
    try {
      const res = await fetch('/api/system-metrics/db-live');
      if (!res.ok) throw new Error('No se pudo consultar SQL Server');
      setDbLive(await res.json());
      setDbError(null);
    } catch (err) {
      setDbError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setDbLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAccess) {
      if (hasAccess === false) setLoading(false);
      return;
    }
    void loadMetrics(range);
  }, [hasAccess, range, loadMetrics]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await fetch('/api/system-metrics/overview');
      if (!res.ok) throw new Error('No se pudo armar la vista general');
      setOverview(await res.json());
      setOverviewError(null);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAccess) return;
    void loadDbLive();
    void loadOverview();
  }, [hasAccess, loadDbLive, loadOverview]);

  useEffect(() => {
    if (!hasAccess || !autoRefresh) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadMetrics(range);
      void loadDbLive();
      void loadOverview();
    }, 60_000);
    return () => clearInterval(id);
  }, [hasAccess, autoRefresh, range, loadMetrics, loadDbLive, loadOverview]);

  // Refresca el "hace X s" del encabezado.
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const fromHash = tabFromHash(window.location.hash);
    if (fromHash) setTab(fromHash);
  }, []);

  const changeTab = useCallback((value: string | null) => {
    const next = tabFromHash(value ?? '') ?? 'resumen';
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  }, []);

  // Las notificaciones de alertas abren /process/system-metrics#alertas, pero la sección solo
  // existe cuando llegan los datos: el salto nativo del navegador ya pasó.
  const scrolledToHashRef = useRef(false);
  useEffect(() => {
    if (!metrics || scrolledToHashRef.current || window.location.hash !== '#alertas') return;
    scrolledToHashRef.current = true;
    requestAnimationFrame(() => document.getElementById('alertas')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [metrics]);

  const rangeOption = RANGE_OPTIONS.find((r) => r.value === range) ?? RANGE_OPTIONS[1];
  const rangeLong = rangeOption.long;
  const processRows = useMemo(() => metrics?.processSeries ?? [], [metrics]);
  const dbRows = useMemo(() => metrics?.db ?? [], [metrics]);
  const charts = useProcessCharts(processRows, range);
  const hasData = processRows.length > 0;
  const observedMinutes = Math.max(1, charts.bucketCount * BUCKET_MINUTES[range]);

  const insights = useMemo(
    () =>
      buildInsights({
        rangeLabel: rangeOption.span,
        summary: metrics?.summary ?? null,
        processSeries: processRows,
        db: dbRows,
        outbound: metrics?.outbound ?? [],
        dbLive,
        lifetimes: metrics?.lifetimes ?? [],
      }),
    [metrics, processRows, dbRows, dbLive, rangeOption.span]
  );
  const verdict = useMemo(() => verdictFrom(insights, hasData), [insights, hasData]);

  const latest = useMemo(() => {
    const lastBucket = processRows.length ? processRows[processRows.length - 1].bucket : null;
    return processRows.filter((r) => r.bucket === lastBucket);
  }, [processRows]);

  const lastDb = dbRows.length ? dbRows[dbRows.length - 1] : null;
  const cur = metrics?.summary?.current;
  const prev = metrics?.summary?.previous;
  const hasPrev = (prev?.samples ?? 0) > 0;

  const signals = useMemo(() => {
    const trafficValues = charts.trafficPerMin.filter((v): v is number => v != null);
    const reqPerMin = trafficValues.length ? trafficValues.reduce((a, b) => a + b, 0) / trafficValues.length : null;
    const errPct = cur && cur.requests ? (cur.errors / cur.requests) * 100 : null;
    const prevErrPct = prev && prev.requests ? (prev.errors / prev.requests) * 100 : null;
    return {
      reqPerMin,
      trafficChange: hasPrev ? percentChange(cur?.requests, prev?.requests) : null,
      p95: cur?.p95Ms ?? null,
      p95Change: hasPrev ? percentChange(cur?.p95Ms, prev?.p95Ms) : null,
      errPct,
      errChange: hasPrev ? percentChange(errPct, prevErrPct) : null,
      cpu: cur?.hostCpuPct ?? null,
      cpuChange: hasPrev ? percentChange(cur?.hostCpuPct, prev?.hostCpuPct) : null,
    };
  }, [charts.trafficPerMin, cur, prev, hasPrev]);

  const mapData = useMemo<MapData>(() => {
    const multiHost = new Set(processRows.map((r) => r.host)).size > 1;
    const hostLevel = insights.filter((i) => i.id === 'host-cpu' || i.id === 'host-mem');
    const requestsByInstance = new Map<string, number>();
    for (const r of processRows) {
      const key = `${r.host}|${r.instance}`;
      requestsByInstance.set(key, (requestsByInstance.get(key) ?? 0) + r.httpRequests);
    }
    const instances = latest.map((r) => {
      const key = `${r.host}|${r.instance}`;
      const own = insights.filter((i) => i.id.endsWith(key));
      return {
        key,
        name: instanceName(r.instance, r.host, multiHost),
        cpuPct: r.cpuPct,
        rssMb: r.rssMb,
        eventLoopMs: r.eventLoopP99Ms,
        reqPerMin: (requestsByInstance.get(key) ?? 0) / observedMinutes,
        sqlInUse: r.poolBorrowed,
        tone: worstTone([...own, ...hostLevel]),
      };
    });

    // Otras aplicaciones conectadas al mismo SQL Server (se excluyen las conexiones de Kronos).
    // Kronos = sus librerías (mssql / Prisma) conectadas a SU base desde su servidor. Otras apps
    // Node del mismo servidor (p. ej. SAPSEND) usan otras bases y quedan como "otras".
    const kronosHosts = new Set(processRows.map((r) => r.host.toLowerCase()));
    const kronosDb = dbLive?.databaseName ?? null;
    const NODE_PROGRAMS = new Set(['tiberius', 'node-mssql', 'tedious']);
    const isKronos = (o: { hostName: string; programName: string; databaseName: string }) => {
      if (!NODE_PROGRAMS.has(o.programName) || !kronosDb || o.databaseName !== kronosDb) return false;
      const host = o.hostName.toLowerCase();
      if (o.programName === 'tiberius') return !host || host === '(sin nombre)' || kronosHosts.has(host);
      return kronosHosts.has(host);
    };
    const otherAppLabel = (program: string) => {
      if (program === 'tiberius') return 'Aplicación con Prisma';
      if (program === 'node-mssql' || program === 'tedious') return 'Aplicación Node.js';
      if (!program || program === '(sin nombre)') return 'Programa sin nombre';
      return programLabel(program);
    };
    const snapshotAt = dbLive?.cachedAt ? new Date(dbLive.cachedAt).getTime() : Date.now();
    const appMap = new Map<string, MapData['apps'][number]>();
    for (const o of dbLive?.origins ?? []) {
      if (isKronos(o)) continue;
      const label = otherAppLabel(o.programName);
      const key = `${label}|${o.hostName}`;
      const app = appMap.get(key) ?? {
        key,
        label,
        host: o.hostName === "(sin nombre)" || !o.hostName ? "máquina sin nombre" : o.hostName,
        logins: [],
        databases: [],
        sessions: 0,
        running: 0,
        cpuMs: 0,
        lastActivity: null,
        active: false,
      };
      app.sessions += o.sessions;
      app.running += o.running;
      app.cpuMs += o.cpuMs;
      if (o.loginName && !app.logins.includes(o.loginName)) app.logins.push(o.loginName);
      if (o.databaseName && !app.databases.includes(o.databaseName)) app.databases.push(o.databaseName);
      if (o.lastActivity && (!app.lastActivity || o.lastActivity > app.lastActivity)) app.lastActivity = o.lastActivity;
      appMap.set(key, app);
    }
    const allApps = Array.from(appMap.values()).map((a) => ({
      ...a,
      // Activa: consultas corriendo ahora o algo terminado en los últimos 2 minutos.
      active: a.running > 0 || (a.lastActivity != null && snapshotAt - new Date(a.lastActivity).getTime() < 2 * 60_000),
    }));
    allApps.sort((a, b) => Number(b.active) - Number(a.active) || b.sessions - a.sessions);
    const MAX_APPS = 8;

    const byLabel = new Map<string, MapData['externals'][number]>();
    for (const o of metrics?.outbound ?? []) {
      const label = o.label ?? o.key;
      const curExt = byLabel.get(label) ?? {
        key: o.key,
        label,
        callsPerMin: 0,
        p95Ms: 0,
        throttled: 0,
        errors: 0,
        tone: 'ok' as StatusTone,
      };
      curExt.callsPerMin += o.requests / observedMinutes;
      curExt.p95Ms = Math.max(curExt.p95Ms, o.p95Ms);
      curExt.throttled += o.throttled;
      curExt.errors += o.errors;
      curExt.tone = worstTone(insights.filter((i) => i.area === 'externos' && i.id.endsWith(o.key)), curExt.tone);
      byLabel.set(label, curExt);
    }
    const externals = Array.from(byLabel.values())
      .sort((a, b) => b.callsPerMin - a.callsPerMin)
      .slice(0, 4);

    const poolInUse = latest.length ? latest.reduce((acc, r) => acc + (r.poolBorrowed ?? 0), 0) : null;
    return {
      users: {
        reqPerMin: signals.reqPerMin,
        p95Ms: signals.p95,
        tone: hasData ? worstTone(insights.filter((i) => i.area === 'trafico')) : 'idle',
        activeNow: metrics?.activeUsers?.activeNow ?? null,
        top: (metrics?.users ?? []).slice(0, 5).map((u) => ({ email: u.email, name: u.name })),
      },
      apps: allApps.slice(0, MAX_APPS),
      moreApps: Math.max(0, allApps.length - MAX_APPS),
      instances,
      sql: {
        tone: lastDb || dbLive ? worstTone(insights.filter((i) => i.area === 'base')) : 'idle',
        database: dbLive?.databaseName ?? null,
        reason: insights.find((i) => i.area === 'base' && i.severity !== 'ok')?.title ?? null,
        // La misma lectura en vivo que muestra la Vista general; la guardada es de hace hasta 5 min.
        cpuPct: overview?.sqlServer.sqlCpuPct ?? lastDb?.sqlCpuPct ?? null,
        sessions: lastDb?.dbSessions ?? null,
        blocked: lastDb?.blockedRequests ?? null,
        poolInUse,
        hasServerState: lastDb?.hasServerState ?? dbLive?.hasServerState ?? null,
      },
      externals,
    };
  }, [processRows, latest, insights, metrics, observedMinutes, signals, hasData, lastDb, dbLive, overview]);

  const rings = useMemo<RingSpec[]>(() => {
    const avg = (vals: Array<number | null>) => {
      const nums = vals.filter((v): v is number => v != null);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    };
    const borrowed = latest.reduce((acc, r) => acc + (r.poolBorrowed ?? 0), 0);
    const size = latest.reduce((acc, r) => acc + (r.poolSize ?? 0), 0);
    const kronosCpu = latest.reduce((acc, r) => acc + (r.cpuPct ?? 0), 0);
    const kronosRam = latest.reduce((acc, r) => acc + (r.rssMb ?? 0), 0);
    return [
      {
        key: 'cpu',
        label: 'CPU del servidor',
        percent: avg(latest.map((r) => r.hostCpuPct)),
        sub: latest.length ? `Kronos ${formatValue(kronosCpu)} %` : 'sin dato',
        warning: 60,
        critical: 85,
      },
      {
        key: 'ram',
        label: 'Memoria del servidor',
        percent: avg(latest.map((r) => r.hostMemUsedPct)),
        sub: latest.length ? `Kronos ${formatInt(kronosRam)} MB` : 'sin dato',
        warning: 75,
        critical: 90,
      },
      {
        key: 'pool',
        label: 'Conexiones SQL',
        percent: size > 0 ? (borrowed / size) * 100 : null,
        sub: size > 0 ? `${formatInt(borrowed)} de ${formatInt(size)} en uso` : 'pool sin abrir',
        warning: 70,
        critical: 90,
      },
      {
        key: 'sql',
        label: 'CPU de SQL Server',
        percent: lastDb?.sqlCpuPct ?? null,
        sub: lastDb?.hasServerState === false || dbLive?.hasServerState === false ? 'sin permiso' : 'último dato',
        warning: 60,
        critical: 85,
      },
    ];
  }, [latest, lastDb, dbLive]);

  const connectionsByProgram = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of dbLive?.connections ?? []) {
      const label = programLabel(c.programName);
      map.set(label, (map.get(label) ?? 0) + c.sessions);
    }
    return Array.from(map.entries())
      .map(([label, sessions]) => ({ label, sessions }))
      .sort((a, b) => b.sessions - a.sessions);
  }, [dbLive]);
  const totalSessions = connectionsByProgram.reduce((acc, c) => acc + c.sessions, 0);

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Monitor del sistema', href: '#' },
  ].map((item, index) =>
    item.href !== '#' ? (
      <Link key={index} href={item.href} passHref>
        <Anchor component="span" size="sm">
          {item.title}
        </Anchor>
      </Link>
    ) : (
      <Text key={index} component="span" size="sm" c="dimmed">
        {item.title}
      </Text>
    )
  );

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (hasAccess === false) {
    return (
      <Alert color="red" title="Monitor del sistema" mt="md">
        No tiene acceso a este módulo.
      </Alert>
    );
  }

  const status = metrics?.status;
  const dbTone = worstTone(insights.filter((i) => i.area === 'base'));
  const inbound = metrics?.inbound ?? [];
  const outbound = metrics?.outbound ?? [];
  const visibleRoutes = showAllRoutes ? inbound : inbound.slice(0, 8);
  const live = autoRefresh && status?.enabled;

  return (
    <div className={styles.root}>
      <div className={styles.container}>
        <Breadcrumbs separator={<IconChevronRight size={14} />} mb="sm">
          {breadcrumbItems}
        </Breadcrumbs>

        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>
              <span className={`${styles.liveDot} ${live ? '' : styles.liveDotOff}`} aria-hidden />
              {live ? 'En vivo' : 'Pausado'} · actualizado {formatAgo(loadedAt)}
              {status ? ` · ${status.host}` : ''}
            </div>
            <h1 className={styles.largeTitle}>Monitor del sistema</h1>
          </div>
          <div className={styles.headerControls}>
            <SegmentedControl
              radius="xl"
              value={range}
              onChange={(v) => setRange(v as RangeKey)}
              data={RANGE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
              aria-label="Rango de tiempo"
            />
            <Switch
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
              label="En vivo"
              size="sm"
            />
            <Tooltip label="Actualizar ahora">
              <ActionIcon
                variant="light"
                radius="xl"
                size="lg"
                loading={refreshing}
                onClick={() => {
                  void loadMetrics(range);
                  void loadDbLive();
                  void loadOverview();
                }}
                aria-label="Actualizar ahora"
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </div>
        </header>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="md" radius="lg">
            {error}
          </Alert>
        )}
        {metrics?.tablesMissing && (
          <Alert color="yellow" icon={<IconDatabase size={16} />} title="Faltan las tablas del monitor" mb="md" radius="lg">
            Hay que correr <Code>prisma/manual/2026-10-05-system-metrics.sql</Code> en esta base. Mientras tanto no se guarda
            nada.
          </Alert>
        )}
        {status && !status.enabled && (
          <Alert color="gray" icon={<IconInfoCircle size={16} />} title="El colector está apagado en este proceso" mb="md" radius="lg">
            Solo corre en producción. Para probarlo en desarrollo agregue <Code>SYSTEM_METRICS_ENABLED=true</Code> en su{' '}
            <Code>.env.local</Code> y reinicie <Code>npm run dev</Code>.
          </Alert>
        )}
        {status?.lastError && (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="El último guardado falló" mb="md" radius="lg">
            {status.lastError}
          </Alert>
        )}

        <StatusHero verdict={verdict} insights={insights} hasData={hasData} />

        <Tabs value={tab} onChange={changeTab} keepMounted={false} variant="pills" radius="xl" className={styles.tabs}>
          <Tabs.List className={styles.tabList} aria-label="Secciones del monitor">
            <Tabs.Tab value="resumen" leftSection={<IconLayoutDashboard size={16} />}>
              Resumen
            </Tabs.Tab>
            <Tabs.Tab value="mapas" leftSection={<IconTopologyStar3 size={16} />}>
              Mapas
            </Tabs.Tab>
            <Tabs.Tab value="usuarios" leftSection={<IconUsers size={16} />}>
              Usuarios
            </Tabs.Tab>
            <Tabs.Tab value="rendimiento" leftSection={<IconGauge size={16} />}>
              Rendimiento
            </Tabs.Tab>
            <Tabs.Tab
              value="base"
              leftSection={<IconDatabase size={16} />}
              rightSection={dbTone !== 'ok' ? <span className={`${styles.tabDot} ${styles[`tone-${dbTone}`]}`} aria-label={`Base de datos: ${dbTone === 'critical' ? 'crítico' : 'atención'}`} /> : null}
            >
              Base de datos
            </Tabs.Tab>
            {outbound.length > 0 && (
              <Tabs.Tab value="externos" leftSection={<IconCloud size={16} />}>
                Servicios externos
              </Tabs.Tab>
            )}
          </Tabs.List>

        <Tabs.Panel value="resumen">
        {metrics && !metrics.tablesMissing && (
          <section id="alertas" className={styles.section} aria-labelledby="sm-alerts">
            <div className={styles.sectionHeader}>
              <h2 id="sm-alerts" className={styles.sectionTitle}>
                Alertas tempranas
              </h2>
              <AlertSubscriptionSwitch />
            </div>
            <EarlyWarnings
              alerts={metrics.alerts ?? []}
              tableMissing={Boolean(metrics.alertsTableMissing)}
              historyHours={metrics.alertHistoryHours ?? 48}
            />
          </section>
        )}

        <section className={styles.section} aria-labelledby="sm-signals">
          <div className={styles.sectionHeader}>
            <h2 id="sm-signals" className={styles.sectionTitle}>
              Señales clave
            </h2>
            <span className={styles.sectionHint}>{rangeLong} contra el periodo anterior</span>
          </div>
          <div className={styles.grid4}>
            <SignalTile
              icon={<IconActivity size={15} />}
              label="Tráfico"
              value={signals.reqPerMin == null ? '–' : formatValue(signals.reqPerMin)}
              unit="pet./min"
              change={signals.trafficChange}
              polarity="neutral"
              trend={charts.trafficPerMin}
              foot={cur ? `${formatInt(cur.requests)} en total` : undefined}
            />
            <SignalTile
              icon={<IconClockHour4 size={15} />}
              label="Tiempo de respuesta p95"
              value={signals.p95 == null ? '–' : formatMs(signals.p95)}
              change={signals.p95Change}
              polarity="up-is-bad"
              trend={charts.p95}
            />
            <SignalTile
              icon={<IconAlertTriangle size={15} />}
              label="Errores del servidor"
              value={signals.errPct == null ? '–' : `${formatValue(signals.errPct, 2)}`}
              unit="%"
              change={signals.errChange}
              polarity="up-is-bad"
              trend={charts.errorPct}
              foot={cur ? `${formatInt(cur.errors)} respuestas 5xx` : undefined}
            />
            <SignalTile
              icon={<IconGauge size={15} />}
              label="CPU del servidor"
              value={signals.cpu == null ? '–' : formatValue(signals.cpu)}
              unit="%"
              change={signals.cpuChange}
              polarity="up-is-bad"
              trend={charts.hostCpuTrend}
              foot="promedio del rango"
            />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="sm-rings">
          <div className={styles.sectionHeader}>
            <h2 id="sm-rings" className={styles.sectionTitle}>
              Qué tan lleno está cada recurso
            </h2>
            <span className={styles.sectionHint}>Último minuto registrado</span>
          </div>
          <div className={styles.card}>
            <ResourceRings rings={rings} />
          </div>
        </section>
        </Tabs.Panel>

        <Tabs.Panel value="mapas">
        <section id="vista-general" className={styles.section} aria-labelledby="sm-overview">
          <div className={styles.sectionHeader}>
            <h2 id="sm-overview" className={styles.sectionTitle}>
              Vista general
            </h2>
            <Group gap={6}>
              <span className={styles.sectionHint}>
                Kronos en cada entorno, Orion y las demás aplicaciones del SQL Server compartido
                {overview ? ` · foto ${formatAgo(overview.generatedAt)}` : ''}
              </span>
              <ActionIcon
                variant="subtle"
                radius="xl"
                loading={overviewLoading}
                onClick={() => void loadOverview()}
                aria-label="Actualizar la vista general"
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Group>
          </div>
          {overviewError && !overview && (
            <Alert color="orange" icon={<IconAlertTriangle size={16} />} radius="lg">
              {overviewError}
            </Alert>
          )}
          {!overview && !overviewError && (
            <div className={styles.card}>
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Recorriendo las bases de datos…
                </Text>
              </Group>
            </div>
          )}
          {overview && (
            <>
              <p className={styles.cardHint} style={{ margin: '0 4px 10px' }}>
                Personas → aplicaciones → máquinas desde donde se conectan → SQL Server. Cada Kronos muestra el estado de
                su propia base; el nodo SQL Server, el del servidor completo (CPU, memoria y discos).
              </p>
              {/* Cada mapa en su propio tablero: se arrastra, se acerca y se puede ampliar. */}
              <MonitorBoard>
                <OverviewMap data={overview} />
              </MonitorBoard>
            </>
          )}
        </section>

        <section className={styles.section} aria-labelledby="sm-map">
          <div className={styles.sectionHeader}>
            <h2 id="sm-map" className={styles.sectionTitle}>
              Detalle de este Kronos
            </h2>
            <span className={styles.sectionHint}>
              {dbLive?.databaseName ? `${dbLive.databaseName} · ` : ''}toque un servicio externo para ver su historia
            </span>
          </div>
          <p className={styles.cardHint} style={{ margin: '0 4px 10px' }}>
            Personas → procesos de Kronos → su base de datos y servicios externos, y las otras aplicaciones que comparten el
            mismo SQL Server. Es la misma tarjeta {dbLive?.databaseName ? `"${dbLive.databaseName}"` : 'de este Kronos'} de la
            vista general, abierta en detalle.
          </p>
          <MonitorBoard>
            <SystemMap
              data={mapData}
              onSelectExternal={(key, label) => setDetail({ kind: 'route', direction: 'out', key, title: label })}
            />
          </MonitorBoard>
        </section>
        </Tabs.Panel>

        <Tabs.Panel value="usuarios">
        <section className={styles.section} aria-labelledby="sm-users">
          <div className={styles.sectionHeader}>
            <h2 id="sm-users" className={styles.sectionTitle}>
              Usuarios
            </h2>
            <span className={styles.sectionHint}>Quién está usando Kronos y cuánto servidor consume cada persona</span>
          </div>
          {metrics?.usersTableMissing ? (
            <Alert color="yellow" icon={<IconDatabase size={16} />} title="Falta la tabla de consumo por usuario" radius="lg">
              Hay que correr <Code>prisma/manual/2026-10-06-system-metrics-usuarios.sql</Code> en esta base. El resto del
              monitor funciona normal.
            </Alert>
          ) : (
            <>
              <UserConsumption
                users={metrics?.users ?? []}
                activeUsers={metrics?.activeUsers ?? null}
                rangeSpan={rangeOption.span}
              />
              <div className={styles.card} style={{ marginTop: 16 }}>
                <h3 className={styles.cardTitle}>Comportamiento</h3>
                <p className={styles.cardHint}>A qué módulos va el tiempo de servidor de cada persona</p>
                <UserBehavior users={metrics?.users ?? []} rangeMinutes={RANGE_MINUTES[range]} />
              </div>
            </>
          )}
        </section>

        </Tabs.Panel>

        <Tabs.Panel value="rendimiento">
        <section className={styles.section} aria-labelledby="sm-time">
          <div className={styles.sectionHeader}>
            <h2 id="sm-time" className={styles.sectionTitle}>
              Tiempo de servidor
            </h2>
            <span className={styles.sectionHint}>Qué módulo ocupa al servidor y a qué hora</span>
          </div>
          <div className={styles.card}>
            <ServerTime
              modules={metrics?.modules ?? []}
              series={metrics?.moduleSeries ?? []}
              range={range}
              onSelectModule={(label) => setDetail({ kind: 'module', label })}
            />
          </div>
        </section>

        {inbound.length > 0 && (
          <section className={styles.section} aria-labelledby="sm-routes">
            <div className={styles.sectionHeader}>
              <h2 id="sm-routes" className={styles.sectionTitle}>
                Rutas más pesadas
              </h2>
              <span className={styles.sectionHint}>Por tiempo total de servidor · p95 aproximado</span>
            </div>
            <div className={styles.list}>
              {visibleRoutes.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={styles.listRowButton}
                  onClick={() => setDetail({ kind: 'route', direction: 'in', key: r.key, title: r.key })}
                >
                  <span style={{ minWidth: 0 }}>
                    <div className={`${styles.rowTitle} ${styles.rowMono}`}>{r.key}</div>
                    <div className={styles.rowSub}>
                      {r.moduleLabel ?? r.module} · {formatInt(r.requests)} peticiones · promedio {formatMs(r.avgMs)}
                      {r.errors > 0 ? ` · ${formatInt(r.errors)} errores` : ''}
                    </div>
                  </span>
                  <span className={styles.rowMetric}>
                    {formatMs(r.totalMs)}
                    <div className={styles.rowMetricSub}>p95 {formatMs(r.p95Ms)}</div>
                  </span>
                  <IconChevronRight size={16} className={styles.chevron} />
                </button>
              ))}
              {inbound.length > 8 && (
                <button type="button" className={styles.linkButton} onClick={() => setShowAllRoutes((v) => !v)}>
                  {showAllRoutes ? 'Ver menos' : `Ver las ${inbound.length} rutas`}
                </button>
              )}
            </div>
          </section>
        )}

        {hasData && (
          <section className={styles.section} aria-labelledby="sm-trends">
            <div className={styles.sectionHeader}>
              <h2 id="sm-trends" className={styles.sectionTitle}>
                Tendencias
              </h2>
              <span className={styles.sectionHint}>
                <IconBolt size={13} style={{ verticalAlign: '-2px' }} /> Evidencia detrás de cada hallazgo
              </span>
            </div>
            <div className={styles.grid2}>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>CPU</h3>
                <p className={styles.cardHint}>Uso total del servidor y la parte de cada proceso de Kronos</p>
                <MetricLineChart labels={charts.labels} series={charts.cpu} unit="%" suggestedMax={100} height={210} />
              </div>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Memoria de Kronos</h3>
                <p className={styles.cardHint}>Si solo sube y nunca baja, hay una fuga</p>
                <MetricLineChart labels={charts.labels} series={charts.rss} unit="MB" height={210} />
              </div>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Retraso interno (event loop p99)</h3>
                <p className={styles.cardHint}>Cuánto espera Node para atender trabajo nuevo</p>
                <MetricLineChart labels={charts.labels} series={charts.eventLoop} unit="ms" height={210} />
              </div>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Conexiones SQL de Kronos</h3>
                <p className={styles.cardHint}>Si hay peticiones esperando, el pool se quedó corto</p>
                <MetricLineChart labels={charts.labels} series={charts.pool} unit="" height={210} />
              </div>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Memoria del servidor</h3>
                <p className={styles.cardHint}>Porcentaje de RAM usada en la máquina de Kronos</p>
                <MetricLineChart labels={charts.labels} series={charts.hostMem} unit="%" suggestedMax={100} height={210} />
              </div>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Llamadas a servicios externos</h3>
                <p className={styles.cardHint}>Por minuto, con las limitadas (429) y fallidas</p>
                <MetricLineChart labels={charts.labels} series={charts.outbound} unit="/min" height={210} />
              </div>
            </div>
          </section>
        )}
        </Tabs.Panel>

        <Tabs.Panel value="base">
        <section className={styles.section} aria-labelledby="sm-db">
          <div className={styles.sectionHeader}>
            <h2 id="sm-db" className={styles.sectionTitle}>
              Base de datos
            </h2>
            <Group gap="xs">
              {dbLive?.queryStore && (
                <ToneChip
                  tone={dbLive.queryStore === 'READ_WRITE' ? 'ok' : 'info'}
                  label={`Query Store ${dbLive.queryStore === 'READ_WRITE' ? 'activo' : 'apagado'}`}
                />
              )}
              <Tooltip label="Actualizar foto en vivo">
                <ActionIcon variant="subtle" radius="xl" loading={dbLoading} onClick={() => void loadDbLive()} aria-label="Actualizar foto en vivo de SQL Server">
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </div>

          {dbError && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="md" radius="lg">
              {dbError}
            </Alert>
          )}
          {dbLive && !dbLive.hasServerState && (
            <Alert color="yellow" icon={<IconInfoCircle size={16} />} title="Datos parciales" mb="md" radius="lg">
              El usuario SQL de Kronos no tiene <Code>VIEW SERVER STATE</Code>: no se ven CPU de SQL, conexiones, bloqueos ni
              consultas pesadas.
            </Alert>
          )}

          <div className={styles.grid2}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>¿Quién está conectado?</h3>
              <p className={styles.cardHint}>
                Sesiones abiertas a esta base por programa
                {dbLive?.cachedAt ? ` · foto ${formatAgo(dbLive.cachedAt)}` : ''}
              </p>
              {connectionsByProgram.length === 0 ? (
                <div className={styles.empty}>Sin datos de conexiones.</div>
              ) : (
                <div className={styles.list}>
                  {connectionsByProgram.map((c) => (
                    <div key={c.label} className={styles.listRow}>
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <span className={styles.rowTitle}>{c.label}</span>
                        <span className={styles.rowMetric}>{formatInt(c.sessions)}</span>
                      </Group>
                      <div className={styles.shareTrack} style={{ marginTop: 8 }}>
                        <div
                          className={styles.shareFill}
                          style={{ width: `${totalSessions ? (c.sessions / totalSessions) * 100 : 0}%`, background: 'var(--sm-info)' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {dbLive?.blocked && dbLive.blocked.length > 0 && (
                <>
                  <h3 className={styles.cardTitle} style={{ marginTop: 20 }}>
                    Bloqueadas ahora
                  </h3>
                  <div className={styles.list} style={{ marginTop: 10 }}>
                    {dbLive.blocked.map((b) => (
                      <div key={b.sessionId} className={styles.listRow}>
                        <Group justify="space-between" wrap="nowrap">
                          <span className={styles.rowTitle}>
                            Sesión {b.sessionId} espera a la {b.blockingSessionId}
                          </span>
                          <ToneChip tone={b.waitMs > 5000 ? 'critical' : 'warning'} label={formatMs(b.waitMs)} />
                        </Group>
                        <div className={styles.rowSub}>
                          {programLabel(b.programName ?? '')} · {b.hostName ?? '–'} · {b.waitType ?? '–'}
                        </div>
                        {b.statement && <div className={styles.queryText}>{b.statement}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Consultas que más CPU consumen</h3>
              <p className={styles.cardHint}>
                Acumulado desde {dbLive?.sqlServerStartedAt ? formatDateTime(dbLive.sqlServerStartedAt) : 'que SQL arrancó'}
              </p>
              {!dbLive?.topQueries?.length ? (
                <div className={styles.empty}>Sin datos de consultas.</div>
              ) : (
                <div className={styles.list}>
                  {dbLive.topQueries.slice(0, 8).map((q, i) => {
                    const table = mainTableOf(q.statement);
                    return (
                      <div key={i} className={styles.listRow}>
                        <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                          <span style={{ minWidth: 0 }}>
                            <div className={styles.rowTitle}>{table ?? 'Consulta'}</div>
                            <div className={styles.rowSub}>
                              {formatInt(q.executions)} ejecuciones · {formatMs(q.avgElapsedMs)} en promedio ·{' '}
                              {formatInt(q.avgLogicalReads)} lecturas
                            </div>
                          </span>
                          <span className={styles.rowMetric}>
                            {formatMs(q.totalCpuMs)}
                            <div className={styles.rowMetricSub}>CPU total</div>
                          </span>
                        </Group>
                        <Tooltip label={q.statement} multiline w={520} withinPortal openDelay={400}>
                          <div className={styles.queryText}>{q.statement}</div>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {dbRows.some((r) => r.hasServerState) && (
            <div className={styles.grid2} style={{ marginTop: 16 }}>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>CPU del servidor SQL</h3>
                <p className={styles.cardHint}>SQL Server frente a otros programas de esa máquina</p>
                <MetricLineChart
                  labels={dbRows.map((r) => formatBucket(r.bucket, range))}
                  unit="%"
                  suggestedMax={100}
                  height={200}
                  series={[
                    { label: 'SQL Server', colorIndex: 0, values: dbRows.map((r) => r.sqlCpuPct) },
                    { label: 'Otros programas', colorIndex: 1, values: dbRows.map((r) => r.otherCpuPct) },
                  ]}
                />
              </div>
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Sesiones y consultas</h3>
                <p className={styles.cardHint}>Conectadas, ejecutándose y bloqueadas en esta base</p>
                <MetricLineChart
                  labels={dbRows.map((r) => formatBucket(r.bucket, range))}
                  unit=""
                  height={200}
                  series={[
                    { label: 'Sesiones', colorIndex: 0, values: dbRows.map((r) => r.dbSessions) },
                    { label: 'Ejecutándose', colorIndex: 1, values: dbRows.map((r) => r.activeRequests) },
                    { label: 'Bloqueadas', colorIndex: 2, values: dbRows.map((r) => r.blockedRequests) },
                  ]}
                />
              </div>
            </div>
          )}
        </section>

        </Tabs.Panel>

        <Tabs.Panel value="externos">
        {outbound.length > 0 && (
          <section className={styles.section} aria-labelledby="sm-ext">
            <div className={styles.sectionHeader}>
              <h2 id="sm-ext" className={styles.sectionTitle}>
                Servicios externos
              </h2>
              <span className={styles.sectionHint}>Graph/SharePoint, Orion, SAP, IA y otros</span>
            </div>
            <div className={styles.list}>
              {outbound.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={styles.listRowButton}
                  onClick={() => setDetail({ kind: 'route', direction: 'out', key: r.key, title: r.label ?? r.key })}
                >
                  <span style={{ minWidth: 0 }}>
                    <div className={styles.rowTitle}>{r.label ?? r.key}</div>
                    <div className={styles.rowSub}>
                      {r.label && r.label !== r.key ? `${r.key} · ` : ''}
                      {formatInt(r.requests)} llamadas · promedio {formatMs(r.avgMs)}
                      {r.throttled > 0 ? ` · ${formatInt(r.throttled)} limitadas (429)` : ''}
                      {r.errors > 0 ? ` · ${formatInt(r.errors)} fallidas` : ''}
                    </div>
                  </span>
                  <span className={styles.rowMetric}>
                    {formatMs(r.p95Ms)}
                    <div className={styles.rowMetricSub}>p95</div>
                  </span>
                  <IconChevronRight size={16} className={styles.chevron} />
                </button>
              ))}
            </div>
          </section>
        )}

        </Tabs.Panel>
        </Tabs>
      </div>

      <DetailSheet
        target={detail}
        range={range}
        inbound={inbound}
        outbound={outbound}
        onClose={() => setDetail(null)}
        onSelect={setDetail}
      />
    </div>
  );
}
