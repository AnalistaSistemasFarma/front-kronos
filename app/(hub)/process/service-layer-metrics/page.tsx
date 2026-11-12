'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Loader,
  Alert,
  Table,
  Group,
  Card,
  Grid,
  Title,
  Text,
  Breadcrumbs,
  Anchor,
  Flex,
} from '@mantine/core';
import { IconAlertTriangle, IconChevronRight, IconServer2 } from '@tabler/icons-react';
import { Line } from 'react-chartjs-2';
import '../../../../lib/charts/register';
import {
  getMonthlySummary,
  type ServiceLayerMetricRow,
} from '../../../../lib/service-layer-metrics/metrics';

/**
 * Métricas diarias del SAP Business One Service Layer (OLP).
 *
 * Reemplaza el Excel manual que se venía sacando a mano cada día: tabla
 * fecha/día de semana/transacciones (igual que el Excel ya entregado a
 * Nicolás), resumen mensual y gráfica de línea de la serie completa.
 *
 * Datos: GET /api/service-layer-metrics (sembrados por el backfill
 * histórico y actualizados por el job diario en pce0023 -- ver
 * lib/service-layer-metrics/collectDailyMetric.ts).
 *
 * Módulo restringido (subprocess '/process/service-layer-metrics', ver
 * lib/service-layer-metrics/access.ts): es información técnica/operativa
 * interna, no un módulo de negocio abierto a toda la operación.
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

export default function ServiceLayerMetricsPage() {
  const { data: session } = useSession();

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<ServiceLayerMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const accessRes = await fetch('/api/service-layer-metrics/access');
        if (!accessRes.ok) throw new Error('No se pudo verificar el acceso al módulo');
        const accessData = await accessRes.json();
        setHasAccess(Boolean(accessData.canAccess));
        if (!accessData.canAccess) return;

        const metricsRes = await fetch('/api/service-layer-metrics');
        if (!metricsRes.ok) throw new Error('No se pudieron cargar las métricas');
        const metricsData = await metricsRes.json();
        setMetrics(metricsData.metrics ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error inesperado');
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

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

  const breadcrumbItems = [
    { title: 'Procesos', href: '/process' },
    { title: 'Métricas Service Layer', href: '#' },
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
      <Alert color="red" title="Métricas Service Layer" mt="md">
        No tiene acceso a este módulo.
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Métricas Service Layer" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Card shadow="sm" p="xl" radius="md" withBorder mb="6">
          <Breadcrumbs separator={<IconChevronRight size={16} />} className="mb-4">
            {breadcrumbItems}
          </Breadcrumbs>

          <Flex justify="space-between" align="center" mb="4" wrap="wrap" gap="sm">
            <div>
              <Title order={1} className="text-3xl font-bold mb-2 flex items-center gap-3">
                <IconServer2 size={32} className="text-blue-600" />
                Métricas Service Layer (OLP)
              </Title>
              <Text size="lg" c="dimmed">
                Transacciones diarias del SAP Business One Service Layer de One Latam Pharma
              </Text>
            </div>
          </Flex>

          <Grid>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Card p="md" radius="md" withBorder style={{ backgroundColor: 'var(--mantine-color-blue-light)' }}>
                <Text size="xs" c="var(--mantine-color-blue-light-color)">
                  Días con dato
                </Text>
                <Text size="lg" fw={600}>
                  {formatNumber(totals.totalDays)}
                </Text>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Card p="md" radius="md" withBorder style={{ backgroundColor: 'var(--mantine-color-green-light)' }}>
                <Text size="xs" c="var(--mantine-color-green-light-color)">
                  Total de transacciones
                </Text>
                <Text size="lg" fw={600}>
                  {formatNumber(totals.totalTransactions)}
                </Text>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Card p="md" radius="md" withBorder style={{ backgroundColor: 'var(--mantine-color-orange-light)' }}>
                <Text size="xs" c="var(--mantine-color-orange-light-color)">
                  Promedio diario
                </Text>
                <Text size="lg" fw={600}>
                  {formatNumber(totals.averagePerDay)}
                </Text>
              </Card>
            </Grid.Col>
          </Grid>
        </Card>

        {metrics.length === 0 ? (
          <Alert color="gray" icon={<IconAlertTriangle size={16} />} mb="6">
            Todavía no hay métricas cargadas.
          </Alert>
        ) : (
          <>
            <Card shadow="sm" p="lg" radius="md" withBorder mb="6">
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

            <Card shadow="sm" p="lg" radius="md" withBorder mb="6">
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
      </div>
    </div>
  );
}
