'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  ThemeIcon,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuilding,
  IconChecklist,
  IconClockHour4,
  IconRepeat,
  IconSearch,
  IconTrendingUp,
} from '@tabler/icons-react';
import { ChartContainer } from '../dashboard/ChartContainer';
import { ChartCard } from '../dashboard/actividades/ActividadesUi';
import { useChartViewport } from '../dashboard/useChartViewport';
import {
  buildAreaLineChart,
  buildHorizontalMultiColorBarChart,
  buildPieChart,
  buildVerticalBarChart,
} from '../../lib/charts/builders';
import {
  buildPersonalActividadesAnalytics,
  formatResolutionDuration,
  PROCESS_COLORS,
  PERSONAL_CHART_ACCENTS,
} from '../../lib/request-general/solicitadoAnalytics';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';
import { useSolicitadoData } from './SolicitadoShell';
import { PersonalInsightCard } from './PersonalInsightCard';
import {
  PersonalTimeTrendBlock,
  chartScrollMinWidth,
} from './PersonalTimeTrendBlock';
import { useSolicitadoChartEntranceKey } from './useSolicitadoChartsLoading';

function statusColor(status?: string) {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('resuelt') || s.includes('complet')) return 'green';
  if (s.includes('abiert') || s.includes('sin empezar')) return 'orange';
  if (s.includes('progreso') || s.includes('proceso')) return 'blue';
  if (s.includes('cancel')) return 'red';
  return 'gray';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO');
}

export function SolicitadoActividadesView() {
  const router = useRouter();
  const { activities, activityCounts } = useSolicitadoData();
  const entranceKey = useSolicitadoChartEntranceKey();
  const viewport = useChartViewport();
  const { palette, isDark } = useDashboardChartPalette();
  const [search, setSearch] = useState('');

  const analytics = useMemo(() => buildPersonalActividadesAnalytics(activities), [activities]);

  const timeByProcessChart = useMemo(() => {
    if (analytics.avgHoursByProcess.length === 0) return null;
    const items = analytics.avgHoursByProcess.map((p, i) => ({
      label: p.name,
      value: p.value,
      color: PROCESS_COLORS[i % PROCESS_COLORS.length],
    }));
    return buildHorizontalMultiColorBarChart(items, viewport.isMobile, {
      valueLabel: '',
      datasetLabel: 'Mi tiempo promedio',
      truncateLabels: true,
    });
  }, [analytics.avgHoursByProcess, viewport.isMobile]);

  const countByProcessChart = useMemo(() => {
    if (analytics.countByProcess.length === 0) return null;
    return buildVerticalBarChart(analytics.countByProcess, [...PERSONAL_CHART_ACCENTS.volumeBars], {
      datasetLabel: 'Mis actividades',
      labelSuffix: 'actividades',
      rotateLabels: analytics.countByProcess.length > 4,
    });
  }, [analytics.countByProcess]);

  const companyPie = useMemo(() => {
    if (analytics.companyPie.length === 0) return null;
    return buildPieChart(analytics.companyPie, {
      showLegend: true,
      cutout: '58%',
      borderColor: isDark ? '#1e293b' : '#ffffff',
    });
  }, [analytics.companyPie, isDark]);

  const frequencyChart = useMemo(() => {
    if (analytics.frequency.length === 0) return null;
    return buildAreaLineChart(analytics.frequency, PERSONAL_CHART_ACCENTS.frequencyActividades, {
      valueLabel: 'Actividades',
      fillAlpha: 0.32,
    });
  }, [analytics.frequency]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) =>
      [a.id, a.task, a.subject, a.process, a.company, a.status_task, a.requester]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [activities, search]);

  const cadenceLabel =
    analytics.kpis.cadenceDays == null
      ? 'Aún pocos datos'
      : analytics.kpis.cadenceDays < 1
        ? 'Varias al día'
        : `Cada ~${analytics.kpis.cadenceDays} día${analytics.kpis.cadenceDays === 1 ? '' : 's'}`;

  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing='md' mb='md'>
        <PersonalInsightCard
          label='Mi tiempo promedio'
          value={
            analytics.kpis.myAvgHours != null
              ? formatResolutionDuration(analytics.kpis.myAvgHours)
              : '—'
          }
          hint={`${activityCounts.resuelto} completadas`}
          icon={<IconClockHour4 size={20} />}
          color='cyan'
        />
        <PersonalInsightCard
          label='Ritmo de asignación'
          value={cadenceLabel}
          hint={`${analytics.kpis.total} actividades en total`}
          icon={<IconTrendingUp size={20} />}
          color='violet'
        />
        <PersonalInsightCard
          label='Proceso más recurrente'
          value={analytics.kpis.topProcess ?? '—'}
          hint='Donde más actividades tienes'
          icon={<IconRepeat size={20} />}
          color='blue'
        />
        <PersonalInsightCard
          label='Empresa más frecuente'
          value={analytics.kpis.topCompany ?? '—'}
          hint='De dónde salen más tareas tuyas'
          icon={<IconBuilding size={20} />}
          color='teal'
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='md' mb='md'>
        <ChartCard
          title='Mi demora por proceso'
          description='Cuánto te demoras en promedio en actividades de cada proceso'
          height='auto'
        >
          {timeByProcessChart ? (
            <ChartContainer
              entranceKey={`time-${entranceKey}`}
              type='bar'
              height={Math.max(220, analytics.avgHoursByProcess.length * 42)}
              minWidth={chartScrollMinWidth(analytics.avgHoursByProcess.length, 90, 480)}
              scrollable
              data={timeByProcessChart.data}
              options={{
                ...timeByProcessChart.options,
                plugins: {
                  ...timeByProcessChart.options.plugins,
                  tooltip: {
                    ...timeByProcessChart.options.plugins?.tooltip,
                    callbacks: {
                      title: timeByProcessChart.options.plugins?.tooltip?.callbacks?.title,
                      label: (ctx) =>
                        `Promedio: ${formatResolutionDuration(ctx.parsed.x ?? 0)}`,
                    },
                  },
                },
              }}
            />
          ) : (
            <Alert color='gray' variant='light'>
              Cuando completes actividades verás aquí tu tiempo por proceso.
            </Alert>
          )}
        </ChartCard>

        <ChartCard
          title='Empresas de mis actividades'
          description='Distribución de tus tareas por empresa'
          height='auto'
        >
          {companyPie ? (
            <ChartContainer
              entranceKey={`pie-${entranceKey}`}
              type='pie'
              height={280}
              data={companyPie.data}
              options={companyPie.options}
            />
          ) : (
            <Alert color='gray' variant='light'>
              Sin empresas asociadas todavía.
            </Alert>
          )}
        </ChartCard>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='md' mb='md'>
        <ChartCard
          title='Actividades por proceso'
          description='En qué procesos tienes más carga'
          height='auto'
        >
          {countByProcessChart ? (
            <ChartContainer
              entranceKey={`count-${entranceKey}`}
              type='bar'
              height={260}
              minWidth={chartScrollMinWidth(analytics.countByProcess.length, 80, 460)}
              scrollable
              data={countByProcessChart.data}
              options={countByProcessChart.options}
            />
          ) : (
            <Alert color='gray' variant='light'>
              Aún no hay actividades para graficar.
            </Alert>
          )}
        </ChartCard>

        <ChartCard
          title='Cada cuándo me asignan una'
          description='Frecuencia de nuevas actividades asignadas a ti'
          height='auto'
        >
          {frequencyChart ? (
            <ChartContainer
              entranceKey={`freq-${entranceKey}`}
              type='line'
              height={260}
              minWidth={chartScrollMinWidth(analytics.frequency.length, 88, 480)}
              scrollable
              data={frequencyChart.data}
              options={{
                ...frequencyChart.options,
                plugins: {
                  ...frequencyChart.options.plugins,
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `${ctx.parsed.y ?? 0} actividades`,
                    },
                  },
                },
              }}
            />
          ) : (
            <Alert color='gray' variant='light'>
              Sin fechas de inicio suficientes.
            </Alert>
          )}
        </ChartCard>
      </SimpleGrid>

      <PersonalTimeTrendBlock
        title='Cómo va mi tiempo en actividades'
        description='Tu demora al completar por periodo · flechas de subida / bajada'
        summary={analytics.myResolutionTrend}
        emptyMessage='Necesitas actividades cerradas con fechas para ver tu tendencia.'
        entranceKey={`trend-${entranceKey}`}
      />

      <Paper shadow='sm' p='md' radius='lg' withBorder mt='md'>
        <Group justify='space-between' mb='md' wrap='wrap'>
          <Group gap='xs'>
            <ThemeIcon variant='light' color='violet' radius='md'>
              <IconChecklist size={16} />
            </ThemeIcon>
            <Title order={4}>Listado de mis actividades</Title>
          </Group>
          <TextInput
            placeholder='Buscar...'
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ minWidth: 240 }}
          />
        </Group>

        {filtered.length === 0 ? (
          <Alert icon={<IconAlertCircle size={16} />} color='gray'>
            No hay actividades para mostrar.
          </Alert>
        ) : (
          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Actividad</Table.Th>
                  <Table.Th>Solicitud</Table.Th>
                  <Table.Th>Proceso</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Inicio</Table.Th>
                  <Table.Th>Cierre</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((row) => (
                  <Table.Tr
                    key={row.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() =>
                      router.push(`/process/request-general/view-activities?id=${row.id}`)
                    }
                  >
                    <Table.Td>
                      <Badge variant='light'>#{row.id}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500} lineClamp={1}>
                        {row.task || 'Sin actividad'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={0}>
                        <Text size='sm'>#{row.id_request_general}</Text>
                        <Text size='xs' c='dimmed' lineClamp={1}>
                          {row.subject || '—'}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>{row.process || '—'}</Table.Td>
                    <Table.Td>{row.company || '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(row.status_task)} variant='light'>
                        {row.status_task || '—'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatDate(row.start_date)}</Table.Td>
                    <Table.Td>{formatDate(row.date_resolution)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Paper>
    </>
  );
}
