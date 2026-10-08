'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ActionIcon, Alert, Anchor, Breadcrumbs, Code, Group, Loader, SegmentedControl, Switch, Text, Tooltip } from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconChevronRight,
  IconClockHour4,
  IconDatabase,
  IconGauge,
  IconInfoCircle,
  IconRefresh,
} from '@tabler/icons-react';
import {
  buildInsights,
  mainTableOf,
  verdictFrom,
  type Insight,
  type Severity,
} from '../../../../lib/system-metrics/insights';
import { DetailSheet } from '../../../../components/system-metrics/DetailSheet';
import { MetricLineChart, type LineSeries } from '../../../../components/system-metrics/MetricLineChart';
import { ResourceRings, type RingSpec } from '../../../../components/system-metrics/ResourceRings';
import { ServerTime } from '../../../../components/system-metrics/ServerTime';
import { SignalTile } from '../../../../components/system-metrics/SignalTile';
import { StatusHero, ToneChip } from '../../../../components/system-metrics/StatusHero';
import { SystemMap, type MapData } from '../../../../components/system-metrics/SystemMap';
import type { StatusTone } from '../../../../components/system-metrics/colors';
import {
  formatAgo,
  formatBucket,
  formatDateTime,
  formatInt,
  formatMs,
  formatValue,
  percentChange,
} from '../../../../components/system-metrics/format';
import {
  BUCKET_MINUTES,
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
 * Orden de lectura: 1) veredicto en una frase + hallazgos (lib/system-metrics/insights.ts),
 * 2) señales clave frente al periodo anterior, 3) mapa del sistema y saturación,
 * 4) qué módulo usa el servidor ("Tiempo de servidor"), 5) tendencias y detalle.
 *
 * Datos: /api/system-metrics (histórico del colector), /api/system-metrics/db-live (foto de
 * SQL Server) y /api/system-metrics/route-series (hoja de detalle). Módulo restringido
 * (subproceso '/process/system-metrics').
 */

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

function worstTone(insights: Insight[], fallback: StatusTone = 'ok'): StatusTone {
  const relevant = insights.filter((i) => i.severity === 'critical' || i.severity === 'warning');
  if (!relevant.length) return fallback;
  return relevant.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0].severity as StatusTone;
}

function instanceName(instance: string, host: string, multiHost: boolean): string {
  const base = instance === 'unica' ? 'Kronos' : `Kronos #${instance}`;
  return multiHost ? `${base} · ${host}` : base;
}

const PROGRAM_NAMES: Record<string, string> = {
  tiberius: 'Prisma (Kronos)',
  'node-mssql': 'mssql (Kronos)',
  tedious: 'mssql (Kronos)',
};

function programLabel(name: string): string {
  if (PROGRAM_NAMES[name]) return PROGRAM_NAMES[name];
  if (name.startsWith('Microsoft SQL Server Management Studio') || name === 'SQL Server Management Studio') {
    return 'SQL Server Management Studio';
  }
  return name || '(sin nombre)';
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
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

  useEffect(() => {
    if (hasAccess) void loadDbLive();
  }, [hasAccess, loadDbLive]);

  useEffect(() => {
    if (!hasAccess || !autoRefresh) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadMetrics(range);
      void loadDbLive();
    }, 60_000);
    return () => clearInterval(id);
  }, [hasAccess, autoRefresh, range, loadMetrics, loadDbLive]);

  // Refresca el "hace X s" del encabezado.
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

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
    const instances = latest.map((r) => {
      const key = `${r.host}|${r.instance}`;
      const own = insights.filter((i) => i.id.endsWith(key));
      return {
        key,
        name: instanceName(r.instance, r.host, multiHost),
        cpuPct: r.cpuPct,
        rssMb: r.rssMb,
        eventLoopMs: r.eventLoopP99Ms,
        tone: worstTone([...own, ...hostLevel]),
      };
    });

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
      },
      instances,
      sql: {
        tone: lastDb || dbLive ? worstTone(insights.filter((i) => i.area === 'base')) : 'idle',
        cpuPct: lastDb?.sqlCpuPct ?? null,
        sessions: lastDb?.dbSessions ?? null,
        blocked: lastDb?.blockedRequests ?? null,
        poolInUse,
        hasServerState: lastDb?.hasServerState ?? dbLive?.hasServerState ?? null,
      },
      externals,
    };
  }, [processRows, latest, insights, metrics, observedMinutes, signals, hasData, lastDb, dbLive]);

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

        <section className={styles.section} aria-labelledby="sm-map">
          <div className={styles.sectionHeader}>
            <h2 id="sm-map" className={styles.sectionTitle}>
              Cómo fluye el trabajo
            </h2>
            <span className={styles.sectionHint}>Toque un servicio externo para ver su historia</span>
          </div>
          <div className={styles.gridMap}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Mapa del sistema</h3>
              <p className={styles.cardHint}>Usuarios → Kronos → base de datos y servicios externos, con la salud de cada pieza</p>
              <SystemMap
                data={mapData}
                onSelectExternal={(key, label) => setDetail({ kind: 'route', direction: 'out', key, title: label })}
              />
            </div>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Qué tan lleno está cada recurso</h3>
              <p className={styles.cardHint}>Último minuto registrado</p>
              <ResourceRings rings={rings} />
            </div>
          </div>
        </section>

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
