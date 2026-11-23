'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Breadcrumbs,
  Group,
  Loader,
  Switch,
  Tabs,
  Text,
  Title,
  Table,
  Card,
  Grid,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconChevronRight,
  IconClockHour4,
  IconRefresh,
  IconServer2,
  IconUsers,
} from '@tabler/icons-react';
import { Line } from 'react-chartjs-2';
import '../../../../lib/charts/register';
import {
  getMonthlySummary,
  type ServiceLayerMetricRow,
} from '../../../../lib/service-layer-metrics/metrics';
import type {
  CompanySlRow,
  CompanySlStatus,
  ServiceLayerLiveSnapshot,
} from '../../../../lib/service-layer-metrics/live';
import { StatusHero, ToneChip } from '../../../../components/system-metrics/StatusHero';
import { SignalTile } from '../../../../components/system-metrics/SignalTile';
import type { Insight, Verdict } from '../../../../lib/system-metrics/insights';
import { formatAgo, formatInt, formatMs } from '../../../../components/system-metrics/format';
import styles from '../../../../components/system-metrics/monitor.module.css';

/**
 * Monitor Service Layer: en vivo (concurrencia/latencia por empresa desde esta
 * instancia) + histórico diario OLP (job SSH). Mismo permiso que antes
 * (/process/service-layer-metrics).
 */

const WEEKDAY_LABELS_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function weekdayLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return WEEKDAY_LABELS_ES[date.getUTCDay()];
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-CO').format(n);
}

const STATUS_LABEL: Record<CompanySlStatus, string> = {
  ok: 'Bien',
  warning: 'Atención',
  critical: 'Crítico',
  idle: 'Sin tráfico',
  inactive: 'Inactivo',
};

function verdictFromLive(snap: ServiceLayerLiveSnapshot | null): Verdict {
  if (!snap) {
    return { severity: 'info', headline: 'Cargando…', sub: '' };
  }
  if (snap.totals.critical > 0) {
    return {
      severity: 'critical',
      headline: `${snap.totals.critical} Service Layer con fallas`,
      sub: 'Hay empresas con muchos errores o sin respuesta en los últimos minutos.',
    };
  }
  if (snap.totals.warning > 0) {
    return {
      severity: 'warning',
      headline: `${snap.totals.warning} Service Layer bajo presión`,
      sub: 'Latencia alta, errores parciales o mucha concurrencia en alguna empresa.',
    };
  }
  if (snap.totals.ok > 0) {
    return {
      severity: 'ok',
      headline: 'Service Layer respondiendo bien',
      sub: `${snap.totals.inflight} llamadas en vuelo · ${snap.totals.openSessions} sesiones abiertas desde SynerLink.`,
    };
  }
  return {
    severity: 'info',
    headline: 'Sin tráfico SAP en esta instancia',
    sub: 'Aún no hay llamadas recientes al Service Layer desde este proceso. En cuanto alguien use compras, dashboards u otros módulos SAP, verá la concurrencia aquí.',
  };
}

function insightsFromLive(snap: ServiceLayerLiveSnapshot | null): Insight[] {
  if (!snap) return [];
  const out: Insight[] = [];
  for (const c of snap.companies.filter((x) => x.status === 'critical').slice(0, 5)) {
    out.push({
      id: `sl-crit-${c.idCompany}-${c.companyDB}`,
      severity: 'critical',
      area: 'externos',
      title: `${c.company}: fallas hacia ${c.companyDB}`,
      detail: `${c.errors5m} errores de ${c.requests5m} llamadas (5 min). Host ${c.host}.`,
    });
  }
  for (const c of snap.companies.filter((x) => x.status === 'warning').slice(0, 5)) {
    out.push({
      id: `sl-warn-${c.idCompany}-${c.companyDB}`,
      severity: 'warning',
      area: 'externos',
      title: `${c.company}: presión en ${c.companyDB}`,
      detail: `En vuelo ${c.inflight} (pico ${c.peakInflight}) · p95 ${c.p95Ms != null ? formatMs(c.p95Ms) : '—'}.`,
    });
  }
  if (snap.totals.openSessions > 0) {
    out.push({
      id: 'sl-sessions',
      severity: 'info',
      area: 'externos',
      title: `${snap.totals.openSessions} sesiones B1 abiertas`,
      detail: 'Sesiones Login de SynerLink que aún no hicieron Logout (o no expiraron).',
    });
  }
  return out;
}

type TabKey = 'vivo' | 'historico';

export default function ServiceLayerMetricsPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<TabKey>('vivo');
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<ServiceLayerMetricRow[]>([]);
  const [live, setLive] = useState<ServiceLayerLiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadAccessAndHistory = useCallback(async () => {
    if (!session) return;
    try {
      setLoading(true);
      setError(null);
      const accessRes = await fetch('/api/service-layer-metrics/access');
      if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al módulo');
      const accessData = await accessRes.json();
      setHasAccess(Boolean(accessData.canAccess));
      if (!accessData.canAccess) return;

      const metricsRes = await fetch('/api/service-layer-metrics');
      if (!metricsRes.ok) throw new Error('No se pudieron cargar las métricas históricas');
      const metricsData = await metricsRes.json();
      setMetrics(metricsData.metrics ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [session]);

  const loadLive = useCallback(async () => {
    if (!session || hasAccess === false) return;
    try {
      setLiveLoading(true);
      setLiveError(null);
      const res = await fetch('/api/service-layer-metrics/live', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo cargar el estado en vivo');
      setLive(await res.json());
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLiveLoading(false);
    }
  }, [session, hasAccess]);

  useEffect(() => {
    void loadAccessAndHistory();
  }, [loadAccessAndHistory]);

  useEffect(() => {
    if (hasAccess) void loadLive();
  }, [hasAccess, loadLive]);

  useEffect(() => {
    if (!autoRefresh || !hasAccess || tab !== 'vivo') return;
    // Pausado con la pestaña oculta; al volver se actualiza de una vez.
    const tick = () => {
      if (document.visibilityState === 'visible') void loadLive();
    };
    const id = window.setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [autoRefresh, hasAccess, tab, loadLive]);

  const monthlySummary = useMemo(() => getMonthlySummary(metrics), [metrics]);
  const totals = useMemo(() => {
    const totalTransactions = metrics.reduce((acc, m) => acc + m.transactionCount, 0);
    const totalDays = metrics.length;
    const averagePerDay = totalDays > 0 ? Math.round(totalTransactions / totalDays) : 0;
    return { totalTransactions, totalDays, averagePerDay };
  }, [metrics]);

  const chartData = useMemo(
    () => ({
      labels: metrics.map((m) => formatDate(m.date)),
      datasets: [
        {
          label: 'Transacciones diarias',
          data: metrics.map((m) => m.transactionCount),
          borderColor: 'var(--mantine-color-blue-6, #1c7ed6)',
          backgroundColor: 'rgba(28, 126, 214, 0.15)',
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    }),
    [metrics]
  );

  const verdict = verdictFromLive(live);
  const insights = insightsFromLive(live);

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Service Layer', href: '#' },
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
      <Alert color="red" title="Service Layer" mt="md">
        No tiene acceso a este módulo.
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Service Layer" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.container}>
        <Breadcrumbs separator={<IconChevronRight size={16} />} mb="sm">
          {breadcrumbItems}
        </Breadcrumbs>

        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>
              <span
                className={`${styles.liveDot} ${autoRefresh ? '' : styles.liveDotOff}`}
                aria-hidden
              />
              {autoRefresh ? 'En vivo' : 'Pausado'}
              {live?.sampledAt ? ` · actualizado ${formatAgo(live.sampledAt)}` : ''}
              {live ? ` · ${live.host}` : ''}
            </div>
            <h1 className={styles.largeTitle}>Monitor Service Layer</h1>
            <Text size="sm" c="dimmed" mt={4}>
              Todas las empresas · concurrencia y latencia desde SynerLink · histórico OLP
            </Text>
          </div>
          <div className={styles.headerControls}>
            <Switch
              label="En vivo"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
              size="sm"
            />
            <ActionIcon
              variant="light"
              radius="xl"
              size="lg"
              loading={liveLoading}
              onClick={() => void loadLive()}
              aria-label="Actualizar en vivo"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </div>
        </header>

        <Tabs value={tab} onChange={(v) => setTab((v as TabKey) || 'vivo')} mb="md">
          <Tabs.List className={styles.tabList} aria-label="Secciones Service Layer">
            <Tabs.Tab value="vivo">En vivo</Tabs.Tab>
            <Tabs.Tab value="historico">Histórico OLP</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="vivo" pt="md">
            {liveError && (
              <Alert color="orange" icon={<IconAlertTriangle size={16} />} mb="md" radius="lg">
                {liveError}
              </Alert>
            )}

            <StatusHero verdict={verdict} insights={insights} hasData={Boolean(live)} />

            {live && (
              <>
                <p className={styles.cardHint} style={{ margin: '12px 4px' }}>
                  {live.note} · PID {live.pid}
                </p>

                <div className={styles.grid4}>
                  <SignalTile
                    icon={<IconActivity size={14} />}
                    label="En vuelo ahora"
                    value={formatInt(live.totals.inflight)}
                    change={null}
                    polarity="up-is-bad"
                    trend={[]}
                    foot="Llamadas HTTP abiertas a SAP"
                  />
                  <SignalTile
                    icon={<IconUsers size={14} />}
                    label="Sesiones B1 abiertas"
                    value={formatInt(live.totals.openSessions)}
                    change={null}
                    polarity="neutral"
                    trend={[]}
                    foot="Login sin Logout / no expiradas"
                  />
                  <SignalTile
                    icon={<IconClockHour4 size={14} />}
                    label="Llamadas (5 min)"
                    value={formatInt(live.totals.requests5m)}
                    change={null}
                    polarity="neutral"
                    trend={[]}
                    foot={`${formatInt(live.totals.errors5m)} con error`}
                  />
                  <SignalTile
                    icon={<IconServer2 size={14} />}
                    label="Endpoints activos"
                    value={formatInt(live.totals.activeEndpoints)}
                    change={null}
                    polarity="up-is-good"
                    trend={[]}
                    foot={`${formatInt(live.totals.companies)} empresas`}
                  />
                </div>

                <section className={styles.section} aria-labelledby="sl-companies">
                  <div className={styles.sectionHeader}>
                    <h2 id="sl-companies" className={styles.sectionTitle}>
                      Por empresa
                    </h2>
                    <span className={styles.sectionHint}>
                      Estado · concurrencia · latencia p95 · última respuesta
                    </span>
                  </div>
                  <div className={styles.card}>
                    <Table.ScrollContainer minWidth={900}>
                      <Table striped highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Estado</Table.Th>
                            <Table.Th>Empresa</Table.Th>
                            <Table.Th>CompanyDB</Table.Th>
                            <Table.Th>Host</Table.Th>
                            <Table.Th>En vuelo</Table.Th>
                            <Table.Th>Sesiones</Table.Th>
                            <Table.Th>5 min</Table.Th>
                            <Table.Th>Errores</Table.Th>
                            <Table.Th>p95</Table.Th>
                            <Table.Th>Última</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {live.companies.map((c: CompanySlRow) => (
                            <Table.Tr key={`${c.idCompany}-${c.companyDB}-${c.host}`}>
                              <Table.Td>
                                <ToneChip
                                  tone={
                                    c.status === 'inactive'
                                      ? 'idle'
                                      : c.status === 'idle'
                                        ? 'idle'
                                        : c.status
                                  }
                                  label={STATUS_LABEL[c.status]}
                                />
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" fw={600}>
                                  {c.company}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {c.endpointName}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" ff="monospace">
                                  {c.companyDB}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Text size="xs" ff="monospace">
                                  {c.host}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                {c.inflight}
                                {c.peakInflight > c.inflight ? (
                                  <Text span size="xs" c="dimmed">
                                    {' '}
                                    (pico {c.peakInflight})
                                  </Text>
                                ) : null}
                              </Table.Td>
                              <Table.Td>{c.openSessions}</Table.Td>
                              <Table.Td>{c.requests5m}</Table.Td>
                              <Table.Td>{c.errors5m}</Table.Td>
                              <Table.Td>{c.p95Ms != null ? formatMs(c.p95Ms) : '—'}</Table.Td>
                              <Table.Td>
                                {c.lastAt
                                  ? formatAgo(new Date(c.lastAt).toISOString())
                                  : c.isActive
                                    ? 'Sin tráfico'
                                    : '—'}
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </div>
                </section>
              </>
            )}

            {!live && !liveError && (
              <Group gap="xs" mt="md">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Leyendo concurrencia de Service Layer…
                </Text>
              </Group>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="historico" pt="md">
            <Alert color="blue" mb="md" radius="lg">
              Serie diaria de transacciones del Service Layer de <strong>One Latam Pharma</strong>{' '}
              (conteo del log en serfarma07). No incluye las demás empresas.
            </Alert>

            <Grid mb="md">
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <Card p="md" radius="md" withBorder>
                  <Text size="xs" c="dimmed">
                    Días con dato
                  </Text>
                  <Text size="lg" fw={600}>
                    {formatNumber(totals.totalDays)}
                  </Text>
                </Card>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <Card p="md" radius="md" withBorder>
                  <Text size="xs" c="dimmed">
                    Total de transacciones
                  </Text>
                  <Text size="lg" fw={600}>
                    {formatNumber(totals.totalTransactions)}
                  </Text>
                </Card>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <Card p="md" radius="md" withBorder>
                  <Text size="xs" c="dimmed">
                    Promedio diario
                  </Text>
                  <Text size="lg" fw={600}>
                    {formatNumber(totals.averagePerDay)}
                  </Text>
                </Card>
              </Grid.Col>
            </Grid>

            {metrics.length === 0 ? (
              <Alert color="gray" icon={<IconAlertTriangle size={16} />}>
                Todavía no hay métricas históricas cargadas.
              </Alert>
            ) : (
              <>
                <Card shadow="sm" p="lg" radius="md" withBorder mb="md">
                  <Title order={3} mb="md">
                    Serie completa
                  </Title>
                  <div style={{ height: 320 }}>
                    <Line
                      data={chartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                          x: { ticks: { maxTicksLimit: 12 } },
                          y: { beginAtZero: true },
                        },
                      }}
                    />
                  </div>
                </Card>

                <Card shadow="sm" p="lg" radius="md" withBorder mb="md">
                  <Title order={3} mb="md">
                    Resumen mensual
                  </Title>
                  <Table.ScrollContainer minWidth={500}>
                    <Table striped highlightOnHover withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Mes</Table.Th>
                          <Table.Th>Días con dato</Table.Th>
                          <Table.Th>Total transacciones</Table.Th>
                          <Table.Th>Promedio diario</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {monthlySummary.map((row) => (
                          <Table.Tr key={row.month}>
                            <Table.Td>{row.month}</Table.Td>
                            <Table.Td>{row.daysWithData}</Table.Td>
                            <Table.Td>{formatNumber(row.totalTransactions)}</Table.Td>
                            <Table.Td>{formatNumber(row.averagePerDay)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>

                <Card shadow="sm" radius="md" withBorder className="overflow-hidden">
                  <Title order={3} mb="md">
                    Detalle diario
                  </Title>
                  <Table.ScrollContainer minWidth={500}>
                    <Table striped highlightOnHover withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Fecha</Table.Th>
                          <Table.Th>Día</Table.Th>
                          <Table.Th>Transacciones</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {[...metrics]
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((m) => (
                            <Table.Tr key={m.date}>
                              <Table.Td>{formatDate(m.date)}</Table.Td>
                              <Table.Td>{weekdayLabel(m.date)}</Table.Td>
                              <Table.Td>{formatNumber(m.transactionCount)}</Table.Td>
                            </Table.Tr>
                          ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>
              </>
            )}
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
