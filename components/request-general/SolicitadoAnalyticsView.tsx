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
  IconClockHour4,
  IconRepeat,
  IconSearch,
  IconTrendingUp,
  IconBriefcase,
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
  buildPersonalProcesosAnalytics,
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

export function SolicitadoProcesosView() {
  const router = useRouter();
  const { requests } = useSolicitadoData();
  const entranceKey = useSolicitadoChartEntranceKey();
  const viewport = useChartViewport();
  const { palette, isDark } = useDashboardChartPalette();
  const [search, setSearch] = useState('');

  const analytics = useMemo(() => buildPersonalProcesosAnalytics(requests), [requests]);

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
      datasetLabel: 'Procesos que me llegan',
      labelSuffix: 'solicitudes',
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
    return buildAreaLineChart(analytics.frequency, PERSONAL_CHART_ACCENTS.frequencyProcesos, {
      valueLabel: 'Procesos',
      fillAlpha: 0.32,
    });
  }, [analytics.frequency]);

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) =>
      [r.id, r.subject, r.process, r.category, r.company, r.status, r.requester]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [requests, search]);

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
          hint='En procesos que ya finalicé'
          icon={<IconClockHour4 size={20} />}
          color='cyan'
        />
        <PersonalInsightCard
          label='Ritmo de llegada'
          value={cadenceLabel}
          hint={`${analytics.kpis.total} procesos en total`}
          icon={<IconTrendingUp size={20} />}
          color='blue'
        />
        <PersonalInsightCard
          label='Proceso más frecuente'
          value={analytics.kpis.topProcess ?? '—'}
          hint='El que más te asignan'
          icon={<IconRepeat size={20} />}
          color='violet'
        />
        <PersonalInsightCard
          label='Empresa que más me pide'
          value={analytics.kpis.topCompany ?? '—'}
          hint='Quién más te solicita'
          icon={<IconBuilding size={20} />}
          color='teal'
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='md' mb='md'>
        <ChartCard
          title='Mi demora por tipo de proceso'
          description='Promedio de cuánto te tomas en cerrar cada proceso'
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
              Cuando finalices procesos verás aquí tu tiempo promedio por tipo.
            </Alert>
          )}
        </ChartCard>

        <ChartCard
          title='Empresas que me solicitan'
          description='De dónde vienen la mayoría de tus procesos'
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
          title='Qué procesos tengo / me llegan más'
          description='Volumen por tipo de proceso'
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
              Aún no hay procesos para graficar.
            </Alert>
          )}
        </ChartCard>

        <ChartCard
          title='Cada cuándo me llega uno'
          description='Frecuencia de nuevas solicitudes hacia ti'
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
                      label: (ctx) => `${ctx.parsed.y ?? 0} procesos`,
                    },
                  },
                },
              }}
            />
          ) : (
            <Alert color='gray' variant='light'>
              Sin fechas de creación suficientes.
            </Alert>
          )}
        </ChartCard>
      </SimpleGrid>

      <PersonalTimeTrendBlock
        title='Cómo va mi tiempo de cierre'
        description='Tu demora al finalizar por periodo · flechas de subida / bajada'
        summary={analytics.myResolutionTrend}
        emptyMessage='Necesitas procesos finalizados con fechas para ver tu tendencia.'
        entranceKey={`trend-${entranceKey}`}
      />

      <Paper shadow='sm' p='md' radius='lg' withBorder mt='md' mb='md'>
        <Group gap='xs' mb='md'>
          <ThemeIcon variant='light' color='violet' radius='md'>
            <IconBriefcase size={16} />
          </ThemeIcon>
          <div>
            <Title order={4}>Mis procesos más repetitivos</Title>
            <Text size='xs' c='dimmed'>
              Ranking personal · cuántos tienes y de qué empresa suelen venir
            </Text>
          </div>
        </Group>
        {analytics.topProcesses.length === 0 ? (
          <Alert color='gray' variant='light'>
            Sin datos aún.
          </Alert>
        ) : (
          <Stack gap='xs'>
            {analytics.topProcesses.map((p, i) => (
              <Group
                key={p.name}
                justify='space-between'
                wrap='nowrap'
                p='sm'
                style={{
                  borderRadius: 12,
                  background: i === 0 ? palette.blue50 : 'transparent',
                  border: `1px solid ${palette.blue100}`,
                }}
              >
                <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
                  <Badge
                    circle
                    size='lg'
                    variant='filled'
                    style={{ background: PROCESS_COLORS[i % PROCESS_COLORS.length] }}
                  >
                    {i + 1}
                  </Badge>
                  <div style={{ minWidth: 0 }}>
                    <Text fw={700} lineClamp={1}>
                      {p.name}
                    </Text>
                    <Text size='xs' c='dimmed' lineClamp={1}>
                      Suele venir de {p.topCompany}
                    </Text>
                  </div>
                </Group>
                <Stack gap={0} align='flex-end'>
                  <Text fw={800}>{p.count}</Text>
                  <Text size='xs' c='dimmed'>
                    {p.avgHours != null ? formatResolutionDuration(p.avgHours) : 'sin cierre'}
                  </Text>
                </Stack>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper shadow='sm' p='md' radius='lg' withBorder>
        <Group justify='space-between' mb='md' wrap='wrap'>
          <Title order={4}>Listado de mis procesos</Title>
          <TextInput
            placeholder='Buscar...'
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ minWidth: 240 }}
          />
        </Group>

        {filteredRequests.length === 0 ? (
          <Alert icon={<IconAlertCircle size={16} />} color='gray'>
            No hay procesos para mostrar.
          </Alert>
        ) : (
          <div className='overflow-x-auto'>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Asunto</Table.Th>
                  <Table.Th>Proceso</Table.Th>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Solicitante</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Creación</Table.Th>
                  <Table.Th>Cierre</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredRequests.map((row) => (
                  <Table.Tr
                    key={row.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() =>
                      router.push(`/process/request-general/view-request?id=${row.id}`)
                    }
                  >
                    <Table.Td>
                      <Badge variant='light'>#{row.id}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500} lineClamp={1}>
                        {row.subject || 'Sin asunto'}
                      </Text>
                    </Table.Td>
                    <Table.Td>{row.process || '—'}</Table.Td>
                    <Table.Td>{row.company || '—'}</Table.Td>
                    <Table.Td>{row.requester || '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(row.status)} variant='light'>
                        {row.status || '—'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatDate(row.created_at)}</Table.Td>
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

export const SolicitadoAnalyticsView = SolicitadoProcesosView;
