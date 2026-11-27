'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Breadcrumbs,
  Group,
  Loader,
  SegmentedControl,
  Switch,
  Table,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconChevronRight,
  IconClockHour4,
  IconCloud,
  IconDatabase,
  IconGauge,
  IconLayoutDashboard,
  IconRefresh,
  IconTopologyStar3,
  IconUsers,
} from '@tabler/icons-react';
import { StatusHero, ToneChip } from '../../../../components/system-metrics/StatusHero';
import { SignalTile } from '../../../../components/system-metrics/SignalTile';
import { ResourceRings, type RingSpec } from '../../../../components/system-metrics/ResourceRings';
import { MetricLineChart } from '../../../../components/system-metrics/MetricLineChart';
import { ServerTime } from '../../../../components/system-metrics/ServerTime';
import { UserBehavior } from '../../../../components/system-metrics/UserBehavior';
import type { ModuleRow, ModuleSeriesRow, UserRow } from '../../../../components/system-metrics/types';
import { formatAgo, formatBucket, formatInt, formatMs, formatValue, programLabel } from '../../../../components/system-metrics/format';
import styles from '../../../../components/system-metrics/monitor.module.css';
import { mainTableOf, type Insight, type Verdict } from '../../../../lib/system-metrics/insights';
import { SapsendEarlyWarnings, type SapsendAlert } from '../../../../components/sapsend-monitor/SapsendEarlyWarnings';
import { ConcurrencyMap, type MapCompany, type MapConnection } from '../../../../components/sapsend-monitor/ConcurrencyMap';
import { SapsendConsumers, type SapsendLogin } from '../../../../components/sapsend-monitor/SapsendConsumers';
import { SapsendQueries, type SapsendQuery, type SapsendRunning } from '../../../../components/sapsend-monitor/SapsendQueries';

/* ------------------------------------------------------------------------ */
/* Tipos de la foto (lib/sapsend/live.js)                                    */
/* ------------------------------------------------------------------------ */

type Company = MapCompany & {
  online: boolean;
  queries: MapCompany['queries'] & { distinct: number; executions: number; cpuMs: number; reads: number; writes: number };
  blocks: number;
};

type HistoryPoint = {
  at: number;
  sapsendSessions: number;
  sapsendRunning: number;
  blocked: number;
  execPerMin: number | null;
  hosts: number | null;
  sqlCpuPct: number | null;
  slPulseMax: number | null;
  slPulseAvg: number | null;
};

type Snapshot = {
  sampledAt: string;
  host: string;
  note: string;
  urlHost: string;
  health: { ok: boolean; skipped?: boolean; status: number; latencyMs: number | null; error: string | null };
  hasServerState?: boolean;
  verdict: { severity: 'ok' | 'warning' | 'critical' | 'info'; headline: string; sub: string };
  alerts?: SapsendAlert[];
  alertHistoryHours?: number;
  watchList?: string[];
  highlights?: Insight[];
  totals: {
    databases: number;
    sessions: number;
    running: number;
    blocked: number;
    hosts: number;
    logins: number;
    execPerMin: number;
    heavyQueries: number;
    slowNow: number;
    personal?: number;
    toReview?: number;
  };
  companies: Company[];
  connections: Array<MapConnection & { kind: string; lastRequestAt: string | null }>;
  logins: SapsendLogin[];
  queries: SapsendQuery[];
  runningNow: SapsendRunning[];
  blocks: Array<{
    database: string | null;
    blockedSessionId: number;
    blockingSessionId: number;
    waitType: string | null;
    waitMs: number;
    blockedProgram: string | null;
    blockingProgram: string | null;
    blockedSql: string | null;
  }>;
  sqlCpu: Array<{ at: string; sqlCpuPct: number | null; otherCpuPct: number | null }>;
  activity: { modules: ModuleRow[]; moduleSeries: ModuleSeriesRow[] };
  history: HistoryPoint[];
};

/* ------------------------------------------------------------------------ */
/* Rango y comparación con el periodo anterior (historial en memoria)        */
/* ------------------------------------------------------------------------ */

type RangeKey = '15m' | '1h';
const RANGE_MS: Record<RangeKey, number> = { '15m': 15 * 60_000, '1h': 60 * 60_000 };
const RANGE_LONG: Record<RangeKey, string> = { '15m': 'Los últimos 15 minutos', '1h': 'La última hora' };
const RANGE_OPTIONS = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 h' },
  { value: '6h', label: '6 h', disabled: true },
  { value: '24h', label: '24 h', disabled: true },
];

function windowOf(history: HistoryPoint[] | undefined, range: RangeKey, offset = 0) {
  const h = history ?? [];
  if (!h.length) return [];
  const end = h[h.length - 1].at - RANGE_MS[range] * offset;
  const start = end - RANGE_MS[range];
  return h.filter((p) => p.at > start && p.at <= end);
}

function avgOf(points: HistoryPoint[], pick: (p: HistoryPoint) => number | null | undefined) {
  const vals = points.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
}

function periodChange(history: HistoryPoint[] | undefined, range: RangeKey, pick: (p: HistoryPoint) => number | null | undefined) {
  const h = history ?? [];
  if (!h.length || h[h.length - 1].at - h[0].at < RANGE_MS[range] * 1.8) return null;
  const cur = avgOf(windowOf(history, range), pick);
  const base = avgOf(windowOf(history, range, 1), pick);
  if (cur == null || base == null || base === 0) return null;
  return ((cur - base) / base) * 100;
}

const timeLabel = (at: number) => new Date(at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

/* ------------------------------------------------------------------------ */
/* Pestañas (las mismas del Monitor del sistema)                             */
/* ------------------------------------------------------------------------ */

type TabKey = 'resumen' | 'mapas' | 'usuarios' | 'rendimiento' | 'base' | 'externos';
const TAB_KEYS: TabKey[] = ['resumen', 'mapas', 'usuarios', 'rendimiento', 'base', 'externos'];
function tabFromHash(hash: string): TabKey | null {
  const key = hash.replace(/^#/, '');
  return (TAB_KEYS as string[]).includes(key) ? (key as TabKey) : null;
}

const COMPANY_STATUS_LABEL = { ok: 'Bien', warning: 'Atención', critical: 'Crítico', idle: 'Sin actividad' } as const;
const REFRESH_MS = 10_000;

/**
 * Monitor SAPSEND: los SAPSEND de producción de todas las empresas, vistos directamente
 * (sus bases en el SQL Server + el Service Layer de cada empresa). Mismo diseño que el
 * Monitor del sistema. No mide a SynerLink: eso está en el Monitor del sistema.
 */
export default function SapsendMonitorPage() {
  const { data: session } = useSession();
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [range, setRange] = useState<RangeKey>('1h');
  const [showAllHeavy, setShowAllHeavy] = useState(false);

  useEffect(() => {
    const fromHash = tabFromHash(window.location.hash);
    if (fromHash) setTab(fromHash);
  }, []);

  const changeTab = useCallback((value: string | null) => {
    const next = tabFromHash(value ?? '') ?? 'resumen';
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  }, []);

  const load = useCallback(
    async (initial = false) => {
      if (!session) return;
      try {
        if (initial) setLoading(true);
        else setRefreshing(true);
        setError(null);
        if (hasAccess == null || initial) {
          const accessRes = await fetch('/api/sapsend-monitor/access');
          if (!accessRes.ok) throw new Error('No se pudo verificar el acceso');
          const accessData = await accessRes.json();
          setHasAccess(Boolean(accessData.canAccess));
          if (!accessData.canAccess) return;
        }
        const res = await fetch('/api/sapsend-monitor', { cache: 'no-store' });
        if (!res.ok) throw new Error('No se pudo cargar el monitor SAPSEND');
        setSnap(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, hasAccess]
  );

  useEffect(() => {
    void load(true);
  }, [session]);

  // Cada 10 s con la pestaña visible. El servidor comparte una sola foto entre todos los que
  // miran (caché de 4 s), así que más personas no significa más consultas al SQL Server.
  useEffect(() => {
    if (!autoRefresh || !hasAccess) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [autoRefresh, hasAccess, load]);

  /* ---------------- Cálculos para la pantalla ---------------- */

  const companies = snap?.companies ?? [];
  const history = snap?.history ?? [];
  const rangePoints = windowOf(history, range);
  const companyByDb: Record<string, string> = Object.fromEntries(companies.map((c) => [c.sapsendDb.toLowerCase(), c.company]));
  const lastCpu = snap?.sqlCpu?.length ? snap.sqlCpu[snap.sqlCpu.length - 1] : null;
  const slCompanies = companies.filter((c) => c.sl);
  const slDown = slCompanies.filter((c) => !c.sl!.pulse.ok).length;
  const slMax = Math.max(0, ...slCompanies.map((c) => c.sl!.pulse.latencyMs ?? 0));

  const rings: RingSpec[] = [
    {
      key: 'ss',
      label: 'Concurrencia SAPSEND',
      percent: snap ? (snap.totals.sessions ? (snap.totals.running / snap.totals.sessions) * 100 : 0) : null,
      sub: `${formatInt(snap?.totals.running ?? 0)} activas de ${formatInt(snap?.totals.sessions ?? 0)} sesiones`,
      warning: 50,
      critical: 80,
    },
    {
      key: 'cpu',
      label: 'CPU del SQL Server',
      percent: lastCpu?.sqlCpuPct ?? null,
      sub: lastCpu ? `Otros programas ${formatInt(lastCpu.otherCpuPct ?? 0)} %` : 'Sin dato',
      warning: 60,
      critical: 85,
    },
    {
      key: 'sl',
      label: 'Service Layer',
      percent: slCompanies.length ? (slDown ? 100 : Math.min(100, (slMax / 3000) * 100)) : null,
      sub: slDown ? `${slDown} sin respuesta` : `El más lento: ${formatMs(slMax)} (lleno = 3 s)`,
      warning: 34,
      critical: 100,
    },
    {
      key: 'blocked',
      label: 'Sesiones bloqueadas',
      percent: snap ? (snap.totals.sessions ? (snap.totals.blocked / snap.totals.sessions) * 100 : 0) : null,
      sub: `${formatInt(snap?.totals.blocked ?? 0)} esperando a otra`,
      warning: 1,
      critical: 10,
    },
  ];

  const insights: Insight[] = [];
  if (snap && snap.hasServerState === false) {
    insights.push({ id: 'no-vss', severity: 'warning', area: 'base', title: 'Sin VIEW SERVER STATE', detail: 'No se puede leer la actividad de los SAPSEND en este SQL Server.' });
  }
  if (snap && snap.totals.blocked > 0) {
    insights.push({ id: 'blocks', severity: 'critical', area: 'base', title: `${snap.totals.blocked} bloqueo(s) en las bases SAPSEND`, detail: 'Vea la cadena bloqueador → bloqueado en la pestaña Base de datos.' });
  }
  for (const c of slCompanies.filter((x) => !x.sl!.pulse.ok)) {
    insights.push({ id: `sl-${c.sapsendDb}`, severity: 'critical', area: 'externos', title: `Service Layer de ${c.company} sin respuesta`, detail: c.sl!.pulse.error ?? 'Sin respuesta' });
  }
  if (snap && snap.totals.slowNow > 0) {
    insights.push({ id: 'slow', severity: 'warning', area: 'base', title: `${snap.totals.slowNow} consulta(s) de más de 10 s`, detail: 'Vea Ejecutándose en este momento en Base de datos.' });
  }
  const personalLogins = (snap?.logins ?? []).filter((l) => l.accountType === 'persona');
  if (personalLogins.length > 0) {
    insights.push({
      id: 'personal',
      severity: 'warning',
      area: 'base',
      title: `${personalLogins.length} persona(s) conectada(s) a SAPSEND con su propia cuenta`,
      detail: `${[...new Set(personalLogins.map((l) => `${l.person?.name ?? 'Sin identificar'} (${l.host})`))].slice(0, 3).join(', ')} · vea la pestaña Usuarios.`,
    });
  }
  if (snap && !snap.health.ok && !snap.health.skipped) {
    insights.push({ id: 'down', severity: 'critical', area: 'externos', title: 'SAPSEND productivo no responde', detail: snap.health.error || 'Sin respuesta' });
  }

  const baseTone = (snap?.totals.blocked ?? 0) > 0 ? 'critical' : (snap?.totals.slowNow ?? 0) > 0 ? 'warning' : 'ok';
  const extTone = slDown > 0 || (snap && !snap.health.ok && !snap.health.skipped) ? 'critical' : slMax >= 3000 ? 'warning' : 'ok';

  // ¿Quién está conectado? por programa
  const connMap = new Map<string, { label: string; sessions: number; dbs: Set<string> }>();
  for (const x of snap?.connections ?? []) {
    if (!/^SAPSEND/i.test(x.database)) continue;
    const label = x.program ? programLabel(x.program) : 'Programa desconocido';
    const cur = connMap.get(label) ?? { label, sessions: 0, dbs: new Set<string>() };
    cur.sessions += x.sessions;
    cur.dbs.add(companyByDb[x.database.toLowerCase()] ?? x.database);
    connMap.set(label, cur);
  }
  const connectionsByProgram = [...connMap.values()].sort((a, b) => b.sessions - a.sessions);
  const connTotal = connectionsByProgram.reduce((a, c) => a + c.sessions, 0);
  const topCpuQueries = [...(snap?.queries ?? [])].sort((a, b) => b.cpuMs - a.cpuMs).slice(0, 8);
  const heavyQueries = [...(snap?.queries ?? [])].sort((a, b) => b.totalMs - a.totalMs);

  // Comportamiento: a qué base SAPSEND va la CPU de cada equipo (formato de UserBehavior)
  const behaviorUsers: UserRow[] = (snap?.logins ?? []).map((l) => ({
    email: l.key,
    name: l.person?.name ? `${l.person.name} (${l.host})` : `${l.host} · ${l.login}`,
    requests: l.sessions,
    errors: 0,
    totalMs: l.cpuMs,
    maxMs: 0,
    avgMs: 0,
    p95Ms: 0,
    topModule: l.databases[0]?.name ?? null,
    topModuleLabel: l.databases[0] ? companyByDb[l.databases[0].name.toLowerCase()] ?? l.databases[0].name : null,
    lastSeen: l.lastRequestAt ?? new Date().toISOString(),
    modules: l.databases.map((d) => ({ module: d.name, label: companyByDb[d.name.toLowerCase()] ?? d.name, totalMs: d.cpuMs })),
    modulesApproximate: false,
  }));

  const verdict: Verdict = snap?.verdict ?? { severity: 'info', headline: 'Cargando…', sub: '' };

  const crumbs = [
    <Link key="p" href="/process" passHref>
      <Anchor component="span" size="sm">
        Procesos
      </Anchor>
    </Link>,
    <Text key="m" component="span" size="sm" c="dimmed">
      Monitor SAPSEND
    </Text>,
  ];

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }
  if (hasAccess === false) {
    return (
      <Alert color="red" title="Monitor SAPSEND" mt="md">
        No tiene acceso a este módulo.
      </Alert>
    );
  }
  if (error && !snap) {
    return (
      <Alert color="red" title="Monitor SAPSEND" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.container}>
        <Breadcrumbs separator={<IconChevronRight size={14} />} mb="sm">
          {crumbs}
        </Breadcrumbs>

        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>
              <span className={`${styles.liveDot} ${autoRefresh ? '' : styles.liveDotOff}`} aria-hidden />
              {autoRefresh ? 'En vivo' : 'Pausado'}
              {snap?.sampledAt ? ` · actualizado ${formatAgo(snap.sampledAt)}` : ''}
              {snap ? ` · ${snap.host}` : ''}
            </div>
            <h1 className={styles.largeTitle}>Monitor SAPSEND</h1>
          </div>
          <div className={styles.headerControls}>
            <Tooltip label="6 h y 24 h se activan cuando corra la caja negra (historial guardado en SQL)">
              <SegmentedControl
                radius="xl"
                value={range}
                onChange={(v) => setRange(v as RangeKey)}
                data={RANGE_OPTIONS}
                aria-label="Rango de tiempo"
              />
            </Tooltip>
            <Switch checked={autoRefresh} onChange={(e) => setAutoRefresh(e.currentTarget.checked)} label="En vivo" size="sm" />
            <Tooltip label="Actualizar ahora">
              <ActionIcon variant="light" radius="xl" size="lg" loading={refreshing} onClick={() => void load(false)} aria-label="Actualizar ahora">
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </div>
        </header>

        {error && (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />} mb="md" radius="lg">
            {error}
          </Alert>
        )}

        <StatusHero verdict={verdict} insights={insights} highlights={snap?.highlights ?? []} hasData={Boolean(snap)} />

        {snap && (
          <Tabs value={tab} onChange={changeTab} keepMounted={false} variant="pills" radius="xl" className={styles.tabs}>
            <Tabs.List className={styles.tabList} aria-label="Secciones del monitor">
              <Tabs.Tab value="resumen" leftSection={<IconLayoutDashboard size={16} />}>
                Resumen
              </Tabs.Tab>
              <Tabs.Tab value="mapas" leftSection={<IconTopologyStar3 size={16} />}>
                Mapas
              </Tabs.Tab>
              <Tabs.Tab
                value="usuarios"
                leftSection={<IconUsers size={16} />}
                rightSection={
                  personalLogins.length > 0 ? (
                    <span className={`${styles.tabDot} ${styles['tone-warning']}`} aria-label="Personas con su propia cuenta" />
                  ) : null
                }
              >
                Usuarios
              </Tabs.Tab>
              <Tabs.Tab value="rendimiento" leftSection={<IconGauge size={16} />}>
                Rendimiento
              </Tabs.Tab>
              <Tabs.Tab
                value="base"
                leftSection={<IconDatabase size={16} />}
                rightSection={baseTone !== 'ok' ? <span className={`${styles.tabDot} ${styles[`tone-${baseTone}`]}`} aria-label="Base de datos con alertas" /> : null}
              >
                Base de datos
              </Tabs.Tab>
              <Tabs.Tab
                value="externos"
                leftSection={<IconCloud size={16} />}
                rightSection={extTone !== 'ok' ? <span className={`${styles.tabDot} ${styles[`tone-${extTone}`]}`} aria-label="Servicios externos con alertas" /> : null}
              >
                Servicios externos
              </Tabs.Tab>
            </Tabs.List>

            {/* ---------------- Resumen ---------------- */}
            <Tabs.Panel value="resumen">
              <section id="alertas" className={styles.section} aria-labelledby="ss-alerts">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-alerts" className={styles.sectionTitle}>
                    Alertas tempranas
                  </h2>
                  <span className={styles.sectionHint}>SAPSEND, Service Layer y SQL Server · revisa en cada actualización</span>
                </div>
                <SapsendEarlyWarnings alerts={snap.alerts ?? []} historyHours={snap.alertHistoryHours ?? 48} watchList={snap.watchList ?? []} />
              </section>

              <section className={styles.section} aria-labelledby="ss-signals">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-signals" className={styles.sectionTitle}>
                    Señales clave
                  </h2>
                  <span className={styles.sectionHint}>{RANGE_LONG[range]} contra el periodo anterior</span>
                </div>
                <div className={styles.grid4}>
                  <SignalTile
                    icon={<IconActivity size={15} />}
                    label="Consultas de los SAPSEND"
                    value={avgOf(rangePoints, (p) => p.execPerMin) == null ? '–' : formatValue(avgOf(rangePoints, (p) => p.execPerMin) ?? 0)}
                    unit="por min"
                    change={periodChange(history, range, (p) => p.execPerMin)}
                    polarity="neutral"
                    trend={rangePoints.map((p) => p.execPerMin)}
                    foot={`${formatInt(snap.totals.databases)} bases SAPSEND`}
                  />
                  <SignalTile
                    icon={<IconUsers size={15} />}
                    label="Consultas activas a la vez"
                    value={avgOf(rangePoints, (p) => p.sapsendRunning) == null ? '–' : formatValue(avgOf(rangePoints, (p) => p.sapsendRunning) ?? 0)}
                    change={periodChange(history, range, (p) => p.sapsendRunning)}
                    polarity="up-is-bad"
                    trend={rangePoints.map((p) => p.sapsendRunning)}
                    foot={`ahora ${formatInt(snap.totals.running)} de ${formatInt(snap.totals.sessions)} sesiones`}
                  />
                  <SignalTile
                    icon={<IconClockHour4 size={15} />}
                    label="Pulso del Service Layer"
                    value={avgOf(rangePoints, (p) => p.slPulseAvg) == null ? '–' : formatMs(avgOf(rangePoints, (p) => p.slPulseAvg))}
                    change={periodChange(history, range, (p) => p.slPulseAvg)}
                    polarity="up-is-bad"
                    trend={rangePoints.map((p) => p.slPulseAvg)}
                    foot="promedio de todas las empresas"
                  />
                  <SignalTile
                    icon={<IconGauge size={15} />}
                    label="CPU del SQL Server"
                    value={avgOf(rangePoints, (p) => p.sqlCpuPct) == null ? '–' : formatValue(avgOf(rangePoints, (p) => p.sqlCpuPct) ?? 0)}
                    unit="%"
                    change={periodChange(history, range, (p) => p.sqlCpuPct)}
                    polarity="up-is-bad"
                    trend={rangePoints.map((p) => p.sqlCpuPct)}
                    foot="donde viven las bases SAPSEND"
                  />
                </div>
              </section>

              <section className={styles.section} aria-labelledby="ss-rings">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-rings" className={styles.sectionTitle}>
                    Qué tan lleno está cada recurso
                  </h2>
                  <span className={styles.sectionHint}>Ahora mismo</span>
                </div>
                <div className={styles.card}>
                  <ResourceRings rings={rings} />
                </div>
              </section>
            </Tabs.Panel>

            {/* ---------------- Mapas ---------------- */}
            <Tabs.Panel value="mapas">
              <section className={styles.section} aria-labelledby="ss-map">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-map" className={styles.sectionTitle}>
                    Mapa de concurrencia
                  </h2>
                  <span className={styles.sectionHint}>Equipos → SAPSEND de cada empresa → Service Layer → SAP</span>
                </div>
                <div className={styles.card}>
                  <ConcurrencyMap companies={companies} connections={snap.connections} />
                </div>
              </section>
            </Tabs.Panel>

            {/* ---------------- Usuarios ---------------- */}
            <Tabs.Panel value="usuarios">
              <section className={styles.section} aria-labelledby="ss-users">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-users" className={styles.sectionTitle}>
                    Usuarios
                  </h2>
                  <span className={styles.sectionHint}>Quién se conecta a los SAPSEND (equipo + usuario SQL) y cuánto consume</span>
                </div>
                <SapsendConsumers logins={snap.logins} companyByDb={companyByDb} />
                <div className={styles.card} style={{ marginTop: 16 }}>
                  <h3 className={styles.cardTitle}>Comportamiento</h3>
                  <p className={styles.cardHint}>A qué SAPSEND (empresa) va la CPU de cada equipo y usuario SQL</p>
                  <UserBehavior users={behaviorUsers} />
                </div>
              </section>
            </Tabs.Panel>

            {/* ---------------- Rendimiento ---------------- */}
            <Tabs.Panel value="rendimiento">
              <section className={styles.section} aria-labelledby="ss-cputime">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-cputime" className={styles.sectionTitle}>
                    Tiempo de CPU de cada SAPSEND
                  </h2>
                  <span className={styles.sectionHint}>Qué empresa ocupa al SQL Server y a qué hora</span>
                </div>
                <div className={styles.card}>
                  {snap.activity.moduleSeries.length === 0 ? (
                    <div className={styles.empty}>
                      Se llena con el monitor abierto: cada 30 s compara cuánto ejecutó cada SAPSEND desde la lectura
                      anterior.
                    </div>
                  ) : (
                    <ServerTime modules={snap.activity.modules} series={snap.activity.moduleSeries} range="1h" onSelectModule={() => changeTab('base')} />
                  )}
                </div>
              </section>

              {heavyQueries.length > 0 && (
                <section className={styles.section} aria-labelledby="ss-heavy">
                  <div className={styles.sectionHeader}>
                    <h2 id="ss-heavy" className={styles.sectionTitle}>
                      Consultas más pesadas
                    </h2>
                    <span className={styles.sectionHint}>Por tiempo total · todos los SAPSEND</span>
                  </div>
                  <div className={styles.list}>
                    {(showAllHeavy ? heavyQueries : heavyQueries.slice(0, 8)).map((q) => (
                      <div key={`${q.database}|${q.queryHash}`} className={styles.listRowButton} style={{ cursor: 'default' }}>
                        <span style={{ minWidth: 0 }}>
                          <div className={`${styles.rowTitle} ${styles.rowMono}`}>
                            {mainTableOf(q.sqlText ?? '') ?? 'Consulta'} · {companyByDb[q.database.toLowerCase()] ?? q.database}
                          </div>
                          <div className={styles.rowSub}>
                            {formatInt(q.executions)} ejecuciones · promedio {formatMs(q.avgMs)} · máximo {formatMs(q.maxMs)}
                            {q.perMin ? ` · ${formatInt(Math.round(q.perMin))}/min ahora` : ''}
                          </div>
                        </span>
                        <span className={styles.rowMetric}>
                          {formatMs(q.totalMs)}
                          <div className={styles.rowMetricSub}>CPU {formatMs(q.cpuMs)}</div>
                        </span>
                      </div>
                    ))}
                    {heavyQueries.length > 8 && (
                      <button type="button" className={styles.linkButton} onClick={() => setShowAllHeavy((v) => !v)}>
                        {showAllHeavy ? 'Ver menos' : `Ver las ${heavyQueries.length} consultas`}
                      </button>
                    )}
                  </div>
                </section>
              )}

              <section className={styles.section} aria-labelledby="ss-trends">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-trends" className={styles.sectionTitle}>
                    Tendencias
                  </h2>
                  <span className={styles.sectionHint}>{RANGE_LONG[range]} · en memoria del servidor</span>
                </div>
                {rangePoints.length < 2 ? (
                  <div className={styles.empty}>Las gráficas aparecen con dos o más lecturas.</div>
                ) : (
                  <div className={styles.grid2}>
                    <div className={styles.card}>
                      <h3 className={styles.cardTitle}>Consultas por minuto</h3>
                      <p className={styles.cardHint}>Lo que ejecutan todos los SAPSEND juntos</p>
                      <MetricLineChart labels={rangePoints.map((p) => timeLabel(p.at))} unit="/min" height={210} series={[{ label: 'Consultas', colorIndex: 0, values: rangePoints.map((p) => p.execPerMin) }]} />
                    </div>
                    <div className={styles.card}>
                      <h3 className={styles.cardTitle}>Pulso del Service Layer</h3>
                      <p className={styles.cardHint}>Cuánto tarda en responder, promedio y el más lento</p>
                      <MetricLineChart
                        labels={rangePoints.map((p) => timeLabel(p.at))}
                        unit="ms"
                        height={210}
                        series={[
                          { label: 'Promedio', colorIndex: 0, values: rangePoints.map((p) => p.slPulseAvg) },
                          { label: 'Más lento', colorIndex: 3, values: rangePoints.map((p) => p.slPulseMax) },
                        ]}
                      />
                    </div>
                    <div className={styles.card}>
                      <h3 className={styles.cardTitle}>Concurrencia</h3>
                      <p className={styles.cardHint}>Sesiones, consultas activas y bloqueadas en los SAPSEND</p>
                      <MetricLineChart
                        labels={rangePoints.map((p) => timeLabel(p.at))}
                        unit=""
                        height={210}
                        series={[
                          { label: 'Sesiones', colorIndex: 0, values: rangePoints.map((p) => p.sapsendSessions) },
                          { label: 'Activas', colorIndex: 1, values: rangePoints.map((p) => p.sapsendRunning) },
                          { label: 'Bloqueadas', colorIndex: 2, values: rangePoints.map((p) => p.blocked) },
                        ]}
                      />
                    </div>
                    <div className={styles.card}>
                      <h3 className={styles.cardTitle}>Equipos conectados</h3>
                      <p className={styles.cardHint}>Máquinas con sesiones en las bases SAPSEND</p>
                      <MetricLineChart labels={rangePoints.map((p) => timeLabel(p.at))} unit="" height={210} series={[{ label: 'Equipos', colorIndex: 4, values: rangePoints.map((p) => p.hosts) }]} />
                    </div>
                  </div>
                )}
              </section>
            </Tabs.Panel>

            {/* ---------------- Base de datos ---------------- */}
            <Tabs.Panel value="base">
              <section className={styles.section} aria-labelledby="ss-db">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-db" className={styles.sectionTitle}>
                    Base de datos
                  </h2>
                  <span className={styles.sectionHint}>Bases SAPSEND en el SQL Server · foto {formatAgo(snap.sampledAt)}</span>
                </div>
                {snap.hasServerState === false && (
                  <Alert color="yellow" title="Datos parciales" mb="md" radius="lg">
                    El usuario SQL del monitor no tiene VIEW SERVER STATE: no se ven CPU, conexiones, bloqueos ni consultas.
                  </Alert>
                )}
                <div className={styles.grid2}>
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>¿Quién está conectado?</h3>
                    <p className={styles.cardHint}>Sesiones abiertas a las bases SAPSEND por programa</p>
                    {connectionsByProgram.length === 0 ? (
                      <div className={styles.empty}>Sin conexiones en este momento.</div>
                    ) : (
                      <div className={styles.list}>
                        {connectionsByProgram.map((c) => (
                          <div key={c.label} className={styles.listRow}>
                            <Group justify="space-between" wrap="nowrap" gap="sm">
                              <span className={styles.rowTitle}>{c.label}</span>
                              <span className={styles.rowMetric}>{formatInt(c.sessions)}</span>
                            </Group>
                            <div className={styles.rowSub}>{[...c.dbs].sort().join(', ')}</div>
                            <div className={styles.shareTrack} style={{ marginTop: 8 }}>
                              <div className={styles.shareFill} style={{ width: `${connTotal ? (c.sessions / connTotal) * 100 : 0}%`, background: 'var(--sm-info)' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>Consultas que más CPU consumen</h3>
                    <p className={styles.cardHint}>De los SAPSEND · acumulado desde que cada consulta entró a la caché de SQL Server</p>
                    {topCpuQueries.length === 0 ? (
                      <div className={styles.empty}>Sin datos de consultas.</div>
                    ) : (
                      <div className={styles.list}>
                        {topCpuQueries.map((q) => (
                          <div key={`${q.database}|${q.queryHash}`} className={styles.listRow}>
                            <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                              <span style={{ minWidth: 0 }}>
                                <div className={styles.rowTitle}>
                                  {mainTableOf(q.sqlText ?? '') ?? 'Consulta'} · {companyByDb[q.database.toLowerCase()] ?? q.database}
                                </div>
                                <div className={styles.rowSub}>
                                  {formatInt(q.executions)} ejecuciones · {formatMs(q.avgMs)} en promedio ·{' '}
                                  {formatInt(q.executions ? Math.round(q.reads / q.executions) : 0)} lecturas por ejecución
                                </div>
                              </span>
                              <span className={styles.rowMetric}>
                                {formatMs(q.cpuMs)}
                                <div className={styles.rowMetricSub}>CPU total</div>
                              </span>
                            </Group>
                            <Tooltip label={q.sqlText} multiline w={520} withinPortal openDelay={400}>
                              <div className={styles.queryText}>{q.sqlText}</div>
                            </Tooltip>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.grid2} style={{ marginTop: 16 }}>
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>CPU del servidor SQL</h3>
                    <p className={styles.cardHint}>SQL Server frente a otros programas de esa máquina · última hora</p>
                    {snap.sqlCpu.length === 0 ? (
                      <div className={styles.empty}>Sin datos de CPU.</div>
                    ) : (
                      <MetricLineChart
                        labels={snap.sqlCpu.map((r) => formatBucket(r.at, '1h'))}
                        unit="%"
                        suggestedMax={100}
                        height={200}
                        series={[
                          { label: 'SQL Server', colorIndex: 0, values: snap.sqlCpu.map((r) => r.sqlCpuPct) },
                          { label: 'Otros programas', colorIndex: 1, values: snap.sqlCpu.map((r) => r.otherCpuPct) },
                        ]}
                      />
                    )}
                  </div>
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>Sesiones y consultas</h3>
                    <p className={styles.cardHint}>Conectadas, ejecutándose y bloqueadas en las bases SAPSEND</p>
                    {rangePoints.length < 2 ? (
                      <div className={styles.empty}>La gráfica aparece en unos segundos.</div>
                    ) : (
                      <MetricLineChart
                        labels={rangePoints.map((p) => timeLabel(p.at))}
                        unit=""
                        height={200}
                        series={[
                          { label: 'Sesiones', colorIndex: 0, values: rangePoints.map((p) => p.sapsendSessions) },
                          { label: 'Ejecutándose', colorIndex: 1, values: rangePoints.map((p) => p.sapsendRunning) },
                          { label: 'Bloqueadas', colorIndex: 2, values: rangePoints.map((p) => p.blocked) },
                        ]}
                      />
                    )}
                  </div>
                </div>
              </section>

              <section className={styles.section} aria-labelledby="ss-queries">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-queries" className={styles.sectionTitle}>
                    Consultas por SAPSEND
                  </h2>
                  <span className={styles.sectionHint}>Cada consulta de cada SAPSEND: cuántas veces, cuánto tarda y cuánto consume</span>
                </div>
                <SapsendQueries queries={snap.queries} runningNow={snap.runningNow} companyByDb={companyByDb} />
              </section>

              <section className={styles.section} aria-labelledby="ss-blocks">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-blocks" className={styles.sectionTitle}>
                    Bloqueos en el momento
                  </h2>
                  <span className={styles.sectionHint}>Cadena bloqueador → bloqueado</span>
                </div>
                <div className={styles.card}>
                  {snap.blocks.length === 0 ? (
                    <div className={styles.empty}>Sin bloqueos en las bases SAPSEND ahora.</div>
                  ) : (
                    <div className={styles.list}>
                      {snap.blocks.map((b, i) => (
                        <div key={`${b.blockingSessionId}-${b.blockedSessionId}-${i}`} className={styles.listRow}>
                          <Group justify="space-between" wrap="nowrap">
                            <span className={styles.rowTitle}>
                              Sesión {b.blockedSessionId} espera a la {b.blockingSessionId} ·{' '}
                              {companyByDb[String(b.database).toLowerCase()] ?? b.database}
                            </span>
                            <ToneChip tone={b.waitMs > 5000 ? 'critical' : 'warning'} label={formatMs(b.waitMs)} />
                          </Group>
                          <div className={styles.rowSub}>
                            Bloquea: {programLabel(b.blockingProgram ?? '') || '–'} · Espera: {programLabel(b.blockedProgram ?? '') || '–'} ·{' '}
                            {b.waitType ?? '–'}
                          </div>
                          {b.blockedSql && <div className={styles.queryText}>{b.blockedSql}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </Tabs.Panel>

            {/* ---------------- Servicios externos ---------------- */}
            <Tabs.Panel value="externos">
              <section className={styles.section} aria-labelledby="ss-ext">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-ext" className={styles.sectionTitle}>
                    Servicios externos
                  </h2>
                  <span className={styles.sectionHint}>SAPSEND productivo y Service Layer de cada empresa</span>
                </div>
                <div className={styles.grid2}>
                  <SignalTile
                    icon={<IconCloud size={15} />}
                    label="SAPSEND productivo"
                    value={snap.health.skipped ? 'Sin medir' : snap.health.ok ? formatMs(snap.health.latencyMs) : 'Caído'}
                    change={null}
                    polarity="up-is-bad"
                    trend={[]}
                    foot={snap.health.skipped ? 'Falta SAPSEND_MONITOR_URL con la dirección productiva' : snap.health.ok ? `${snap.urlHost} · HTTP ${snap.health.status}` : snap.health.error || 'Sin respuesta'}
                  />
                  <SignalTile
                    icon={<IconClockHour4 size={15} />}
                    label="Service Layer"
                    value={slCompanies.length ? (slDown ? `${slDown} caído(s)` : formatMs(slMax)) : '–'}
                    change={null}
                    polarity="up-is-bad"
                    trend={rangePoints.map((p) => p.slPulseMax)}
                    foot="el más lento de todas las empresas · pulso sin iniciar sesión"
                  />
                </div>
              </section>

              <section className={styles.section} aria-labelledby="ss-companies">
                <div className={styles.sectionHeader}>
                  <h2 id="ss-companies" className={styles.sectionTitle}>
                    Cada empresa
                  </h2>
                  <span className={styles.sectionHint}>Su SAPSEND (base) y su Service Layer</span>
                </div>
                <div className={styles.card}>
                  <Table.ScrollContainer minWidth={900}>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Estado</Table.Th>
                          <Table.Th>Empresa</Table.Th>
                          <Table.Th>Sesiones</Table.Th>
                          <Table.Th>Activas</Table.Th>
                          <Table.Th>Bloqueadas</Table.Th>
                          <Table.Th>Consultas/min</Table.Th>
                          <Table.Th>Lecturas / escrituras</Table.Th>
                          <Table.Th>Service Layer</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {companies.map((c) => (
                          <Table.Tr key={c.sapsendDb}>
                            <Table.Td>
                              <ToneChip tone={c.status} label={COMPANY_STATUS_LABEL[c.status]} />
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" fw={600}>
                                {c.company}
                              </Text>
                              <Text size="xs" c="dimmed" ff="monospace">
                                {c.sapsendDb}
                                {c.online ? '' : ' · fuera de línea'}
                              </Text>
                            </Table.Td>
                            <Table.Td>{formatInt(c.sapsend.sessions)}</Table.Td>
                            <Table.Td>{formatInt(c.sapsend.running)}</Table.Td>
                            <Table.Td>{formatInt(c.sapsend.blocked)}</Table.Td>
                            <Table.Td>{c.queries.perMin ? formatInt(Math.round(c.queries.perMin)) : '—'}</Table.Td>
                            <Table.Td>
                              <Text size="xs">
                                {formatInt(c.queries.reads)} / {formatInt(c.queries.writes)}
                              </Text>
                              <Text size="xs" c="dimmed">
                                ejecuciones en la última hora
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              {c.sl ? (
                                <Tooltip label={c.sl.pulse.error || `${c.sl.host} · HTTP ${c.sl.pulse.status}`} withArrow>
                                  <Text size="sm" fw={600} c={!c.sl.pulse.ok ? 'red' : (c.sl.pulse.latencyMs ?? 0) >= 3000 ? 'yellow.8' : 'teal'}>
                                    {c.sl.pulse.ok ? formatMs(c.sl.pulse.latencyMs) : 'Sin respuesta'}
                                  </Text>
                                </Tooltip>
                              ) : (
                                <Text size="xs" c="dimmed">
                                  Sin configurar
                                </Text>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </div>
                <p className={styles.cardHint} style={{ margin: '12px 4px 0' }}>
                  {snap.note}
                </p>
              </section>
            </Tabs.Panel>
          </Tabs>
        )}
      </div>
    </div>
  );
}
