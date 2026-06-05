'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Badge,
  Card,
  Flex,
  Grid,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuilding,
  IconChartLine,
  IconCheck,
  IconClock,
  IconTicket,
  IconTrendingUp,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import {
  buildAreaLineChart,
  buildHoursLineChart,
  buildPieChart,
  buildTechnicianPerformanceLineChart,
  buildVerticalBarChart,
  ticketStatusChartColors,
} from '../../lib/charts/builders';
import { getFilterLabel } from '../../lib/dashboard/dateRange';
import {
  ALL_TECHNICIANS_VALUE,
  aggregateByCompany,
  buildCaseCreationTimeSeries,
  buildCaseResolutionSeries,
  buildCompleteCaseTimeSeries,
  buildTeamSummary,
  buildTechnicianPerformanceTimeSeries,
  caseToResolutionTask,
  countByStatus,
  filterCasesByTechnician,
  formatCaseTimeSeriesLabel,
  formatHoursLabel,
  formatResolutionDuration,
  listTechnicians,
  dedupeHelpDeskCases,
  type HelpDeskCase,
} from '../../lib/dashboard/ticketAnalytics';
import { exportTicketsExcel } from '../../lib/dashboard/excel';
import { useDashboardTickets } from '../../lib/dashboard/useDashboardTickets';
import { ResolutionTimeTrendChart } from './ResolutionTimeTrendChart';
import {
  ActividadesSection,
  ChartCard,
  KpiStatCard,
  MetricInsightCard,
  RankedListCard,
  StatusInsightPanel,
  type StatusInsightItem,
} from './actividades/ActividadesUi';
import { ChartContainer } from './ChartContainer';
import DashboardDateToolbar, { DashboardPeriodHint } from './DashboardDateToolbar';
import DashboardPageShell from './DashboardPageShell';
import { useChartViewport } from './useChartViewport';
import { useProjectColors } from './useProjectColors';
import { getDashboardCardPadding, resolveChartHeight } from '../../lib/dashboard/responsive';
import { dashboardChartTheme } from './chartTheme';

function ScoreBadge({ score, size = 'lg' }: { score: number; size?: 'sm' | 'lg' }) {
  const color =
    score >= 75 ? 'green' : score >= 50 ? 'yellow' : score >= 25 ? 'orange' : 'red';
  return (
    <Badge size={size} variant='filled' color={color} radius='md'>
      {score}/100
    </Badge>
  );
}

export default function TicketsAnalyticsView() {
  const projectColors = useProjectColors();
  const { status: sessionStatus } = useSession();
  const {
    cases: rawCases,
    loading,
    error,
    dateFilter,
    setDateFilter,
    selectedMonthDate,
    setSelectedMonthDate,
    fetchTickets,
    activeDateRange,
    appliedRange,
  } = useDashboardTickets();

  const [technicianFilter, setTechnicianFilter] = useState(ALL_TECHNICIANS_VALUE);
  const [exportingExcel, setExportingExcel] = useState(false);
  const chartViewport = useChartViewport();

  const cases = useMemo(
    () => dedupeHelpDeskCases(rawCases as HelpDeskCase[]),
    [rawCases]
  );

  const handleExportExcel = useCallback(async () => {
    try {
      setExportingExcel(true);
      await exportTicketsExcel({
        cases,
        dateFilter,
        selectedMonthDate,
        appliedRange,
        technicianFilter,
      });
    } catch (err) {
      console.error('Error exportando tickets:', err);
    } finally {
      setExportingExcel(false);
    }
  }, [cases, dateFilter, selectedMonthDate, appliedRange, technicianFilter]);

  const teamSummary = useMemo(() => buildTeamSummary(cases), [cases]);
  const scopedCases = useMemo(
    () => filterCasesByTechnician(cases, technicianFilter),
    [cases, technicianFilter]
  );
  const scopedCounts = useMemo(() => countByStatus(scopedCases), [scopedCases]);
  const isIndividualView = technicianFilter !== ALL_TECHNICIANS_VALUE;

  const selectedTechMetrics = useMemo(() => {
    if (!isIndividualView) return null;
    return teamSummary.technicians.find((t) => t.name === technicianFilter) ?? null;
  }, [isIndividualView, technicianFilter, teamSummary.technicians]);

  const individualScore = useMemo(() => {
    if (selectedTechMetrics) return selectedTechMetrics.score;
    return teamSummary.teamScore;
  }, [selectedTechMetrics, teamSummary.teamScore]);

  const technicianOptions = useMemo(() => {
    const names = listTechnicians(cases);
    const options = [
      { value: ALL_TECHNICIANS_VALUE, label: 'Vista general (todo el equipo)' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
    if (
      technicianFilter !== ALL_TECHNICIANS_VALUE &&
      !names.includes(technicianFilter)
    ) {
      options.push({
        value: technicianFilter,
        label: `${technicianFilter} (sin casos en este periodo)`,
      });
    }
    return options;
  }, [cases, technicianFilter]);

  const statusInsightItems: StatusInsightItem[] = useMemo(() => {
    const c = scopedCounts;
    const total = c.total || 1;
    return [
      {
        key: 'abierto',
        label: 'Abiertos',
        count: c.abierto,
        percent: (c.abierto / total) * 100,
        color: ticketStatusChartColors.abierto,
      },
      {
        key: 'progreso',
        label: 'En progreso',
        count: c.enProgreso,
        percent: (c.enProgreso / total) * 100,
        color: ticketStatusChartColors.enProgreso,
      },
      {
        key: 'resuelto',
        label: 'Resueltos',
        count: c.resuelto,
        percent: (c.resuelto / total) * 100,
        color: ticketStatusChartColors.resuelto,
      },
      {
        key: 'cerrado',
        label: 'Cerrados / cancelados',
        count: c.cerrado,
        percent: (c.cerrado / total) * 100,
        color: ticketStatusChartColors.cerrado,
      },
    ].filter((i) => i.count > 0);
  }, [scopedCounts]);

  const statusPieData = useMemo(
    () =>
      statusInsightItems.map((i) => ({
        name: i.label,
        value: i.count,
        color: i.color,
      })),
    [statusInsightItems]
  );

  const companyChartData = useMemo(
    () => aggregateByCompany(isIndividualView ? scopedCases : cases, 10),
    [cases, scopedCases, isIndividualView]
  );
  const topTechnicians = useMemo(
    () =>
      teamSummary.technicians.slice(0, 8).map((t) => ({
        name: t.name,
        value: t.total,
      })),
    [teamSummary.technicians]
  );

  const creationTimeSeries = useMemo(() => {
    const raw = buildCaseCreationTimeSeries(scopedCases, dateFilter, selectedMonthDate);
    return buildCompleteCaseTimeSeries(scopedCases, raw, dateFilter, selectedMonthDate).map(
      ([key, count]) => ({
        label: formatCaseTimeSeriesLabel(key, dateFilter),
        value: count,
      })
    );
  }, [scopedCases, dateFilter, selectedMonthDate]);

  const resolutionSeries = useMemo(
    () => buildCaseResolutionSeries(scopedCases, isIndividualView ? technicianFilter : null),
    [scopedCases, isIndividualView, technicianFilter]
  );

  const resolutionChartPoints = useMemo(
    () =>
      resolutionSeries.points.map((p) => ({
        label: p.label,
        value: p.avgHours,
      })),
    [resolutionSeries.points]
  );

  const technicianPerformanceSeries = useMemo(
    () => buildTechnicianPerformanceTimeSeries(cases, dateFilter, selectedMonthDate),
    [cases, dateFilter, selectedMonthDate]
  );

  const chartHeights = {
    standard: resolveChartHeight('standard', chartViewport),
    medium: resolveChartHeight('medium', chartViewport),
    bar: resolveChartHeight('hero', chartViewport),
    kpi: resolveChartHeight('kpi', chartViewport),
  };

  const volumeDoughnut = buildPieChart(statusPieData, {
    showLegend: !chartViewport.isMobile,
    cutout: '62%',
  });
  const creationLine = buildAreaLineChart(creationTimeSeries, projectColors.secondary);
  const resolutionLine = buildHoursLineChart(
    resolutionChartPoints,
    projectColors.primary,
    formatHoursLabel
  );
  const companyBar = buildVerticalBarChart(
    companyChartData.map((d) => ({ name: d.name, value: d.value })),
    projectColors.primary,
    { datasetLabel: 'Casos', rotateLabels: chartViewport.isCompact }
  );
  const techPerformanceLine = useMemo(() => {
    if (!technicianPerformanceSeries) return null;
    return buildTechnicianPerformanceLineChart(technicianPerformanceSeries, {
      legendOnRight: !chartViewport.isMobile,
    });
  }, [technicianPerformanceSeries, chartViewport.isMobile]);

  const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);
  const avgHours =
    (isIndividualView
      ? selectedTechMetrics?.avgResolutionHours
      : teamSummary.avgResolutionHours) ?? null;

  if (sessionStatus === 'loading' && cases.length === 0) {
    return (
      <DashboardPageShell title='Tickets'>
        <Skeleton height={50} mb='xl' />
        <Skeleton height={200} />
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      title='Tickets'
      description={
        <Stack gap={4}>
          <Text size='sm' c='dimmed' component='span' display='block'>
            {isIndividualView
              ? `Desempeño de ${technicianFilter} · estados, tiempos y carga del periodo`
              : 'Mesa de ayuda · volumen por técnico y empresa, tiempos de soporte y puntaje del equipo'}
          </Text>
          {activeDateRange ? (
            <DashboardPeriodHint
              dateFilter={dateFilter}
              selectedMonthDate={selectedMonthDate}
              appliedRange={appliedRange}
            />
          ) : null}
        </Stack>
      }
      toolbar={
        <DashboardDateToolbar
          dateFilter={dateFilter}
          onDateFilterChange={setDateFilter}
          selectedMonthDate={selectedMonthDate}
          onSelectedMonthDateChange={setSelectedMonthDate}
          onRefresh={fetchTickets}
          loading={loading}
          onExport={handleExportExcel}
          exportingExcel={exportingExcel}
        />
      }
    >
      <Paper p={{ base: 'sm', sm: 'md' }} radius='md' withBorder>
        <Select
          label='Analista / técnico'
          description={
            isIndividualView
              ? 'Métricas y gráficas solo de este responsable'
              : 'Vista consolidada del equipo de soporte'
          }
          leftSection={<IconUser size={18} />}
          data={technicianOptions}
          value={technicianFilter}
          onChange={(v) => setTechnicianFilter(v ?? ALL_TECHNICIANS_VALUE)}
          allowDeselect={false}
          searchable={technicianOptions.length > 6}
          nothingFoundMessage='Sin técnicos en el periodo'
        />
      </Paper>

      {error && (
        <Alert icon={<IconAlertCircle size={20} />} title='Error al cargar' color='red' variant='light'>
          {error}
        </Alert>
      )}

      {/* 1 · Salud operativa: volumen, estados y puntaje del periodo */}
      <ActividadesSection
        priority={1}
        title={isIndividualView ? 'Indicadores del analista' : 'Indicadores del equipo'}
        description='Lo primero a revisar: cuántos casos hay, en qué estado están y qué tan bien responde el soporte.'
      >
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 3, xl: 6 }} spacing={{ base: 'sm', sm: 'md' }}>
          <KpiStatCard
            label='Total casos'
            value={loading ? '—' : formatNumber(scopedCounts.total)}
            hint={`Periodo: ${getFilterLabel(dateFilter)}`}
            color={projectColors.primary}
            icon={IconTicket}
            loading={loading}
          />
          <KpiStatCard
            label='Abiertos'
            value={loading ? '—' : formatNumber(scopedCounts.abierto)}
            hint='Requieren atención inmediata'
            sharePercent={
              scopedCounts.total > 0
                ? (scopedCounts.abierto / scopedCounts.total) * 100
                : 0
            }
            color={projectColors.secondary}
            icon={IconClock}
            loading={loading}
          />
          <KpiStatCard
            label='En progreso'
            value={loading ? '—' : formatNumber(scopedCounts.enProgreso)}
            hint='Casos siendo atendidos ahora'
            sharePercent={
              scopedCounts.total > 0
                ? (scopedCounts.enProgreso / scopedCounts.total) * 100
                : 0
            }
            color={ticketStatusChartColors.enProgreso}
            icon={IconTrendingUp}
            loading={loading}
          />
          <KpiStatCard
            label='Resueltos'
            value={loading ? '—' : formatNumber(scopedCounts.resuelto)}
            hint='Atendidos con solución'
            sharePercent={
              scopedCounts.total > 0
                ? (scopedCounts.resuelto / scopedCounts.total) * 100
                : 0
            }
            color={projectColors.success}
            icon={IconCheck}
            loading={loading}
          />
          <KpiStatCard
            label='Tiempo prom. resolución'
            value={loading ? '—' : avgHours != null ? formatResolutionDuration(avgHours) : '—'}
            hint='Creación → cierre (casos resueltos)'
            color={projectColors.primary}
            icon={IconClock}
            loading={loading}
          />
          <Card shadow='sm' padding='lg' radius='md' withBorder>
            {loading ? (
              <Skeleton height={80} />
            ) : (
              <>
                <Group justify='space-between' mb='xs'>
                  <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                    Puntaje {isIndividualView ? 'individual' : 'del equipo'}
                  </Text>
                  <IconUsers size={18} color={projectColors.primary} />
                </Group>
                <Group gap='md' align='center'>
                  <Title order={2} style={{ color: projectColors.primary }}>
                    {individualScore}
                  </Title>
                  <ScoreBadge score={individualScore} />
                </Group>
                <Progress
                  value={individualScore}
                  size='sm'
                  mt='md'
                  styles={{ section: { backgroundColor: projectColors.primary } }}
                />
                <Text size='xs' c='dimmed' mt='xs'>
                  Resolución, cierres y tiempo medio de atención
                </Text>
              </>
            )}
          </Card>
        </SimpleGrid>
      </ActividadesSection>

      {/* 2 · Backlog y composición de estados */}
      <ActividadesSection
        priority={2}
        title='Panorama de estados'
        description='Backlog activo vs. casos cerrados: entienda la carga pendiente antes de evaluar desempeño.'
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing='lg'>
          <StatusInsightPanel
            items={statusInsightItems}
            total={scopedCounts.total}
            loading={loading}
          />
          <MetricInsightCard
            label='Backlog activo'
            value={
              loading
                ? '—'
                : formatNumber(scopedCounts.abierto + scopedCounts.enProgreso)
            }
            hint={`${formatNumber(scopedCounts.cerrado)} cerrados/cancelados en el periodo`}
            sharePercent={
              scopedCounts.total > 0
                ? ((scopedCounts.abierto + scopedCounts.enProgreso) / scopedCounts.total) * 100
                : 0
            }
            color={ticketStatusChartColors.enProgreso}
            icon={IconChartLine}
            loading={loading}
            chartTitle='Composición de estados'
            chartDescription='Abiertos, en progreso, resueltos y cerrados'
            chartType='doughnut'
            chartData={volumeDoughnut.data}
            chartOptions={volumeDoughnut.options}
          />
        </SimpleGrid>
      </ActividadesSection>

      {/* 3 · Desempeño: equipo o analista seleccionado */}
      {isIndividualView && selectedTechMetrics ? (
        <ActividadesSection
          priority={3}
          title='Desempeño del analista'
          description='Comparación con el equipo y desglose de carga individual.'
        >
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing='md'>
            <Card withBorder padding='md'>
              <Text size='xs' c='dimmed'>
                Total casos asignados
              </Text>
              <Title order={4}>{formatNumber(selectedTechMetrics.total)}</Title>
            </Card>
            <Card withBorder padding='md'>
              <Text size='xs' c='dimmed'>
                Backlog (abierto + progreso)
              </Text>
              <Title order={4}>{formatNumber(selectedTechMetrics.openBacklog)}</Title>
            </Card>
            <Card withBorder padding='md'>
              <Text size='xs' c='dimmed'>
                Puntaje del equipo
              </Text>
              <Group gap='xs' mt={4}>
                <Title order={4}>{teamSummary.teamScore}</Title>
                <ScoreBadge score={teamSummary.teamScore} size='sm' />
              </Group>
            </Card>
            <Card withBorder padding='md'>
              <Text size='xs' c='dimmed'>
                vs. promedio del equipo
              </Text>
              <Title
                order={4}
                c={
                  selectedTechMetrics.score >= teamSummary.teamScore ? 'green' : 'orange'
                }
              >
                {selectedTechMetrics.score >= teamSummary.teamScore ? 'Por encima' : 'Por debajo'}
              </Title>
            </Card>
          </SimpleGrid>
        </ActividadesSection>
      ) : (
        <ActividadesSection
          priority={3}
          title='Desempeño por responsable'
          description='Quién concentra más casos, cómo evoluciona su carga y ranking del equipo.'
        >
          <Grid gutter='lg'>
            <Grid.Col span={{ base: 12, lg: 5 }}>
              <RankedListCard
                title='Mayor carga de casos'
                description='Top técnicos por volumen en el periodo'
                items={topTechnicians}
                formatValue={(n) => `${formatNumber(n)} casos`}
                emptyMessage='No hay casos asignados en este periodo'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <ChartCard
                title='Rendimiento por técnico'
                description={`Evolución de casos · ${getFilterLabel(dateFilter)} (máx. 12)${
                  chartViewport.isCompact ? ' · Toca un punto para ver el detalle' : ''
                }`}
              >
                {loading ? (
                  <Skeleton height={chartHeights.bar} />
                ) : techPerformanceLine ? (
                  <ChartContainer
                    type='line'
                    data={techPerformanceLine.data}
                    options={techPerformanceLine.options}
                    height={chartHeights.bar}
                  />
                ) : (
                  <Flex h={chartHeights.bar} align='center' justify='center'>
                    <Text c='dimmed' size='sm'>
                      Sin datos de técnicos
                    </Text>
                  </Flex>
                )}
              </ChartCard>
            </Grid.Col>
          </Grid>

          <ChartCard title='Ranking del equipo' description='Puntaje, tiempos y estados por analista'>
            {loading ? (
              <Skeleton height={200} />
            ) : teamSummary.technicians.length > 0 ? (
              <Table.ScrollContainer minWidth={640}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Técnico</Table.Th>
                      <Table.Th ta='right'>Casos</Table.Th>
                      <Table.Th ta='right'>Abiertos</Table.Th>
                      <Table.Th ta='right'>Resueltos</Table.Th>
                      <Table.Th ta='right'>Cerrados</Table.Th>
                      <Table.Th ta='right'>Tiempo prom.</Table.Th>
                      <Table.Th ta='right'>Puntaje</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {teamSummary.technicians.map((t) => (
                      <Table.Tr key={t.name}>
                        <Table.Td>
                          <Text size='sm' fw={600}>
                            {t.name}
                          </Text>
                        </Table.Td>
                        <Table.Td ta='right'>{formatNumber(t.total)}</Table.Td>
                        <Table.Td ta='right'>
                          {formatNumber(t.counts.abierto + t.counts.enProgreso)}
                        </Table.Td>
                        <Table.Td ta='right'>{formatNumber(t.counts.resuelto)}</Table.Td>
                        <Table.Td ta='right'>{formatNumber(t.counts.cerrado)}</Table.Td>
                        <Table.Td ta='right'>
                          {t.avgResolutionHours != null
                            ? formatResolutionDuration(t.avgResolutionHours)
                            : '—'}
                        </Table.Td>
                        <Table.Td ta='right'>
                          <ScoreBadge score={t.score} size='sm' />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Text c='dimmed' ta='center' py='md'>
                Sin técnicos en el periodo
              </Text>
            )}
          </ChartCard>
        </ActividadesSection>
      )}

      {/* 4 · Demanda: qué empresas generan más soporte */}
      <ActividadesSection
        priority={4}
        title='Demanda por empresa'
        description={
          isIndividualView
            ? 'Empresas que más casos generan para el analista seleccionado'
            : 'Organizaciones con mayor volumen de tickets en el periodo.'
        }
      >
        <ChartCard title='Top empresas' description='Hasta 10 empresas con más casos'>
          {loading ? (
            <Skeleton height={chartHeights.medium} />
          ) : companyChartData.length > 0 ? (
            <ChartContainer
              type='bar'
              data={companyBar.data}
              options={companyBar.options}
              height={chartHeights.medium}
            />
          ) : (
            <Flex h={chartHeights.medium} align='center' justify='center'>
              <Text c='dimmed' size='sm'>
                Sin datos por empresa
              </Text>
            </Flex>
          )}
        </ChartCard>
      </ActividadesSection>

      {/* 5 · Evolución temporal: tendencias de volumen y tiempos */}
      <ActividadesSection
        priority={5}
        title='Evolución en el tiempo'
        description='Tendencias históricas del periodo: volumen de entrada y eficiencia de resolución.'
      >
        <Grid gutter='lg'>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <ChartCard
              title='Casos creados'
              description={`Entrada de tickets · ${getFilterLabel(dateFilter)}`}
            >
              {loading ? (
                <Skeleton height={chartHeights.standard} />
              ) : creationTimeSeries.length > 0 ? (
                <ChartContainer
                  type='line'
                  data={creationLine.data}
                  options={creationLine.options}
                  height={chartHeights.standard}
                />
              ) : (
                <Flex h={chartHeights.standard} align='center' justify='center'>
                  <Text c='dimmed' size='sm'>
                    Sin casos en el periodo
                  </Text>
                </Flex>
              )}
            </ChartCard>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <ChartCard
              title='Tiempo de resolución'
              description='Promedio por periodo (creación → cierre)'
            >
              {loading ? (
                <Skeleton height={chartHeights.standard} />
              ) : resolutionChartPoints.length > 0 ? (
                <ChartContainer
                  type='line'
                  data={resolutionLine.data}
                  options={resolutionLine.options}
                  height={chartHeights.standard}
                />
              ) : (
                <Flex h={chartHeights.standard} align='center' justify='center'>
                  <Text c='dimmed' size='sm'>
                    Sin casos resueltos con fecha de cierre
                  </Text>
                </Flex>
              )}
            </ChartCard>
          </Grid.Col>
        </Grid>

        <ResolutionTimeTrendChart
          tasks={scopedCases.map(caseToResolutionTask)}
          assigneeFilter={isIndividualView ? technicianFilter : null}
          title={
            isIndividualView
              ? 'Tendencia de tiempos de resolución'
              : 'Tendencia de tiempos del equipo'
          }
          subtitle={
            isIndividualView
              ? `Promedio desde apertura hasta cierre · ${technicianFilter}`
              : 'Promedio del grupo en cada periodo de cierre'
          }
        />
      </ActividadesSection>

      {/* 6 · Detalle operativo: últimos casos */}
      <ActividadesSection
        priority={6}
        title='Casos recientes'
        description='Listado de los últimos registros para seguimiento puntual.'
      >
        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='md' wrap='wrap'>
            <Badge
              variant='light'
              leftSection={<IconBuilding size={12} />}
              styles={{
                root: {
                  backgroundColor: dashboardChartTheme.blue50,
                  color: dashboardChartTheme.primary,
                },
              }}
            >
              {formatNumber(scopedCases.length)} en vista
            </Badge>
          </Group>
          <Stack gap='sm'>
            {loading ? (
              <Skeleton height={120} />
            ) : scopedCases.length > 0 ? (
              scopedCases.slice(0, 15).map((c, i) => (
                <Paper key={c.id_case ?? i} p='sm' withBorder>
                  <Group justify='space-between' wrap='wrap' gap='xs'>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size='sm' fw={600} lineClamp={2}>
                        {c.id_case ? `#${c.id_case} · ` : ''}
                        {String(c.subject_case ?? 'Sin asunto')}
                      </Text>
                      <Text size='xs' c='dimmed' lineClamp={1}>
                        {String(c.company ?? 'Sin empresa')} · {String(c.nombreTecnico ?? 'Sin asignar')}
                      </Text>
                    </div>
                    <Group gap='xs' wrap='wrap' style={{ flexShrink: 0 }}>
                      <Badge variant='light'>{String(c.status ?? '—')}</Badge>
                      {c.priority && (
                        <Badge color='orange' variant='outline'>
                          {String(c.priority)}
                        </Badge>
                      )}
                    </Group>
                  </Group>
                </Paper>
              ))
            ) : (
              <Text c='dimmed' ta='center' py='md'>
                No hay casos en la vista seleccionada
              </Text>
            )}
          </Stack>
        </Card>
      </ActividadesSection>
    </DashboardPageShell>
  );
}
