'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Code, Group, SegmentedControl, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconClockHour4,
  IconInfoCircle,
  IconLock,
  IconRefresh,
  IconServer,
  IconTransfer,
  IconUsers,
} from '@tabler/icons-react';
import { MetricLineChart, type LineSeries } from '../MetricLineChart';
import { ToneChip } from '../StatusHero';
import type { StatusTone } from '../colors';
import { formatAgo, formatBucket, formatDateTime, formatInt, formatMs, formatValue } from '../format';
import type { RangeKey } from '../types';
import styles from '../monitor.module.css';
import { rankViews, type ViewRank } from '../../../lib/sap-monitor/viewRank';

/**
 * Tabs «Base de datos SAP», «Vistas SAP» and «Service Layer» of the Monitor del sistema.
 * They read only what the SAP monitor stored in KRONOSDB (GET /api/system-metrics/sap): opening
 * the screen never queries SAP.
 */

type Config = {
  sqlConfigured: boolean;
  ingestConfigured: boolean;
  job: { enabled: boolean; lastRunAt: string | null; lastError: string | null; pausedReason: string | null; lastProbeMs: number | null };
};
type ApiResponse<T> = { part: string; range: RangeKey; config: Config; tablesMissing: boolean; data: T | null };

function useSapPart<T>(part: 'db' | 'views' | 'sl', range: RangeKey) {
  const [res, setRes] = useState<ApiResponse<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/system-metrics/sap?part=${part}&range=${range}`);
      if (!r.ok) throw new Error('No se pudo leer el monitor SAP');
      setRes(await r.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [part, range]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);
  return { res, loading, error, load };
}

const secText = (s: number | null | undefined) => (s == null ? '–' : formatMs(s * 1000));

function toneFor(value: number | null | undefined, warning: number, critical: number): StatusTone {
  if (value == null) return 'idle';
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'ok';
}

function Tile({ icon, label, value, foot, tone }: { icon: React.ReactNode; label: string; value: string; foot?: string; tone: StatusTone }) {
  return (
    <div className={styles.signal}>
      <div className={styles.signalLabel}>
        {icon}
        {label}
      </div>
      <div className={styles.signalValue}>{value}</div>
      <div className={styles.signalFoot}>
        <ToneChip tone={tone} label={tone === 'ok' ? 'Normal' : tone === 'warning' ? 'Atención' : tone === 'critical' ? 'Crítico' : 'Sin datos'} />
        {foot && <span>{foot}</span>}
      </div>
    </div>
  );
}

function Header({ id, title, hint, loading, onRefresh, chips }: { id: string; title: string; hint?: string; loading: boolean; onRefresh: () => void; chips?: React.ReactNode }) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {hint && <p className={styles.sectionHint}>{hint}</p>}
      </div>
      <Group gap="xs">
        {chips}
        <Tooltip label="Actualizar">
          <ActionIcon variant="subtle" radius="xl" loading={loading} onClick={onRefresh} aria-label={`Actualizar ${title}`}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </div>
  );
}

function SetupNotices({ res, error, need }: { res: ApiResponse<unknown> | null; error: string | null; need: 'sql' | 'ingest' }) {
  return (
    <>
      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="md" radius="lg">
          {error}
        </Alert>
      )}
      {res?.tablesMissing && (
        <Alert color="yellow" icon={<IconInfoCircle size={16} />} title="Monitor SAP aún no habilitado" mb="md" radius="lg">
          Faltan las tablas <Code>sap_monitor_*</Code> (<Code>prisma/manual/2026-11-20-monitor-sap-*.sql</Code>).
        </Alert>
      )}
      {res && !res.tablesMissing && need === 'sql' && !res.config.sqlConfigured && (
        <Alert color="gray" icon={<IconInfoCircle size={16} />} title="Falta la conexión al SQL de SAP" mb="md" radius="lg">
          Infraestructura debe crear el usuario de solo lectura (<Code>VIEW SERVER STATE</Code>) y cargar{' '}
          <Code>SAP_SQL_MONITOR_URL</Code> en el <Code>.env</Code>. Mientras tanto aquí solo se ve lo ya guardado.
        </Alert>
      )}
      {res && !res.tablesMissing && need === 'ingest' && !res.config.ingestConfigured && (
        <Alert color="gray" icon={<IconInfoCircle size={16} />} title="El recolector del Service Layer aún no envía datos" mb="md" radius="lg">
          Falta <Code>SAP_MONITOR_INGEST_KEYS</Code> en el <Code>.env</Code> y activar el recolector del Mac de horus
          (<Code>com.horus.monitor-sap</Code>). Lee los logs del Service Layer por SSH, sin tareas en el servidor de SAP.
        </Alert>
      )}
      {res?.config.job.lastError && need === 'sql' && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="La última lectura del SQL de SAP falló" mb="md" radius="lg">
          {res.config.job.lastError}
        </Alert>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Base de datos SAP
// ---------------------------------------------------------------------------

type Victim = { sessionId: number; waitType: string | null; waitMs: number; waitResource: string | null; hostName: string | null; programName: string | null; statement: string | null };
type Chain = {
  head: { sessionId: number; status: string | null; hostName: string | null; loginName: string | null; programName: string | null; databaseName: string | null; idleSec: number | null; lastStatement: string | null; openTransactions: number; locks?: number | null };
  maxWaitSec: number;
  blockedCount: number;
  victims: Victim[];
};
type LongReq = { sessionId: number; runningSec: number; databaseName: string | null; hostName: string | null; loginName: string | null; programName: string | null; waitType: string | null; statement: string | null };
type OpenTx = { sessionId: number; openSec: number; databaseName: string | null; hostName: string | null; loginName: string | null; programName: string | null; sessionStatus: string | null; lastStatement: string | null; locks: number | null };
type DbData = {
  latest: {
    sampledAt: string | null;
    probeMs: number | null;
    userSessions: number | null;
    blocked: number | null;
    maxBlockSec: number | null;
    longRequests: number | null;
    maxRequestSec: number | null;
    openTx: number | null;
    maxTxSec: number | null;
    waits: Array<{ waitType: string; waitMs: number; tasks: number }>;
    detail: { chains?: Chain[]; longRequests?: LongReq[]; openTx?: OpenTx[]; hasServerState?: boolean } | null;
    error: string | null;
  } | null;
  series: Array<{ bucket: string; blocked: number | null; maxBlockSec: number | null; longRequests: number | null; maxRequestSec: number | null; openTx: number | null; maxTxSec: number | null; probeMs: number | null; errors: number }>;
  incidents: Array<{ id: number; kind: string; firstSeen: string | null; lastSeen: string | null; maxSeconds: number; maxBlocked: number | null; sessionId: number | null; databaseName: string | null; hostName: string | null; loginName: string | null; programName: string | null; statement: string | null }>;
  alerts: Array<{ raisedAt: string | null; rule: string; severity: string; title: string; happening: string; notified: number }>;
};

const KIND_LABEL: Record<string, string> = { bloqueo: 'Bloqueo', consulta: 'Consulta larga', transaccion: 'Transacción abierta' };
const who = (o: { hostName: string | null; loginName: string | null; programName: string | null }) =>
  [o.hostName, o.loginName, o.programName].filter(Boolean).join(' · ') || 'origen desconocido';

export function SapDatabasePanel({ range }: { range: RangeKey }) {
  const { res, loading, error, load } = useSapPart<DbData>('db', range);
  const d = res?.data;
  const latest = d?.latest;
  const stale = latest?.sampledAt ? Date.now() - Date.parse(latest.sampledAt) > 5 * 60_000 : true;
  const detail = latest?.detail;

  const labels = useMemo(() => (d?.series ?? []).map((r) => formatBucket(r.bucket, range)), [d, range]);
  const timeSeries: LineSeries[] = useMemo(
    () => [
      { label: 'Bloqueo más largo (s)', colorIndex: 2, values: (d?.series ?? []).map((r) => r.maxBlockSec) },
      { label: 'Consulta más larga (s)', colorIndex: 1, values: (d?.series ?? []).map((r) => r.maxRequestSec) },
      { label: 'Transacción más vieja (s)', colorIndex: 0, values: (d?.series ?? []).map((r) => r.maxTxSec) },
    ],
    [d]
  );
  const countSeries: LineSeries[] = useMemo(
    () => [
      { label: 'Consultas bloqueadas', colorIndex: 2, values: (d?.series ?? []).map((r) => r.blocked) },
      { label: 'Consultas > 2 min', colorIndex: 1, values: (d?.series ?? []).map((r) => r.longRequests) },
      { label: 'Transacciones > 1 min', colorIndex: 0, values: (d?.series ?? []).map((r) => r.openTx) },
    ],
    [d]
  );

  return (
    <section id="sap-db" className={styles.section} aria-labelledby="sm-sap-db">
      <Header
        id="sm-sap-db"
        title="Base de datos SAP"
        hint="SQL Server de SAP, leído cada minuto con vistas del sistema (solo lectura, sin tocar tablas de SAP)."
        loading={loading}
        onRefresh={() => void load()}
        chips={
          latest?.sampledAt ? (
            <ToneChip tone={stale ? 'warning' : 'info'} label={`Foto ${formatAgo(latest.sampledAt)}${latest.probeMs != null ? ` · ${formatInt(latest.probeMs)} ms` : ''}`} />
          ) : null
        }
      />
      <SetupNotices res={res} error={error} need="sql" />
      {detail?.hasServerState === false && (
        <Alert color="yellow" icon={<IconInfoCircle size={16} />} title="Datos parciales" mb="md" radius="lg">
          El usuario del monitor no tiene <Code>VIEW SERVER STATE</Code> en el SQL de SAP: solo ve su propia sesión.
        </Alert>
      )}
      {latest?.error && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Última lectura fallida" mb="md" radius="lg">
          {latest.error}
        </Alert>
      )}

      <div className={styles.grid4}>
        <Tile
          icon={<IconLock size={15} />}
          label="Bloqueos ahora"
          value={latest?.blocked != null ? formatInt(latest.blocked) : '–'}
          foot={latest?.maxBlockSec ? `espera máx. ${secText(latest.maxBlockSec)}` : undefined}
          tone={latest?.blocked == null ? 'idle' : toneFor(latest.maxBlockSec, 30, 120)}
        />
        <Tile
          icon={<IconClockHour4 size={15} />}
          label="Consultas > 2 min"
          value={latest?.longRequests != null ? formatInt(latest.longRequests) : '–'}
          foot={latest?.maxRequestSec ? `la más larga ${secText(latest.maxRequestSec)}` : undefined}
          tone={latest?.longRequests == null ? 'idle' : toneFor(latest.maxRequestSec, 120, 300)}
        />
        <Tile
          icon={<IconTransfer size={15} />}
          label="Transacciones > 1 min"
          value={latest?.openTx != null ? formatInt(latest.openTx) : '–'}
          foot={latest?.maxTxSec ? `la más vieja ${secText(latest.maxTxSec)}` : undefined}
          tone={latest?.openTx == null ? 'idle' : toneFor(latest.maxTxSec, 60, 300)}
        />
        <Tile
          icon={<IconUsers size={15} />}
          label="Sesiones conectadas"
          value={latest?.userSessions != null ? formatInt(latest.userSessions) : '–'}
          foot="todas las bases del SQL de SAP"
          tone={latest?.userSessions == null ? 'idle' : 'ok'}
        />
      </div>

      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Cadenas de bloqueo</h3>
          <p className={styles.cardHint}>La «cabeza» es quien retiene; debajo, quién está esperando.</p>
          {!detail?.chains?.length ? (
            <div className={styles.empty}>Sin bloqueos en la última lectura.</div>
          ) : (
            <div className={styles.list}>
              {detail.chains.map((c) => (
                <div key={c.head.sessionId} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowTitle}>
                      Sesión {c.head.sessionId} bloquea a {formatInt(c.blockedCount)}
                    </span>
                    <ToneChip tone={toneFor(c.maxWaitSec, 30, 120)} label={secText(c.maxWaitSec)} />
                  </Group>
                  <div className={styles.rowSub}>
                    {who(c.head)} · {c.head.databaseName ?? '–'}
                    {c.head.status === 'sleeping' ? ' · inactiva con transacción abierta' : ''}
                    {c.head.locks != null ? ` · ${formatInt(c.head.locks)} bloqueos retenidos` : ''}
                  </div>
                  {c.head.lastStatement && <div className={styles.queryText}>{c.head.lastStatement}</div>}
                  {c.victims.slice(0, 4).map((v) => (
                    <div key={v.sessionId} className={styles.rowSub} style={{ marginTop: 6 }}>
                      ↳ {v.sessionId} espera {formatMs(v.waitMs)} ({v.waitType ?? '–'}) · {v.hostName ?? '–'} · {v.waitResource ?? ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Consultas largas y transacciones abiertas</h3>
          <p className={styles.cardHint}>Consultas de más de 2 minutos y transacciones de más de 1 minuto.</p>
          {!detail?.longRequests?.length && !detail?.openTx?.length ? (
            <div className={styles.empty}>Nada pendiente en la última lectura.</div>
          ) : (
            <div className={styles.list}>
              {(detail?.longRequests ?? []).map((r) => (
                <div key={`q${r.sessionId}`} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowTitle}>Consulta · sesión {r.sessionId}</span>
                    <ToneChip tone={toneFor(r.runningSec, 120, 300)} label={secText(r.runningSec)} />
                  </Group>
                  <div className={styles.rowSub}>
                    {who(r)} · {r.databaseName ?? '–'} · {r.waitType ?? 'ejecutando'}
                  </div>
                  {r.statement && <div className={styles.queryText}>{r.statement}</div>}
                </div>
              ))}
              {(detail?.openTx ?? []).map((t) => (
                <div key={`t${t.sessionId}`} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowTitle}>Transacción · sesión {t.sessionId}</span>
                    <ToneChip tone={toneFor(t.openSec, 60, 300)} label={secText(t.openSec)} />
                  </Group>
                  <div className={styles.rowSub}>
                    {who(t)} · {t.databaseName ?? '–'} · {t.sessionStatus ?? '–'}
                    {t.locks != null ? ` · ${formatInt(t.locks)} bloqueos` : ''}
                  </div>
                  {t.lastStatement && <div className={styles.queryText}>{t.lastStatement}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Historia: duración (segundos)</h3>
          <p className={styles.cardHint}>Lo más largo de cada ventana.</p>
          {labels.length ? <MetricLineChart labels={labels} series={timeSeries} unit="s" /> : <div className={styles.empty}>Sin datos en el periodo.</div>}
        </div>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Historia: cantidad</h3>
          <p className={styles.cardHint}>Máximo de cada ventana.</p>
          {labels.length ? <MetricLineChart labels={labels} series={countSeries} unit="" /> : <div className={styles.empty}>Sin datos en el periodo.</div>}
        </div>
      </div>

      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Incidentes del periodo</h3>
          <p className={styles.cardHint}>Uno por bloqueo, consulta o transacción (no uno por minuto).</p>
          {!d?.incidents.length ? (
            <div className={styles.empty}>Sin incidentes en el periodo.</div>
          ) : (
            <div className={styles.list}>
              {d.incidents.slice(0, 30).map((i) => (
                <div key={i.id} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowTitle}>
                      {KIND_LABEL[i.kind] ?? i.kind} · sesión {i.sessionId ?? '–'}
                    </span>
                    <ToneChip
                      tone={i.kind === 'bloqueo' ? toneFor(i.maxSeconds, 30, 120) : toneFor(i.maxSeconds, i.kind === 'consulta' ? 120 : 60, 300)}
                      label={secText(i.maxSeconds)}
                    />
                  </Group>
                  <div className={styles.rowSub}>
                    {formatDateTime(i.firstSeen)} → {formatDateTime(i.lastSeen)} · {who(i)} · {i.databaseName ?? '–'}
                    {i.maxBlocked ? ` · hasta ${formatInt(i.maxBlocked)} esperando` : ''}
                  </div>
                  {i.statement && <div className={styles.queryText}>{i.statement}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Esperas del último minuto</h3>
          <p className={styles.cardHint}>En qué esperó el SQL de SAP (sin esperas de fondo). LCK = bloqueos; PAGEIOLATCH = disco.</p>
          {!latest?.waits?.length ? (
            <div className={styles.empty}>Sin esperas relevantes.</div>
          ) : (
            <div className={styles.list}>
              {latest.waits.map((w) => (
                <div key={w.waitType} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowMono}>{w.waitType}</span>
                    <span className={styles.rowMetric}>{formatMs(w.waitMs)}</span>
                  </Group>
                </div>
              ))}
            </div>
          )}
          <h3 className={styles.cardTitle} style={{ marginTop: 20 }}>
            Alertas SAP enviadas
          </h3>
          {!d?.alerts.length ? (
            <div className={styles.empty}>Ninguna en el periodo.</div>
          ) : (
            <div className={styles.list}>
              {d.alerts.map((a, idx) => (
                <div key={`${a.raisedAt}-${idx}`} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowTitle}>{a.title}</span>
                    <ToneChip tone={a.severity === 'critical' ? 'critical' : 'warning'} label={formatAgo(a.raisedAt)} />
                  </Group>
                  <div className={styles.rowSub}>{a.happening}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vistas SAP
// ---------------------------------------------------------------------------

type ViewsData = {
  sql: Array<{ databaseName: string; viewName: string; executions: number; elapsedMs: number; cpuMs: number; reads: number; maxElapsedMs: number; lastExecutionAt: string | null }>;
  sl: Array<{ viewName: string; sourceIp: string; company: string | null; calls: number; errors: number; timeouts: number; totalMs: number; maxMs: number; bytes: number; lastCall: string | null }>;
  trend: Array<{ bucket: string; viewName: string; calls: number; timeouts: number; totalMs: number }>;
  inventory: { views: number; databases: number; refreshedAt: string | null };
  lastSnapshotAt: string | null;
};

type SortKey = 'tiempo' | 'timeouts' | 'llamadas' | 'lecturas';
const SORTERS: Record<SortKey, (v: ViewRank) => number> = {
  tiempo: (v) => Math.max(v.slTotalMs, v.sqlElapsedMs),
  timeouts: (v) => v.slTimeouts * 1e12 + v.slTotalMs,
  llamadas: (v) => Math.max(v.slCalls, v.sqlExecutions),
  lecturas: (v) => v.sqlReads,
};
const SOURCE_HINT: Record<string, string> = {
  '192.168.10.5': 'serfarma05 (SAPSEND, SynerLink, conectores)',
  '192.168.10.11': 'puerta de enlace (Power BI / Power Automate / nube)',
};

export function SapViewsPanel({ range }: { range: RangeKey }) {
  const { res, loading, error, load } = useSapPart<ViewsData>('views', range);
  const [sort, setSort] = useState<SortKey>('tiempo');
  const d = res?.data;
  const ranked = useMemo(() => (d ? rankViews(d).sort((a, b) => SORTERS[sort](b) - SORTERS[sort](a)) : []), [d, sort]);
  const top = ranked.slice(0, 5);

  const buckets = useMemo(() => [...new Set((d?.trend ?? []).map((t) => t.bucket))].sort(), [d]);
  const trendSeries: LineSeries[] = useMemo(
    () =>
      top.map((v, i) => ({
        label: v.viewName,
        colorIndex: i,
        values: buckets.map((b) => {
          const row = d?.trend.find((t) => t.bucket === b && t.viewName.toLowerCase() === v.viewName.toLowerCase());
          return row ? Math.round(row.totalMs / 1000) : 0;
        }),
      })),
    [top, buckets, d]
  );
  const totalTimeouts = ranked.reduce((s, v) => s + v.slTimeouts, 0);

  return (
    <section id="sap-vistas" className={styles.section} aria-labelledby="sm-sap-views">
      <Header
        id="sm-sap-views"
        title="Vistas SAP"
        hint="¿Nos están impactando las vistas *B1SLQuery? Costo en el SQL de SAP (caché de planes, cada 15 min) y llamadas por el Service Layer (logs, cada 5 min)."
        loading={loading}
        onRefresh={() => void load()}
        chips={
          <>
            {totalTimeouts > 0 && <ToneChip tone="critical" label={`${formatInt(totalTimeouts)} timeouts`} />}
            {d?.inventory.views ? <ToneChip tone="info" label={`${formatInt(d.inventory.views)} vistas en ${formatInt(d.inventory.databases)} bases`} /> : null}
          </>
        }
      />
      <SetupNotices res={res} error={error} need="ingest" />

      <div className={styles.card}>
        <Group justify="space-between" wrap="wrap" gap="sm" mb="sm">
          <div>
            <h3 className={styles.cardTitle}>Ranking</h3>
            <p className={styles.cardHint}>
              Llamadas y tiempos del Service Layer · ejecuciones, tiempo y lecturas en SQL
              {d?.lastSnapshotAt ? ` · caché leída ${formatAgo(d.lastSnapshotAt)}` : ''}
            </p>
          </div>
          <SegmentedControl
            size="xs"
            radius="xl"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            data={[
              { value: 'tiempo', label: 'Tiempo' },
              { value: 'timeouts', label: 'Timeouts' },
              { value: 'llamadas', label: 'Llamadas' },
              { value: 'lecturas', label: 'Lecturas' },
            ]}
          />
        </Group>
        {!ranked.length ? (
          <div className={styles.empty}>Sin llamadas a vistas registradas en el periodo.</div>
        ) : (
          <div className={styles.list}>
            {ranked.slice(0, 40).map((v) => (
              <div key={v.viewName} className={styles.listRow}>
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <span className={styles.rowTitle} style={{ wordBreak: 'break-all' }}>
                    {v.viewName}
                  </span>
                  {v.slTimeouts > 0 ? (
                    <ToneChip tone="critical" label={`${formatInt(v.slTimeouts)} timeouts`} />
                  ) : (
                    <ToneChip tone={toneFor(v.slMaxMs / 1000, 30, 120)} label={`máx. ${formatMs(Math.max(v.slMaxMs, v.sqlMaxMs))}`} />
                  )}
                </Group>
                <div className={styles.rowSub}>
                  {v.slCalls ? `${formatInt(v.slCalls)} llamadas SL · prom. ${formatMs(v.slTotalMs / v.slCalls)} · total ${formatMs(v.slTotalMs)}` : 'Sin llamadas por el Service Layer'}
                  {v.sqlExecutions
                    ? ` · SQL: ${formatInt(v.sqlExecutions)} ejec. · ${formatMs(v.sqlElapsedMs)} · ${formatValue(v.sqlReads / 1_000_000, 1)} M lecturas`
                    : ''}
                  {v.databases.length ? ` · ${v.databases.join(', ')}` : ''}
                  {v.lastSeen ? ` · última ${formatAgo(v.lastSeen)}` : ''}
                </div>
                {v.sources.length > 0 && (
                  <div className={styles.pills} style={{ marginTop: 8 }}>
                    {v.sources.slice(0, 4).map((s) => (
                      <Tooltip key={s.ip} label={SOURCE_HINT[s.ip] ?? 'Origen'}>
                        <span className={styles.pill}>
                          {s.ip} · {formatInt(s.calls)}
                          {s.timeouts ? ` · ${formatInt(s.timeouts)} timeouts` : ''}
                        </span>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <h3 className={styles.cardTitle}>Tendencia: tiempo en el Service Layer (s) de las 5 primeras</h3>
        <p className={styles.cardHint}>Segundos sumados de todas las llamadas de cada ventana. Un escalón alto y repetido es un reintento en bucle.</p>
        {buckets.length ? (
          <MetricLineChart labels={buckets.map((b) => formatBucket(b, range))} series={trendSeries} unit="s" />
        ) : (
          <div className={styles.empty}>Sin datos en el periodo.</div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Service Layer
// ---------------------------------------------------------------------------

type SlData = {
  nodes: Array<{ service: string; pid: number; handles: number; memMb: number; threads: number | null; startedAt: string | null; sampledAt: string | null }>;
  series: Array<{ bucket: string; maxHandles: number | null; avgHandles: number | null; maxMemMb: number | null }>;
  sessions: Array<{ sourceIp: string; company: string; user: string; logins: number; logouts: number; restores: number; failures: number }>;
  hourly: Array<{ bucket: string; logins: number; logouts: number; restores: number }>;
};

export function SapServiceLayerPanel({ range }: { range: RangeKey }) {
  const { res, loading, error, load } = useSapPart<SlData>('sl', range);
  const d = res?.data;
  const byService = useMemo(() => {
    const map = new Map<string, { service: string; handles: number; memMb: number; pid: number; startedAt: string | null }>();
    for (const n of d?.nodes ?? []) {
      const cur = map.get(n.service);
      if (!cur || n.handles > cur.handles) map.set(n.service, { service: n.service, handles: n.handles, memMb: n.memMb, pid: n.pid, startedAt: n.startedAt });
    }
    return [...map.values()].sort((a, b) => a.service.localeCompare(b.service));
  }, [d]);
  const sampledAt = d?.nodes[0]?.sampledAt ?? null;
  const maxHandles = byService.reduce((m, n) => Math.max(m, n.handles), 0);

  return (
    <section id="sap-sl" className={styles.section} aria-labelledby="sm-sap-sl">
      <Header
        id="sm-sap-sl"
        title="Service Layer"
        hint="Nodos b1s500xx de serfarma07: handles y memoria, y sesiones abiertas contra cerradas. Lo lee el recolector del Mac de horus por SSH (solo lectura)."
        loading={loading}
        onRefresh={() => void load()}
        chips={sampledAt ? <ToneChip tone={Date.now() - Date.parse(sampledAt) > 15 * 60_000 ? 'warning' : 'info'} label={`Foto ${formatAgo(sampledAt)}`} /> : null}
      />
      <SetupNotices res={res} error={error} need="ingest" />

      <div className={styles.card}>
        <Group justify="space-between" wrap="nowrap">
          <h3 className={styles.cardTitle}>Handles por nodo</h3>
          {byService.length > 0 && <ToneChip tone={toneFor(maxHandles, 5000, 6000)} label={`máx. ${formatInt(maxHandles)}`} />}
        </Group>
        <p className={styles.cardHint}>Sano: menos de 2.000. Atención desde 5.000; crítico desde 6.000 (SAP lento o congelado).</p>
        {!byService.length ? (
          <div className={styles.empty}>Sin datos del Service Layer.</div>
        ) : (
          <div className={styles.list}>
            {byService.map((n) => {
              const tone = toneFor(n.handles, 5000, 6000);
              return (
                <div key={n.service} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowTitle}>
                      <IconServer size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                      {n.service === 'b1s50000' ? 'b1s50000 (balanceador)' : n.service}
                    </span>
                    <span className={styles.rowMetric}>{formatInt(n.handles)}</span>
                  </Group>
                  <div className={styles.shareTrack} style={{ marginTop: 8 }}>
                    <div className={styles.shareFill} style={{ width: `${Math.min(100, (n.handles / 7000) * 100)}%`, background: `var(--sm-${tone === 'idle' ? 'info' : tone})` }} />
                  </div>
                  <div className={styles.rowSub}>
                    {formatInt(n.memMb)} MB · pid {n.pid}
                    {n.startedAt ? ` · arrancó ${formatAgo(n.startedAt)}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Historia de handles (nodos de trabajo)</h3>
          {d?.series.length ? (
            <MetricLineChart
              labels={d.series.map((r) => formatBucket(r.bucket, range))}
              series={[
                { label: 'Máximo', colorIndex: 2, values: d.series.map((r) => r.maxHandles) },
                { label: 'Promedio', colorIndex: 0, values: d.series.map((r) => (r.avgHandles == null ? null : Math.round(r.avgHandles))) },
              ]}
              unit=""
            />
          ) : (
            <div className={styles.empty}>Sin datos en el periodo.</div>
          )}
        </div>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Logins contra logouts por hora</h3>
          <p className={styles.cardHint}>Cada login sin logout deja una sesión viva hasta 60 minutos y suma handles.</p>
          {d?.hourly.length ? (
            <MetricLineChart
              labels={d.hourly.map((r) => formatBucket(r.bucket, range === '1h' || range === '6h' ? '24h' : range))}
              series={[
                { label: 'Logins', colorIndex: 1, values: d.hourly.map((r) => r.logins) },
                { label: 'Logouts', colorIndex: 0, values: d.hourly.map((r) => r.logouts) },
              ]}
              unit=""
            />
          ) : (
            <div className={styles.empty}>Sin datos en el periodo.</div>
          )}
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 16 }}>
        <h3 className={styles.cardTitle}>Sesiones por origen y empresa</h3>
        <p className={styles.cardHint}>Ordenado por sesiones que quedaron sin cerrar (logins − logouts).</p>
        {!d?.sessions.length ? (
          <div className={styles.empty}>Sin sesiones registradas en el periodo.</div>
        ) : (
          <div className={styles.list}>
            {d.sessions.slice(0, 30).map((s) => {
              const open = Math.max(0, s.logins - s.logouts);
              const pct = s.logins ? Math.round((open / s.logins) * 100) : 0;
              return (
                <div key={`${s.sourceIp}|${s.company}|${s.user}`} className={styles.listRow}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <span className={styles.rowTitle} style={{ wordBreak: 'break-all' }}>
                      {s.company}
                    </span>
                    <ToneChip tone={open === 0 ? 'ok' : pct >= 50 ? 'critical' : pct >= 20 ? 'warning' : 'info'} label={`${formatInt(open)} sin logout`} />
                  </Group>
                  <div className={styles.rowSub}>
                    {s.sourceIp}
                    {SOURCE_HINT[s.sourceIp] ? ` (${SOURCE_HINT[s.sourceIp]})` : ''} · usuario {s.user} · {formatInt(s.logins)} logins · {formatInt(s.logouts)} logouts ·{' '}
                    {formatInt(s.restores)} restauradas{s.failures ? ` · ${formatInt(s.failures)} fallidos` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
