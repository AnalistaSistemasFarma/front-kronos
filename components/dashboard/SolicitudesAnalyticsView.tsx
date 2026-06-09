'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
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
  IconChartLine,
  IconCheck,
  IconClock,
  IconClockHour4,
  IconTrendingUp,
  IconCircleDot,
  IconUsers,
} from '@tabler/icons-react';
import {
  buildAreaLineChart,
  buildHorizontalMultiColorBarChart,
  buildHoursLineChart,
  buildPieChart,
  buildVerticalBarChart,
} from '../../lib/charts/builders';
import {
  buildCompleteRequestTimeSeries,
  buildRequestTimeSeries,
  buildRequestsByEncargado,
  formatRequestTimeSeriesLabel,
} from '../../lib/dashboard/requestAnalytics';
import { getPeriodRangeLabel } from '../../lib/dashboard/dateRange';
import {
  ALL_COMPANIES_VALUE,
  buildAvgResolutionTimeSeries,
  computeResolutionSummary,
  enrichRequestsWithResolution,
  formatHoursLabel,
} from '../../lib/dashboard/requestResolution';
import { listCompaniesFromRequests } from '../../lib/dashboard/viewRequestsQuery';
import { useDashboardTasks } from '../../lib/dashboard/useDashboardTasks';
import { ChartContainer } from './ChartContainer';
import { useScrollableBarChartLayout } from './useScrollableBarChartLayout';
import DashboardDateToolbar, { DashboardPeriodHint } from './DashboardDateToolbar';
import DashboardPageShell from './DashboardPageShell';
import SolicitudesResolutionTable from './SolicitudesResolutionTable';
import { useChartViewport } from './useChartViewport';
import { useProjectColors } from './useProjectColors';
import { getDashboardCardPadding, resolveChartHeight } from '../../lib/dashboard/responsive';
import { useDashboardChartPalette } from './useDashboardChartPalette';
import {
  countRequestsByDashboardStatus,
  normalizeRequestStatus,
} from '../../lib/dashboard/requestStatus';
import { exportSolicitudesExcel } from '../../lib/dashboard/excel';

export default function SolicitudesAnalyticsView() {
  const projectColors = useProjectColors();
  const { barPalette } = useDashboardChartPalette();
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

  const [exportingExcel, setExportingExcel] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>(ALL_COMPANIES_VALUE);

  const handleExportExcel = useCallback(async () => {
    try {
      setExportingExcel(true);
      await exportSolicitudesExcel({
        tasks,
        requests: requestsFromCtx,
        dateFilter,
        selectedMonthDate,
        appliedRange,
        companyFilter,
      });
    } catch (err) {
      console.error('Error exportando solicitudes:', err);
    } finally {
      setExportingExcel(false);
    }
  }, [tasks, requestsFromCtx, dateFilter, selectedMonthDate, appliedRange, companyFilter]);

  const allRequests = requestsFromCtx;
  const companies = useMemo(() => listCompaniesFromRequests(allRequests), [allRequests]);

  const filteredTasks = useMemo(() => {
    if (companyFilter === ALL_COMPANIES_VALUE) return tasks;
    return tasks.filter((t) => t.empresa_solicitud === companyFilter);
  }, [tasks, companyFilter]);

  const requests = useMemo(() => {
    if (companyFilter === ALL_COMPANIES_VALUE) return allRequests;
    return allRequests.filter((r) => r.empresa_solicitud === companyFilter);
  }, [allRequests, companyFilter]);

  const enrichedRequests = useMemo(
    () => enrichRequestsWithResolution(requests, filteredTasks),
    [requests, filteredTasks]
  );

  const resolutionSummary = useMemo(
    () => computeResolutionSummary(enrichedRequests),
    [enrichedRequests]
  );

  const isCompanyView = companyFilter !== ALL_COMPANIES_VALUE;

  useEffect(() => {
    setCompanyFilter(ALL_COMPANIES_VALUE);
  }, [dateFilter, selectedMonthDate]);

  const stats = useMemo(() => countRequestsByDashboardStatus(requests), [requests]);

  const statusData = useMemo(
    () =>
      [
        { name: 'Abiertas', value: stats.abierto, color: projectColors.abierto },
        { name: 'En proceso', value: stats.enProceso, color: projectColors.enProceso },
        { name: 'Cerradas', value: stats.cerrada, color: projectColors.success },
        { name: 'Pendientes', value: stats.pendiente, color: projectColors.warning },
      ].filter((i) => i.value > 0),
    [stats, projectColors]
  );

  const companyChartData = useMemo(() => {
    const data = allRequests.reduce(
      (acc, r) => {
        const c = r.empresa_solicitud || 'Sin empresa';
        acc[c] = (acc[c] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return Object.entries(data)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [allRequests]);

  const encargadoRequestStats = useMemo(
    () => buildRequestsByEncargado(requests),
    [requests]
  );

  const encargadoChartItems = useMemo(
    () =>
      encargadoRequestStats.map((item, index) => ({
        label: item.encargado,
        value: item.count,
        color: barPalette[index % barPalette.length],
        procesos: item.procesos,
      })),
    [encargadoRequestStats, barPalette]
  );

  const timeSeriesChartData = useMemo(() => {
    const raw = buildRequestTimeSeries(requests, dateFilter, selectedMonthDate);
    return buildCompleteRequestTimeSeries(requests, raw, dateFilter, selectedMonthDate).map(
      ([key, count]) => ({
        date: formatRequestTimeSeriesLabel(key, dateFilter),
        Solicitudes: count,
      })
    );
  }, [requests, dateFilter, selectedMonthDate]);

  const resolutionTimeSeries = useMemo(() => {
    const points = buildAvgResolutionTimeSeries(enrichedRequests, (key) =>
      formatRequestTimeSeriesLabel(key, dateFilter)
    );
    return points.map((p) => ({ label: p.label, value: p.avgHours }));
  }, [enrichedRequests, dateFilter]);

  const statusPieChart = buildPieChart(statusData);
  const trendLineChart = buildAreaLineChart(
    timeSeriesChartData.map((d) => ({ label: d.date, value: d.Solicitudes })),
    projectColors.secondary
  );
  const resolutionLineChart = buildHoursLineChart(
    resolutionTimeSeries,
    projectColors.primary,
    formatHoursLabel
  );
  const companyBarChart = buildVerticalBarChart(
    companyChartData.map((d) => ({ name: d.name, value: d.value })),
    projectColors.success,
    { datasetLabel: 'Solicitudes', showLegend: true, rotateLabels: true }
  );

  const chartViewport = useChartViewport();
  const isMobile = chartViewport.isMobile;
  const encargadoChartLayout = useScrollableBarChartLayout(encargadoChartItems.length);
  const encargadoBarChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(encargadoChartItems, isMobile, {
        valueLabel: 'solicitudes',
        datasetLabel: 'Solicitudes',
      }),
    [encargadoChartItems, isMobile]
  );

  const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);

  const companySelectData = useMemo(
    () => [
      { value: ALL_COMPANIES_VALUE, label: 'General (todas las empresas)' },
      ...companies.map((c) => ({ value: c, label: c })),
    ],
    [companies]
  );

  const chartHeights = {
    standard: resolveChartHeight('standard', chartViewport),
    medium: resolveChartHeight('medium', chartViewport),
    large: resolveChartHeight('large', chartViewport),
  };

  if (status === 'loading' && !tasks.length) {
    return (
      <DashboardPageShell title='Solicitudes'>
        <Skeleton height={50} mb='xl' />
        <Skeleton height={200} />
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      title='Solicitudes'
      description={
        <Stack gap={4}>
          <Text size='sm' c='dimmed' component='span' display='block'>
            {isCompanyView
              ? `Analítica de ${companyFilter} · creación y tiempo de cierre por solicitud`
              : 'Estados, empresas y tiempos de cierre de solicitudes en el periodo'}
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
          onExport={handleExportExcel}
          exportingExcel={exportingExcel}
        />
      }
    >
        <Paper p={{ base: 'sm', sm: 'md' }} radius='md' withBorder>
          <Select
            label='Empresa'
            description={
              isCompanyView
                ? 'Métricas de finalización y detalle por solicitud de esta empresa'
                : 'Vista comparativa entre todas las empresas del periodo'
            }
            leftSection={<IconBuilding size={18} />}
            data={companySelectData}
            value={companyFilter}
            onChange={(v) => setCompanyFilter(v ?? ALL_COMPANIES_VALUE)}
            allowDeselect={false}
            searchable={companies.length > 4}
            nothingFoundMessage='Sin empresas en el periodo'
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
            md: 3,
            lg: isCompanyView ? 3 : 5,
            xl: isCompanyView ? 6 : 5,
          }}
          spacing={{ base: 'sm', sm: 'md' }}
        >
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
            <Text size='sm' c='dimmed'>
              Total solicitudes
            </Text>
            <Title order={3} style={{ color: projectColors.primary }}>
              {formatNumber(stats.total)}
            </Title>
            <Text size='xs' c='dimmed'>
              Una fila por solicitud () · {appliedRange ?? getPeriodRangeLabel(dateFilter, selectedMonthDate)}
              {isCompanyView && ` · ${companyFilter}`}
            </Text>
          </Card>
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
            <Group justify='space-between' mb='xs'>
              <Text size='sm' c='dimmed'>
                Abiertas
              </Text>
              <IconCircleDot size={20} color={projectColors.abierto} />
            </Group>
            <Title order={3} style={{ color: projectColors.abierto }}>
              {formatNumber(stats.abierto)}
            </Title>
          </Card>
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
            <Group justify='space-between' mb='xs'>
              <Text size='sm' c='dimmed'>
                En proceso
              </Text>
              <IconTrendingUp size={20} color={projectColors.enProceso} />
            </Group>
            <Title order={3} style={{ color: projectColors.enProceso }}>
              {formatNumber(stats.enProceso)}
            </Title>
          </Card>
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
            <Group justify='space-between' mb='xs'>
              <Text size='sm' c='dimmed'>
                Cerradas
              </Text>
              <IconCheck size={20} color={projectColors.success} />
            </Group>
            <Title order={3} style={{ color: projectColors.success }}>
              {formatNumber(stats.cerrada)}
            </Title>
          </Card>
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
            <Group justify='space-between' mb='xs'>
              <Text size='sm' c='dimmed'>
                Pendientes
              </Text>
              <IconClock size={20} color={projectColors.warning} />
            </Group>
            <Title order={3} style={{ color: projectColors.warning }}>
              {formatNumber(stats.pendiente)}
            </Title>
          </Card>
          {isCompanyView && (
            <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
              <Group justify='space-between' mb='xs'>
                <Text size='sm' c='dimmed'>
                  Tiempo prom. cierre
                </Text>
                <IconClockHour4 size={20} color={projectColors.primary} />
              </Group>
              <Title order={3} style={{ color: projectColors.primary }}>
                {formatHoursLabel(resolutionSummary.avgHours)}
              </Title>
              <Text size='xs' c='dimmed'>
                {resolutionSummary.closedWithTime} con fecha de cierre
              </Text>
            </Card>
          )}
        </SimpleGrid>

        {isCompanyView && (
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Paper p='md' radius='md' withBorder>
              <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                Mediana de cierre
              </Text>
              <Text size='xl' fw={800} mt={4} style={{ color: projectColors.primary }}>
                {formatHoursLabel(resolutionSummary.medianHours)}
              </Text>
            </Paper>
            <Paper p='md' radius='md' withBorder>
              <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                Más rápida
              </Text>
              <Text size='xl' fw={800} mt={4} c='teal'>
                {formatHoursLabel(resolutionSummary.minHours)}
              </Text>
            </Paper>
            <Paper p='md' radius='md' withBorder>
              <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                Más lenta
              </Text>
              <Text size='xl' fw={800} mt={4} c='orange'>
                {formatHoursLabel(resolutionSummary.maxHours)}
              </Text>
              <Text size='xs' c='dimmed' mt={4}>
                {resolutionSummary.openCount} sin cierre registrado
              </Text>
            </Paper>
          </SimpleGrid>
        )}

        <Grid gutter='lg' align='stretch'>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder h='100%'>
              <Title order={4} mb='xs'>
                Tendencia de solicitudes
              </Title>
              <Text size='xs' c='dimmed' mb='md'>
                Cuándo se crean las solicitudes en el periodo
              </Text>
              {loading ? (
                <Skeleton height={chartHeights.standard} />
              ) : timeSeriesChartData.length > 0 ? (
                <ChartContainer
                  type='line'
                  data={trendLineChart.data}
                  options={trendLineChart.options}
                  height={chartHeights.standard}
                />
              ) : (
                <Flex h={chartHeights.standard} align='center' justify='center'>
                  <Stack align='center' gap='sm'>
                    <IconChartLine size={48} color={projectColors.primary} opacity={0.3} />
                    <Text c='dimmed' size='sm'>
                      No hay solicitudes en este periodo
                    </Text>
                  </Stack>
                </Flex>
              )}
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder h='100%'>
              <Title order={4} mb='xs'>
                Estado de solicitudes
              </Title>
              <Text size='xs' c='dimmed' mb='md'>
                {isCompanyView ? `Distribución en ${companyFilter}` : 'Distribución global'}
              </Text>
              {loading ? (
                <Skeleton height={chartHeights.standard} />
              ) : statusData.length > 0 ? (
                <ChartContainer
                  type='pie'
                  data={statusPieChart.data}
                  options={statusPieChart.options}
                  height={chartHeights.standard}
                />
              ) : (
                <Flex h={chartHeights.standard} align='center' justify='center'>
                  <Text size='sm' c='dimmed'>
                    Sin datos de estado
                  </Text>
                </Flex>
              )}
            </Card>
          </Grid.Col>
        </Grid>

        {isCompanyView && (
          <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
            <Title order={4} mb='xs'>
              Tiempo promedio de finalización
            </Title>
            <Text size='xs' c='dimmed' mb='md'>
              Desde la creación de la solicitud hasta su cierre (fecha de resolución o última tarea
              cerrada)
            </Text>
            {loading ? (
              <Skeleton height={chartHeights.medium} />
            ) : resolutionTimeSeries.length > 0 ? (
              <ChartContainer
                type='line'
                data={resolutionLineChart.data}
                options={resolutionLineChart.options}
                height={chartHeights.medium}
              />
            ) : (
              <Text c='dimmed' ta='center' py='xl'>
                Aún no hay solicitudes cerradas con tiempo calculable en este periodo
              </Text>
            )}
          </Card>
        )}

        {!isCompanyView && (
          <Grid gutter='lg'>
            <Grid.Col span={12}>
              <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
                <Title order={4} mb='md'>
                  Solicitudes por empresa
                </Title>
                {!loading && companyChartData.length > 0 ? (
                  <ChartContainer
                    type='bar'
                    data={companyBarChart.data}
                    options={companyBarChart.options}
                    height={chartHeights.large}
                  />
                ) : (
                  <Text c='dimmed' ta='center' py='xl'>
                    Sin datos
                  </Text>
                )}
              </Card>
            </Grid.Col>
          </Grid>
        )}

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group gap='xs' mb={4}>
            <IconUsers size={20} color={projectColors.primary} />
            <Title order={4}>Solicitudes por encargado de área</Title>
          </Group>
          <Text size='xs' c='dimmed' mb='md'>
            {isCompanyView
              ? `Carga de solicitudes de ${companyFilter} por líder de área`
              : 'Volumen de solicitudes gestionadas por cada líder de área'}
          </Text>
          {loading ? (
            <Skeleton height={encargadoChartLayout.maxHeight ?? encargadoChartLayout.height} radius='md' />
          ) : encargadoChartItems.length > 0 ? (
            <>
              <ChartContainer
                type='bar'
                data={encargadoBarChart.data}
                options={encargadoBarChart.options}
                height={encargadoChartLayout.height}
                maxHeight={encargadoChartLayout.maxHeight}
                scrollable={encargadoChartLayout.scrollHorizontal}
              />
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='sm' mt='lg'>
                {encargadoRequestStats.map((item, index) => (
                  <Paper key={item.encargado} p='sm' withBorder radius='md'>
                    <Group justify='space-between' wrap='nowrap' gap='xs' mb={6}>
                      <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
                        <Badge variant='filled' color='blue' size='sm' circle>
                          {index + 1}
                        </Badge>
                        <Text size='sm' fw={600} lineClamp={2}>
                          {item.encargado}
                        </Text>
                      </Group>
                      <Badge variant='light' color='blue'>
                        {formatNumber(item.count)} solic.
                      </Badge>
                    </Group>
                    <Text size='xs' c='dimmed' lineClamp={2}>
                      {item.procesos.length > 0
                        ? `Áreas: ${item.procesos.join(' · ')}`
                        : 'Sin área asignada'}
                    </Text>
                  </Paper>
                ))}
              </SimpleGrid>
            </>
          ) : (
            <Text c='dimmed' ta='center' py='xl'>
              No hay solicitudes con encargado de área en este periodo
            </Text>
          )}
        </Card>

        <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
          <Group justify='space-between' mb='md' wrap='wrap'>
            <div>
              <Title order={4}>
                {isCompanyView
                  ? 'Tiempo de finalización por solicitud'
                  : 'Últimas solicitudes del periodo'}
              </Title>
              {isCompanyView && (
                <Text size='xs' c='dimmed' mt={4}>
                  Compare cuánto tarda el equipo en cerrar cada pedido
                </Text>
              )}
            </div>
            {isCompanyView && resolutionSummary.avgHours != null && (
              <Badge
                size='lg'
                variant='light'
                leftSection={<IconClockHour4 size={14} />}
                styles={{
                  root: {
                    backgroundColor: projectColors.palette.blue50,
                    color: projectColors.primary,
                  },
                }}
              >
                Promedio: {formatHoursLabel(resolutionSummary.avgHours)}
              </Badge>
            )}
          </Group>
          {loading ? (
            <Skeleton height={120} />
          ) : isCompanyView ? (
            <SolicitudesResolutionTable requests={enrichedRequests} />
          ) : (
            <Stack gap='sm'>
              {requests.length > 0 ? (
                requests.slice(0, 15).map((r) => (
                  <Paper key={r.id_solicitud} p='sm' withBorder>
                    <Group justify='space-between' wrap='wrap' gap='xs'>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text size='sm' fw={600} lineClamp={1}>
                          #{r.id_solicitud} · {r.asunto_solicitud}
                        </Text>
                        <Text size='xs' c='dimmed'>
                          {r.empresa_solicitud} · {r.creador_solicitud}
                        </Text>
                      </div>
                      <Badge variant='light'>{normalizeRequestStatus(r.estado_solicitud)}</Badge>
                    </Group>
                  </Paper>
                ))
              ) : (
                <Text c='dimmed' ta='center' py='md'>
                  No hay solicitudes en el periodo seleccionado
                </Text>
              )}
            </Stack>
          )}
        </Card>
    </DashboardPageShell>
  );
}
