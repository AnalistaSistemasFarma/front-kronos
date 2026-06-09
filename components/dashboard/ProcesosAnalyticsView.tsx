'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Card,
  Flex,
  Grid,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuilding,
  IconCategory,
  IconChartLine,
  IconClockHour4,
  IconGitBranch,
  IconList,
  IconUsers,
} from '@tabler/icons-react';
import {
  buildAreaLineChart,
  buildHorizontalMultiColorBarChart,
  buildPieChart,
  buildRequestStatusStackedBar,
  buildVerticalBarChart,
} from '../../lib/charts/builders';
import { getPeriodRangeLabel } from '../../lib/dashboard/dateRange';
import {
  ALL_PROCESSES_VALUE,
  buildCategoryCountByProcess,
  buildDistinctProcessActivityTimeSeries,
  buildProcessStatsFromTasks,
  buildProcessStatusStackedRows,
  computeProcessCoverageMetrics,
  formatProcessTimeSeriesLabel,
  listProcessesFromRequests,
} from '../../lib/dashboard/processAnalytics';
import { formatHoursLabel } from '../../lib/dashboard/requestResolution';
import { useDashboardTasks } from '../../lib/dashboard/useDashboardTasks';
import { ChartContainer } from './ChartContainer';
import { resolveProcessRankingChartLayout, resolveProcessStackedChartLayout } from './chartTheme';
import DashboardDateToolbar, { DashboardPeriodHint } from './DashboardDateToolbar';
import DashboardPageShell from './DashboardPageShell';
import { useChartViewport } from './useChartViewport';
import { useProjectColors } from './useProjectColors';
import { getDashboardCardPadding, resolveChartHeight } from '../../lib/dashboard/responsive';
import { useDashboardChartPalette } from './useDashboardChartPalette';

export default function ProcesosAnalyticsView() {
  const projectColors = useProjectColors();
  const { categoricalPalette } = useDashboardChartPalette();
  const {
    status,
    tasks,
    requests: requestsFromCtx,
    loading,
    error,
    dateFilter,
    setDateFilter,
    selectedMonthDate,
    setSelectedMonthDate,
    fetchTasks,
    appliedRange,
    activeDateRange,
  } = useDashboardTasks();

  const [processFilter, setProcessFilter] = useState<string>(ALL_PROCESSES_VALUE);

  const allRequests = requestsFromCtx;
  const processes = useMemo(() => listProcessesFromRequests(allRequests), [allRequests]);

  const filteredRequests = useMemo(() => {
    if (processFilter === ALL_PROCESSES_VALUE) return allRequests;
    return allRequests.filter(
      (r) => (r.proceso_solicitud?.trim() || 'Sin proceso') === processFilter
    );
  }, [allRequests, processFilter]);

  const filteredTasks = useMemo(() => {
    if (processFilter === ALL_PROCESSES_VALUE) return tasks;
    return tasks.filter(
      (t) => (t.proceso_solicitud?.trim() || 'Sin proceso') === processFilter
    );
  }, [tasks, processFilter]);

  const processStats = useMemo(
    () => buildProcessStatsFromTasks(filteredTasks, filteredRequests),
    [filteredTasks, filteredRequests]
  );

  const coverage = useMemo(
    () => computeProcessCoverageMetrics(processStats, filteredRequests),
    [processStats, filteredRequests]
  );

  const selectedProcessStat = useMemo(
    () =>
      processFilter === ALL_PROCESSES_VALUE
        ? null
        : (processStats.find((p) => p.proceso === processFilter) ?? null),
    [processFilter, processStats]
  );

  const isProcessView = processFilter !== ALL_PROCESSES_VALUE;

  useEffect(() => {
    setProcessFilter(ALL_PROCESSES_VALUE);
  }, [dateFilter, selectedMonthDate]);

  const distributionChartData = useMemo(
    () =>
      processStats.slice(0, 8).map((p, index) => ({
        name: p.proceso,
        value: p.solicitudes,
        color: categoricalPalette[index % categoricalPalette.length],
      })),
    [processStats, categoricalPalette]
  );

  const distributionPie = useMemo(
    () => buildPieChart(distributionChartData),
    [distributionChartData]
  );

  const topProcessBar = useMemo(
    () =>
      buildVerticalBarChart(
        processStats.slice(0, 10).map((p) => ({ name: p.proceso, value: p.solicitudes })),
        projectColors.primary,
        { datasetLabel: 'Volumen', showLegend: true, rotateLabels: true }
      ),
    [processStats, projectColors.primary]
  );

  const statusStackedRows = useMemo(
    () => buildProcessStatusStackedRows(processStats, 10),
    [processStats]
  );

  const categoryChartData = useMemo(
    () => buildCategoryCountByProcess(filteredRequests, processFilter),
    [filteredRequests, processFilter]
  );

  const categoryBarChart = useMemo(
    () =>
      buildVerticalBarChart(
        categoryChartData.map((d) => ({ name: d.name, value: d.value })),
        projectColors.secondary,
        { datasetLabel: 'Volumen', showLegend: true, rotateLabels: true }
      ),
    [categoryChartData, projectColors.secondary]
  );

  const activityTimeSeries = useMemo(
    () =>
      isProcessView
        ? []
        : buildDistinctProcessActivityTimeSeries(
            allRequests,
            dateFilter,
            selectedMonthDate
          ).map(([key, count]) => ({
            date: formatProcessTimeSeriesLabel(key, dateFilter),
            Procesos: count,
          })),
    [allRequests, dateFilter, selectedMonthDate, isProcessView]
  );

  const activityLineChart = buildAreaLineChart(
    activityTimeSeries.map((d) => ({ label: d.date, value: d.Procesos })),
    projectColors.secondary
  );

  const rankedBarItems = useMemo(
    () =>
      processStats.map((item, index) => ({
        label: item.proceso,
        value: item.solicitudes,
        color: categoricalPalette[index % categoricalPalette.length],
        procesos: [item.proceso],
      })),
    [processStats, categoricalPalette]
  );

  const chartViewport = useChartViewport();
  const isMobile = chartViewport.isMobile;
  const rankedChartLayout = useMemo(
    () =>
      resolveProcessRankingChartLayout(
        Math.min(rankedBarItems.length, 12),
        chartViewport.isCompact
      ),
    [rankedBarItems.length, chartViewport.isCompact]
  );
  const statusStackedLayout = useMemo(
    () => resolveProcessStackedChartLayout(statusStackedRows.length, chartViewport.isCompact),
    [statusStackedRows.length, chartViewport.isCompact]
  );

  const statusStackedChart = useMemo(
    () =>
      buildRequestStatusStackedBar(statusStackedRows, true, {
        compact: chartViewport.isCompact,
      }),
    [statusStackedRows, chartViewport.isCompact]
  );

  const rankedBarChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(rankedBarItems.slice(0, 12), isMobile, {
        valueLabel: 'volumen',
        datasetLabel: 'Volumen por proceso',
        truncateLabels: true,
        compact: chartViewport.isCompact,
      }),
    [rankedBarItems, isMobile, chartViewport.isCompact]
  );

  const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);

  const processSelectData = useMemo(
    () => [
      { value: ALL_PROCESSES_VALUE, label: 'Todos los procesos' },
      ...processes.map((p) => ({ value: p, label: p })),
    ],
    [processes]
  );

  const chartHeights = {
    standard: resolveChartHeight('standard', chartViewport),
    medium: resolveChartHeight('medium', chartViewport),
    large: resolveChartHeight('large', chartViewport),
  };

  if (status === 'loading' && !tasks.length) {
    return (
      <DashboardPageShell title='Procesos'>
        <Skeleton height={50} mb='xl' />
        <Skeleton height={200} />
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      title='Procesos'
      description={
        <Stack gap={4}>
          <Text size='sm' c='dimmed' component='span' display='block'>
            {isProcessView
              ? `Perfil de ${processFilter} · categorías, cobertura y desempeño del área`
              : 'Compare áreas de negocio, volumen relativo y cobertura en el periodo'}
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
          onRefresh={fetchTasks}
          loading={loading}
          showExport={false}
        />
      }
    >
      <Paper p={{ base: 'sm', sm: 'md' }} radius='md' withBorder>
        <Select
          label='Proceso'
          description={
            isProcessView
              ? 'Detalle del proceso seleccionado'
              : 'Vista comparativa de todas las áreas'
          }
          leftSection={<IconGitBranch size={18} />}
          data={processSelectData}
          value={processFilter}
          onChange={(v) => setProcessFilter(v ?? ALL_PROCESSES_VALUE)}
          allowDeselect={false}
          searchable={processes.length > 4}
          nothingFoundMessage='Sin procesos en el periodo'
        />
      </Paper>

      {error && (
        <Alert icon={<IconAlertCircle size={20} />} title='Error al cargar' color='red' variant='light'>
          {error}
        </Alert>
      )}

      <SimpleGrid
        cols={{
          base: 1,
          xs: 2,
          sm: 2,
          md: isProcessView ? 2 : 3,
          lg: isProcessView ? 4 : 6,
        }}
        spacing={{ base: 'sm', sm: 'md' }}
      >
        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              {isProcessView ? 'Proceso' : 'Total procesos'}
            </Text>
            <IconGitBranch size={20} color={projectColors.primary} />
          </Group>
          {isProcessView ? (
            <Title order={4} lineClamp={2} style={{ color: projectColors.primary }}>
              {processFilter}
            </Title>
          ) : (
            <Title order={3} style={{ color: projectColors.primary }}>
              {formatNumber(coverage.totalProcesos)}
            </Title>
          )}
          <Text size='xs' c='dimmed'>
            {isProcessView
              ? 'Área seleccionada'
              : `${appliedRange ?? getPeriodRangeLabel(dateFilter, selectedMonthDate)}`}
          </Text>
        </Card>

        {!isProcessView && (
          <>
            <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
              <Text size='sm' c='dimmed'>
                Promedio de carga
              </Text>
              <Title order={3} style={{ color: projectColors.purple }}>
                {coverage.avgVolumenPorProceso.toFixed(1)}
              </Title>
              <Text size='xs' c='dimmed'>
                Volumen medio por proceso
              </Text>
            </Card>
            {coverage.topProceso && (
              <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
                <Text size='sm' c='dimmed'>
                  Mayor demanda
                </Text>
                <Title order={4} lineClamp={2} style={{ color: projectColors.primary }}>
                  {coverage.topProceso.proceso}
                </Title>
                <Text size='xs' c='dimmed'>
                  Volumen {formatNumber(coverage.topProceso.solicitudes)}
                </Text>
              </Card>
            )}
          </>
        )}

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              Categorías
            </Text>
            <IconCategory size={20} color={projectColors.secondary} />
          </Group>
          <Title order={3} style={{ color: projectColors.secondary }}>
            {formatNumber(
              isProcessView ? (selectedProcessStat?.categorias ?? 0) : coverage.categoriasDistintas
            )}
          </Title>
          <Text size='xs' c='dimmed'>
            {isProcessView ? 'En este proceso' : 'Distintas en el periodo'}
          </Text>
        </Card>

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              Empresas
            </Text>
            <IconBuilding size={20} color={projectColors.success} />
          </Group>
          <Title order={3} style={{ color: projectColors.success }}>
            {formatNumber(
              isProcessView ? (selectedProcessStat?.empresas ?? 0) : coverage.empresasDistintas
            )}
          </Title>
          <Text size='xs' c='dimmed'>
            {isProcessView ? 'Atendidas por el proceso' : 'Cobertura empresarial'}
          </Text>
        </Card>

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='xs'>
            <Text size='sm' c='dimmed'>
              Encargados
            </Text>
            <IconUsers size={20} color={projectColors.teal} />
          </Group>
          <Title order={3} style={{ color: projectColors.teal }}>
            {formatNumber(
              isProcessView
                ? (selectedProcessStat?.encargados.length ?? 0)
                : coverage.encargadosDistintos
            )}
          </Title>
          <Text size='xs' c='dimmed'>
            Líderes de área vinculados
          </Text>
        </Card>

        {isProcessView && selectedProcessStat?.avgResolutionHours != null && (
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
            <Group justify='space-between' mb='xs'>
              <Text size='sm' c='dimmed'>
                Tiempo prom. del proceso
              </Text>
              <IconClockHour4 size={20} color={projectColors.primary} />
            </Group>
            <Title order={3} style={{ color: projectColors.primary }}>
              {formatHoursLabel(selectedProcessStat.avgResolutionHours)}
            </Title>
            <Text size='xs' c='dimmed'>
              {selectedProcessStat.closedWithTime} cierres medidos
            </Text>
          </Card>
        )}
      </SimpleGrid>

      {isProcessView && selectedProcessStat?.encargados.length ? (
        <Paper p='md' radius='md' withBorder>
          <Text size='xs' c='dimmed' tt='uppercase' fw={600} mb='xs'>
            Encargados del proceso
          </Text>
          <Group gap='xs'>
            {selectedProcessStat.encargados.map((name) => (
              <Badge key={name} variant='light' color='blue'>
                {name}
              </Badge>
            ))}
          </Group>
        </Paper>
      ) : null}

      {!isProcessView && (
        <>
          <Grid gutter='lg' align='stretch'>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder h='100%'>
                <Title order={4} mb='xs'>
                  Procesos con actividad
                </Title>
                <Text size='xs' c='dimmed' mb='md'>
                  Cuántas áreas recibieron demanda en cada tramo del periodo
                </Text>
                {loading ? (
                  <Skeleton height={chartHeights.standard} />
                ) : activityTimeSeries.some((d) => d.Procesos > 0) ? (
                  <ChartContainer
                    type='line'
                    data={activityLineChart.data}
                    options={activityLineChart.options}
                    height={chartHeights.standard}
                  />
                ) : (
                  <Flex h={chartHeights.standard} align='center' justify='center'>
                    <Stack align='center' gap='sm'>
                      <IconChartLine size={48} color={projectColors.primary} opacity={0.3} />
                      <Text c='dimmed' size='sm'>
                        No hay procesos activos en este periodo
                      </Text>
                    </Stack>
                  </Flex>
                )}
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder h='100%'>
                <Group gap='xs' mb={4}>
                  <IconList size={20} color={projectColors.primary} />
                  <Title order={4}>Categorías por proceso</Title>
                </Group>
                {loading ? (
                  <Skeleton height={chartHeights.standard} />
                ) : categoryChartData.length > 0 ? (
                  <ChartContainer
                    type='bar'
                    data={categoryBarChart.data}
                    options={categoryBarChart.options}
                    height={chartHeights.standard}
                  />
                ) : (
                  <Text c='dimmed' ta='center' py='xl'>
                    Sin categorías en el periodo
                  </Text>
                )}
              </Card>
            </Grid.Col>
          </Grid>

          <Card
            shadow='sm'
            padding={getDashboardCardPadding()}
            radius='md'
            withBorder
            className='dashboard-chart-card'
          >
            <Title order={4} mb='xs'>
              Ranking de procesos
            </Title>
            <Text size='xs' c='dimmed' mb='md'>
              Volumen, categorías y cobertura de cada área
            </Text>
            <Box className='dashboard-chart-slot'>
            {loading ? (
              <Skeleton height={rankedChartLayout.maxHeight ?? rankedChartLayout.height} radius='md' />
            ) : rankedBarItems.length > 0 ? (
              <>
                <ChartContainer
                  type='bar'
                  data={rankedBarChart.data}
                  options={rankedBarChart.options}
                  height={rankedChartLayout.height}
                  maxHeight={rankedChartLayout.maxHeight}
                  scrollable={rankedChartLayout.scrollHorizontal}
                />
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='sm' mt='lg'>
                  {processStats.slice(0, 12).map((item, index) => (
                    <Paper key={item.proceso} p='sm' withBorder radius='md'>
                      <Group justify='space-between' wrap='nowrap' gap='xs' mb={6}>
                        <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
                          <Badge variant='filled' color='blue' size='sm' circle>
                            {index + 1}
                          </Badge>
                          <Text size='sm' fw={600} lineClamp={2}>
                            {item.proceso}
                          </Text>
                        </Group>
                        <Badge variant='light' color='blue'>
                          #{index + 1}
                        </Badge>
                      </Group>
                      <Text size='xs' c='dimmed'>
                        {item.categorias} categoría{item.categorias === 1 ? '' : 's'} ·{' '}
                        {item.empresas} empresa{item.empresas === 1 ? '' : 's'}
                        {item.encargados.length > 0 && ` · ${item.encargados.join(', ')}`}
                        {item.avgResolutionHours != null &&
                          ` · ${formatHoursLabel(item.avgResolutionHours)} prom.`}
                      </Text>
                    </Paper>
                  ))}
                </SimpleGrid>
              </>
            ) : (
              <Text c='dimmed' ta='center' py='xl'>
                No hay procesos con actividad en este periodo
              </Text>
            )}
            </Box>
          </Card>
        </>
      )}

      <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
        <Title order={4} mb='md'>
          {isProcessView ? `Resumen · ${processFilter}` : 'Detalle por proceso'}
        </Title>
        {loading ? (
          <Skeleton height={120} />
        ) : processStats.length > 0 ? (
          <Stack gap='sm'>
            {processStats.slice(0, isProcessView ? 1 : 15).map((p) => (
              <Paper key={p.proceso} p='sm' withBorder>
                <Group justify='space-between' wrap='wrap' gap='xs'>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size='sm' fw={600} lineClamp={1}>
                      {p.proceso}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {p.categorias} categorías · {p.empresas} empresas
                      {p.encargados.length > 0 && ` · ${p.encargados.join(', ')}`}
                      {p.avgResolutionHours != null &&
                        ` · ${formatHoursLabel(p.avgResolutionHours)} prom.`}
                    </Text>
                  </div>
                  <Badge variant='light' color='blue'>
                    Volumen {formatNumber(p.solicitudes)}
                  </Badge>
                </Group>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text c='dimmed' ta='center' py='md'>
            No hay procesos en el periodo seleccionado
          </Text>
        )}
      </Card>
    </DashboardPageShell>
  );
}
