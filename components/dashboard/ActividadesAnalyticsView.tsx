'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useDashboardTasks } from '../../lib/dashboard/useDashboardTasks';
import { exportActividadesExcel } from '../../lib/dashboard/excel';
import {
  Card,
  Title,
  Text,
  Grid,
  SimpleGrid,
  Stack,
  Group,
  Alert,
  Skeleton,
  Badge,
  Tabs,
  Paper,
  Box,
  Loader,
} from '@mantine/core';
import EncargadoActivitiesChart from './EncargadoActivitiesChart';
import DashboardDateToolbar from './DashboardDateToolbar';
import DashboardPageShell from './DashboardPageShell';
import {
  ActividadesSection,
  ChartCard,
  KpiStatCard,
  MetricInsightCard,
  RankedListCard,
} from './actividades/ActividadesUi';
import { getDashboardCardPadding } from '../../lib/dashboard/responsive';
import { useChartViewport } from './useChartViewport';
import { dashboardTabsStyles, resolveChartHeight } from '../../lib/dashboard/responsive';
import {
  buildHorizontalMultiColorBarChart,
  buildPieChart,
  buildShareDoughnut,
  buildVerticalBarChart,
} from '../../lib/charts/builders';
import {
  computeActivityStats,
  allActivityRowsFromTasks,
} from '../../lib/dashboard/activityMetrics';
import {
  getFilterLabel,
  getPeriodRangeLabel,
  type DashboardDateFilter,
} from '../../lib/dashboard/dateRange';
import { dashboardChartTheme } from './chartTheme';
import { useProjectColors } from './useProjectColors';
import { ChartContainer } from './ChartContainer';
import {
  IconAlertCircle,
  IconChartBar,
  IconChartPie,
  IconChartLine,
  IconTrendingUp,
  IconTrendingDown,
  IconClock,
  IconCheck,
  IconCoin,
  IconList,
  IconUsers,
} from '@tabler/icons-react';

interface TaskData {
  id_tarea: number;
  tarea: string;
  estado_tarea: string;
  asignado_tarea: string;
  hora_inicio_tarea: string | null;
  fecha_fin_tarea: string | null;
  resolucion_tarea: string | null;
  fecha_resolucion_tarea: string | null;
  costo_tarea: number | null;
  centro_costo_tarea: string | null;
  activo_tarea: boolean;
  ejecutor_final_tarea: string | null;
  id_solicitud: number;
  asunto_solicitud: string;
  descripcion_solicitud: string;
  fecha_creacion_solicitud: string;
  empresa_solicitud: string;
  creador_solicitud: string;
  estado_solicitud: string;
  resolucion_solicitud: string | null;
  fecha_resolucion_solicitud: string | null;
  ejecutor_final_solicitud: string | null;
  proceso_solicitud: string;
  categoria_solicitud: string;
  encargado_proceso?: string | null;
}

export default function ActividadesAnalyticsView() {
  const projectColors = useProjectColors();
  const { data: session, status } = useSession();
  const router = useRouter();

  const {
    tasks: tasksFromCtx,
    teamRosterTasks,
    categoryMembers,
    loading,
    refreshing,
    error,
    dateFilter,
    setDateFilter,
    selectedMonthDate,
    setSelectedMonthDate,
    fetchTasks,
    isAdmin,
    loadingAdmin,
    appliedRange,
  } = useDashboardTasks();

  const rawTasks = tasksFromCtx as TaskData[];

  const isInitialLoad = loading && rawTasks.length === 0;
  const isRefreshing = refreshing || (loading && rawTasks.length > 0);

  /** Cada fila = una tarea asignada a un colaborador bajo el líder de área. */
  const activities = useMemo(() => allActivityRowsFromTasks(rawTasks), [rawTasks]);
  const teamActivities = useMemo(
    () => allActivityRowsFromTasks(teamRosterTasks as TaskData[]),
    [teamRosterTasks]
  );

  const activitiesWithCost = activities;
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) router.push('/login');
  }, [session, status, router]);

  const handleExportExcel = useCallback(async () => {
    try {
      setExportingExcel(true);
      await exportActividadesExcel({
        tasks: activitiesWithCost,
        dateFilter,
        selectedMonthDate,
        appliedRange,
      });
    } catch (err) {
      console.error('Error exportando actividades:', err);
    } finally {
      setExportingExcel(false);
    }
  }, [activities, dateFilter, selectedMonthDate, appliedRange]);

  const solicitudesUnicas = useMemo(
    () => new Set(rawTasks.map((t) => t.id_solicitud)).size,
    [rawTasks]
  );

  const stats = useMemo(() => computeActivityStats(rawTasks), [rawTasks]);
  const processData = activities.reduce((acc, task) => {
    const process = task.proceso_solicitud || 'Sin Proceso';
    acc[process] = (acc[process] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const processChartData = Object.entries(processData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const categoryData = activities.reduce((acc, task) => {
    const category = task.categoria_solicitud || 'Sin Categoría';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const categoryChartData = Object.entries(categoryData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Cost per solicitud (actividad)
  const costStats = {
    totalCost: activitiesWithCost.reduce((sum, t) => sum + (t.costo_tarea || 0), 0),
    tasksWithCost: activitiesWithCost.filter((t) => t.costo_tarea && t.costo_tarea > 0).length,
    averageCost:
      activitiesWithCost.filter((t) => t.costo_tarea && t.costo_tarea > 0).length > 0
        ? activitiesWithCost.reduce((sum, t) => sum + (t.costo_tarea || 0), 0) /
          activitiesWithCost.filter((t) => t.costo_tarea && t.costo_tarea > 0).length
        : 0,
    maxCost: Math.max(...activitiesWithCost.map((t) => t.costo_tarea || 0), 0),
  };

  const costByActivityData = activitiesWithCost.reduce((acc, task) => {
    const activity = task.tarea || 'Sin Actividad';
    if (!acc[activity]) {
      acc[activity] = { cost: 0, count: 0 };
    }
    acc[activity].cost += task.costo_tarea || 0;
    acc[activity].count += 1;
    return acc;
  }, {} as Record<string, { cost: number; count: number }>);

  const costByActivityChartData = Object.entries(costByActivityData)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      count: data.count,
      avgCost: data.count > 0 ? data.cost / data.count : 0,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Cost by cost center
  const costByCenterData = activitiesWithCost.reduce((acc, task) => {
    const center = task.centro_costo_tarea || 'Sin Centro de Costo';
    if (!acc[center]) {
      acc[center] = { cost: 0, count: 0 };
    }
    acc[center].cost += task.costo_tarea || 0;
    acc[center].count += 1;
    return acc;
  }, {} as Record<string, { cost: number; count: number }>);

  const costByCenterChartData = Object.entries(costByCenterData)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      count: data.count,
    }))
    .filter((item) => item.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Cost by process
  const costByProcessData = activitiesWithCost.reduce((acc, task) => {
    const process = task.proceso_solicitud || 'Sin Proceso';
    if (!acc[process]) {
      acc[process] = { cost: 0, count: 0 };
    }
    acc[process].cost += task.costo_tarea || 0;
    acc[process].count += 1;
    return acc;
  }, {} as Record<string, { cost: number; count: number }>);

  const costByProcessChartData = Object.entries(costByProcessData)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      count: data.count,
    }))
    .filter((item) => item.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Cost distribution for pie chart with project colors
  const costDistributionData = costByProcessChartData.slice(0, 5).map((item, index) => ({
    name: item.name,
    value: item.cost,
    color:
      [
        dashboardChartTheme.blue800,
        dashboardChartTheme.blue400,
        dashboardChartTheme.blue300,
        dashboardChartTheme.blue600,
        dashboardChartTheme.blue500,
      ][index] || projectColors.primary,
  }));

  // Format currency
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Format number with separators
  const formatNumber = (value: number): string => {
    return new Intl.NumberFormat('es-CO').format(value);
  };

  const pct = (n: number) => (stats.total > 0 ? (n / stats.total) * 100 : 0);

  const completionRate =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const { completada, pendiente, enProceso } = projectColors.chartStatusColors;
  const doughnutRestColor = projectColors.isDark
    ? 'rgba(255, 255, 255, 0.14)'
    : '#e2e8f0';

  const totalBreakdownChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(
        [
          {
            label: 'Completadas',
            value: stats.completed,
            color: completada,
          },
          {
            label: 'Pendientes',
            value: stats.pending,
            color: pendiente,
          },
          {
            label: 'En proceso',
            value: stats.inProgress,
            color: enProceso,
          },
          ...(stats.abierto > 0
            ? [
                {
                  label: 'Abiertas',
                  value: stats.abierto,
                  color: projectColors.abierto ?? projectColors.primary,
                },
              ]
            : []),
          ...(stats.other > 0
            ? [
                {
                  label: 'Otros estados',
                  value: stats.other,
                  color: projectColors.warning,
                },
              ]
            : []),
        ],
        false
      ),
    [
      stats.completed,
      stats.pending,
      stats.inProgress,
      stats.abierto,
      stats.other,
      completada,
      pendiente,
      enProceso,
      projectColors.warning,
    ]
  );

  const doughnutOpts = {
    showLegend: false,
    restColor: doughnutRestColor,
  } as const;

  const completedShareChart = useMemo(
    () =>
      buildShareDoughnut(
        stats.completed,
        stats.total,
        completada,
        'Completadas',
        doughnutOpts
      ),
    [stats.completed, stats.total, completada, doughnutRestColor]
  );

  const pendingShareChart = useMemo(
    () =>
      buildShareDoughnut(
        stats.pending,
        stats.total,
        pendiente,
        'Pendientes',
        doughnutOpts
      ),
    [stats.pending, stats.total, pendiente, doughnutRestColor]
  );

  const inProgressShareChart = useMemo(
    () =>
      buildShareDoughnut(
        stats.inProgress + stats.abierto,
        stats.total,
        enProceso,
        'En proceso',
        { ...doughnutOpts, emptyHint: 'Sin actividades en curso' }
      ),
    [stats.inProgress, stats.abierto, stats.total, enProceso, doughnutRestColor]
  );

  const processBarChart = buildVerticalBarChart(
    processChartData.map((d) => ({ name: d.name, value: d.value })),
    projectColors.primary,
    { datasetLabel: 'Cantidad', showLegend: true, rotateLabels: true }
  );
  const categoryBarChart = buildVerticalBarChart(
    categoryChartData.map((d) => ({ name: d.name, value: d.value })),
    projectColors.success,
    { datasetLabel: 'Cantidad', showLegend: true, rotateLabels: true }
  );
  const costPieChart = buildPieChart(costDistributionData);
  const costActivityBarChart = buildVerticalBarChart(
    costByActivityChartData.map((d) => ({ name: d.name, value: d.cost })),
    dashboardChartTheme.blue500,
    {
      datasetLabel: 'Costo',
      rotateLabels: true,
      formatValue: formatCurrency,
    }
  );
  const costProcessBarChart = buildVerticalBarChart(
    costByProcessChartData.map((d) => ({ name: d.name, value: d.cost })),
    dashboardChartTheme.blue600,
    {
      datasetLabel: 'Costo',
      rotateLabels: true,
      formatValue: formatCurrency,
      showLegend: true,
    }
  );
  const costCenterBarChart = buildVerticalBarChart(
    costByCenterChartData.map((d) => ({ name: d.name, value: d.cost })),
    dashboardChartTheme.blue400,
    {
      datasetLabel: 'Costo',
      rotateLabels: true,
      formatValue: formatCurrency,
      showLegend: true,
    }
  );

  const chartViewport = useChartViewport();
  const chartHeights = {
    bar: resolveChartHeight('hero', chartViewport),
    pie: resolveChartHeight('medium', chartViewport),
  };

  if (!session) {
    return null;
  }

  return (
    <DashboardPageShell
      title='Actividades'
      description='Tareas asignadas por área: cada actividad es una tarea con su responsable y el líder del proceso.'
      toolbar={
        <DashboardDateToolbar
          dateFilter={dateFilter}
          onDateFilterChange={setDateFilter}
          selectedMonthDate={selectedMonthDate}
          onSelectedMonthDateChange={setSelectedMonthDate}
          onRefresh={fetchTasks}
          loading={isInitialLoad || isRefreshing}
          onExport={handleExportExcel}
          exportingExcel={exportingExcel}
        />
      }
      gap='xl'
    >
        {error && (
          <Alert
            icon={<IconAlertCircle size={20} />}
            title='Error al cargar los datos'
            color='red'
            variant='light'
          >
            {error}
          </Alert>
        )}

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onChange={(value) => setActiveTab(value || 'overview')}
          keepMounted={false}
          styles={{
            ...dashboardTabsStyles,
            tab: {
              ...dashboardTabsStyles.tab,
              '&:hover': {
                backgroundColor: 'var(--mantine-color-gray-1)',
              },
              '&[dataActive]:hover': {
                backgroundColor: 'var(--mantine-color-blue-light)',
              },
            },
          }}
        >
          <Tabs.List>
            <Tabs.Tab value='overview' leftSection={<IconChartBar size={16} />}>
              Resumen
            </Tabs.Tab>
            <Tabs.Tab value='process' leftSection={<IconChartLine size={16} />}>
              Procesos
            </Tabs.Tab>
            <Tabs.Tab value='category' leftSection={<IconList size={16} />}>
              Categorías
            </Tabs.Tab>
            <Tabs.Tab value='cost' leftSection={<IconCoin size={16} />}>
              Costos
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value='overview'>
            <Stack gap='xl' mt='md'>
              <ActividadesSection
                priority={1}
                title='Panorama del periodo'
                description='Tareas asignadas en el periodo: cada fila es una actividad con responsable y líder de área.'
              >
                <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing={{ base: 'sm', sm: 'md' }}>
                  <MetricInsightCard
                    compact
                    label='Total actividades'
                    value={formatNumber(stats.total)}
                    hint={`${formatNumber(solicitudesUnicas)} solicitudes · ${appliedRange ?? getPeriodRangeLabel(dateFilter, selectedMonthDate)}`}
                    color={projectColors.primary}
                    icon={IconChartBar}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                    chartTitle='Composición del total'
                    chartDescription='Tareas por estado'
                    chartType='bar'
                    chartData={totalBreakdownChart.data}
                    chartOptions={totalBreakdownChart.options}
                    emptyMessage='No hay actividades en este periodo'
                  />
                  <MetricInsightCard
                    compact
                    label='Completadas'
                    value={formatNumber(stats.completed)}
                    hint={`${completionRate}% del total · avance del equipo`}
                    sharePercent={pct(stats.completed)}
                    color={completada}
                    icon={IconCheck}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                    chartTitle='Participación completadas'
                    chartDescription='Porción del total ya finalizada'
                    chartType='pie'
                    chartData={completedShareChart.data}
                    chartOptions={completedShareChart.options}
                  />
                  <MetricInsightCard
                    compact
                    label='Pendientes'
                    value={formatNumber(stats.pending)}
                    hint='Requieren atención o asignación'
                    sharePercent={pct(stats.pending)}
                    color={pendiente}
                    icon={IconClock}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                    chartTitle='Participación pendientes'
                    chartDescription='Porción del total aún sin iniciar o en espera'
                    chartType='pie'
                    chartData={pendingShareChart.data}
                    chartOptions={pendingShareChart.options}
                  />
                  <MetricInsightCard
                    compact
                    label='En proceso'
                    value={formatNumber(stats.inProgress + stats.abierto)}
                    hint={
                      stats.abierto > 0
                        ? `${formatNumber(stats.inProgress)} en curso · ${formatNumber(stats.abierto)} abiertas`
                        : 'Trabajo en curso en el periodo'
                    }
                    sharePercent={pct(stats.inProgress + stats.abierto)}
                    color={enProceso}
                    icon={IconTrendingUp}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                    chartTitle='Participación en curso'
                    chartDescription='Porción del total con ejecución activa'
                    chartType='pie'
                    chartData={inProgressShareChart.data}
                    chartOptions={inProgressShareChart.options}
                  />
                </SimpleGrid>

                {stats.total > 0 && stats.pending > stats.completed && (
                  <Paper p='md' radius='md' withBorder bg='orange.0'>
                    <Text size='sm' c='orange.9'>
                      Hay más actividades pendientes ({formatNumber(stats.pending)}) que completadas (
                      {formatNumber(stats.completed)}). Revisa asignaciones y plazos del periodo.
                    </Text>
                  </Paper>
                )}
              </ActividadesSection>

              {(loadingAdmin || isAdmin) && (
                <ActividadesSection
                  priority={2}
                  title='Desempeño por encargado'
                  description='Líderes de área y tareas asignadas a su equipo en el periodo.'
                >
                  {loadingAdmin ? (
                    <Group justify='center' py='xl'>
                      <Loader size='sm' />
                    </Group>
                  ) : (
                    <Card
                      shadow='sm'
                      padding={getDashboardCardPadding()}
                      radius='md'
                      withBorder
                      style={{ position: 'relative' }}
                    >
                      {isRefreshing ? (
                        <Box
                          aria-hidden
                          style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 'inherit',
                            background:
                              'color-mix(in srgb, var(--app-surface, #fff) 72%, transparent)',
                            backdropFilter: 'blur(1px)',
                          }}
                        >
                          <Loader size='sm' color='blue' />
                        </Box>
                      ) : null}
                      <Group gap='xs' mb='md'>
                        <IconUsers size={18} color={projectColors.primary} />
                        <Text size='sm' fw={600}>
                          Rendimiento por líder de área
                        </Text>
                      </Group>
                      <EncargadoActivitiesChart
                        tasks={activities}
                        teamTasks={teamActivities}
                        categoryMembers={categoryMembers}
                        periodLabel={getFilterLabel(dateFilter)}
                      />
                    </Card>
                  )}
                </ActividadesSection>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value='process'>
            <Stack gap='xl' mt='md'>
              <ActividadesSection
                priority={1}
                title='Carga por proceso'
                description='Identifica qué procesos concentran más tareas en el periodo.'
              >
                <Grid gutter='lg' align='stretch'>
                  <Grid.Col span={{ base: 12, lg: 7 }}>
                    <ChartCard
                      title='Top 10 procesos'
                      description='Barras ordenadas por volumen de tareas'
                      refreshing={isRefreshing}
                    >
                      {isInitialLoad ? (
                        <Skeleton height={chartHeights.bar} radius='md' />
                      ) : (
                        <ChartContainer
                          type='bar'
                          data={processBarChart.data}
                          options={processBarChart.options}
                          height={chartHeights.bar}
                        />
                      )}
                    </ChartCard>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, lg: 5 }}>
                    <RankedListCard
                      title='Ranking'
                      description='Comparación relativa frente al proceso con más tareas'
                      items={processChartData}
                      formatValue={(n) => `${formatNumber(n)} tareas`}
                      emptyMessage='No hay tareas asociadas a procesos en este periodo'
                    />
                  </Grid.Col>
                </Grid>
              </ActividadesSection>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value='category'>
            <Stack gap='xl' mt='md'>
              <ActividadesSection
                priority={1}
                title='Carga por categoría'
                description='Ayuda a ver qué tipos de solicitud generan más trabajo operativo.'
              >
                <Grid gutter='lg' align='stretch'>
                  <Grid.Col span={{ base: 12, lg: 7 }}>
                    <ChartCard
                      title='Top 10 categorías'
                      description='Barras ordenadas por volumen de tareas'
                      refreshing={isRefreshing}
                    >
                      {isInitialLoad ? (
                        <Skeleton height={chartHeights.bar} radius='md' />
                      ) : (
                        <ChartContainer
                          type='bar'
                          data={categoryBarChart.data}
                          options={categoryBarChart.options}
                          height={chartHeights.bar}
                        />
                      )}
                    </ChartCard>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, lg: 5 }}>
                    <RankedListCard
                      title='Ranking'
                      description='Comparación relativa frente a la categoría líder'
                      items={categoryChartData}
                      formatValue={(n) => `${formatNumber(n)} tareas`}
                      emptyMessage='No hay tareas con categoría en este periodo'
                    />
                  </Grid.Col>
                </Grid>
              </ActividadesSection>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value='cost'>
            <Stack gap='xl' mt='md'>
              <ActividadesSection
                priority={1}
                title='Resumen económico'
                description='Métricas de costo del periodo antes de entrar al detalle por proceso o actividad.'
              >
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <KpiStatCard
                    label='Costo total'
                    value={formatCurrency(costStats.totalCost)}
                    hint={`Periodo ${getFilterLabel(dateFilter)}`}
                    color='#059669'
                    icon={IconCoin}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                  />
                  <KpiStatCard
                    label='Tareas con costo'
                    value={formatNumber(costStats.tasksWithCost)}
                    hint={`de ${formatNumber(stats.total)} tareas en el periodo`}
                    sharePercent={
                      stats.total > 0 ? (costStats.tasksWithCost / stats.total) * 100 : 0
                    }
                    color={projectColors.primary}
                    icon={IconChartBar}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                  />
                  <KpiStatCard
                    label='Costo promedio'
                    value={formatCurrency(costStats.averageCost)}
                    hint='Por actividad que registra costo'
                    color='#ea580c'
                    icon={IconTrendingUp}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                  />
                  <KpiStatCard
                    label='Costo máximo'
                    value={formatCurrency(costStats.maxCost)}
                    hint='Mayor valor registrado en una tarea'
                    color='#dc2626'
                    icon={IconTrendingDown}
                    loading={isInitialLoad}
                    refreshing={isRefreshing}
                  />
                </SimpleGrid>
              </ActividadesSection>

              <ActividadesSection
                priority={2}
                title='Distribución del gasto'
                description='Dónde se concentra el costo: por proceso y por tipo de actividad.'
              >
                <Grid gutter='lg'>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <ChartCard
                      title='Costo por proceso'
                      description='Participación de los 5 procesos con mayor gasto'
                      refreshing={isRefreshing}
                    >
                      {costDistributionData.length > 0 ? (
                        <ChartContainer
                          type='pie'
                          data={costPieChart.data}
                          options={costPieChart.options}
                          height={chartHeights.pie}
                          scrollable={false}
                        />
                      ) : (
                        <Text c='dimmed' ta='center' py='xl'>
                          No hay costos registrados en este periodo
                        </Text>
                      )}
                    </ChartCard>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <ChartCard
                      title='Costo por actividad'
                      description='Top 10 actividades con mayor gasto acumulado'
                      refreshing={isRefreshing}
                    >
                      {costByActivityChartData.length > 0 ? (
                        <ChartContainer
                          type='bar'
                          data={costActivityBarChart.data}
                          options={costActivityBarChart.options}
                          height={chartHeights.pie}
                        />
                      ) : (
                        <Text c='dimmed' ta='center' py='xl'>
                          No hay costos por actividad en este periodo
                        </Text>
                      )}
                    </ChartCard>
                  </Grid.Col>
                </Grid>
              </ActividadesSection>

              <ActividadesSection
                priority={3}
                title='Análisis por dimensión'
                description='Comparativos por proceso y centro de costo cuando hay datos.'
              >
                <Stack gap='lg'>
                  <ChartCard
                    title='Costo por proceso (Top 10)'
                    description='Barras ordenadas por gasto total'
                    refreshing={isRefreshing}
                  >
                    {costByProcessChartData.length > 0 ? (
                      <ChartContainer
                        type='bar'
                        data={costProcessBarChart.data}
                        options={costProcessBarChart.options}
                        height={chartHeights.bar}
                      />
                    ) : (
                      <Text c='dimmed' ta='center' py='xl'>
                        No hay costos por proceso en este periodo
                      </Text>
                    )}
                  </ChartCard>

                  {costByCenterChartData.length > 0 && (
                    <ChartCard
                      title='Costo por centro de costo (Top 10)'
                      description='Centros con mayor impacto económico'
                    >
                      <ChartContainer
                        type='bar'
                        data={costCenterBarChart.data}
                        options={costCenterBarChart.options}
                        height={chartHeights.bar}
                      />
                    </ChartCard>
                  )}
                </Stack>
              </ActividadesSection>

              <ActividadesSection
                priority={4}
                title='Detalle por actividad'
                description='Tabla legible con totales, cantidad de tareas y promedio.'
              >
                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Stack gap='sm'>
                    {costByActivityChartData.length > 0 ? (
                      costByActivityChartData.map((item, index) => (
                        <Paper key={item.name} p='md' withBorder radius='md'>
                          <Group justify='space-between' wrap='wrap' gap='sm' mb='xs'>
                            <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
                              <Badge variant='filled' color='green' size='sm' circle>
                                {index + 1}
                              </Badge>
                              <Text size='sm' fw={600} truncate='end'>
                                {item.name}
                              </Text>
                            </Group>
                            <Badge variant='filled' color='green'>
                              {formatCurrency(item.cost)}
                            </Badge>
                          </Group>
                          <Group gap='md'>
                            <Text size='xs' c='dimmed'>
                              {item.count} tareas
                            </Text>
                            <Text size='xs' c='dimmed'>
                              Promedio: {formatCurrency(item.avgCost)}
                            </Text>
                          </Group>
                        </Paper>
                      ))
                    ) : (
                      <Text c='dimmed' ta='center' py='xl'>
                        No hay detalle de costos en este periodo
                      </Text>
                    )}
                  </Stack>
                </Card>
              </ActividadesSection>
            </Stack>
          </Tabs.Panel>
        </Tabs>
    </DashboardPageShell>
  );
}
