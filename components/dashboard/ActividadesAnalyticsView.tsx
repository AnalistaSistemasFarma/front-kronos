'use client';

import { useState, useEffect, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
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
  Flex,
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
  buildAreaLineChart,
  buildHorizontalMultiColorBarChart,
  buildPieChart,
  buildShareDoughnut,
  buildVerticalBarChart,
} from '../../lib/charts/builders';
import {
  formatDateLocal,
  getDashboardDateRange,
  getFilterLabel,
  type DashboardDateFilter,
} from '../../lib/dashboard/dateRange';
import {
  dashboardChartTheme,
  statusChartColors,
} from './chartTheme';
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

type DateFilter = DashboardDateFilter;

// Paleta azul SynerLink (compartida con chartTheme)
const projectColors = {
  primary: dashboardChartTheme.primary,
  secondary: dashboardChartTheme.secondary,
  success: statusChartColors.completada,
  warning: statusChartColors.pendiente,
  error: dashboardChartTheme.blue600,
  purple: dashboardChartTheme.blue500,
  teal: dashboardChartTheme.blue300,
};

export default function ActividadesAnalyticsView() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('month');
  const [selectedMonthDate, setSelectedMonthDate] = useState<Date>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  useEffect(() => {
    if (status === 'loading') return;
    if (!session) router.push('/login');
  }, [session, status, router]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!session?.user?.email) {
        setIsAdmin(false);
        setLoadingAdmin(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/requests-general/verify-permissions?email=${encodeURIComponent(session.user.email)}`
        );
        if (res.ok) {
          const data = await res.json();
          setIsAdmin(Boolean(data.user?.isAdmin));
        } else {
          setIsAdmin(false);
        }
      } catch {
        setIsAdmin(false);
      } finally {
        setLoadingAdmin(false);
      }
    };
    if (status === 'authenticated') {
      checkAdmin();
    }
  }, [session?.user?.email, status]);

  useEffect(() => {
    fetchTasks();
  }, [dateFilter, selectedMonthDate]);

  const exportDashboardToExcel = async () => {
    try {
      setExportingExcel(true);
      const dateRange = getDashboardDateRange(dateFilter, selectedMonthDate);
      let exportUrl = '/api/dashboard/export';
      if (dateRange) {
        const params = new URLSearchParams({
          date_from: dateRange.startDate,
          date_to: dateRange.endDate,
        });
        exportUrl = `${exportUrl}?${params}`;
      }
      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error('Error al obtener datos del servidor');
      const { solicitudes, actividades } = await res.json();

      const workbook = new ExcelJS.Workbook();

      const sheet1 = workbook.addWorksheet('Solicitudes');
      if (solicitudes.length > 0) {
        sheet1.columns = Object.keys(solicitudes[0]).map((k: string) => ({ header: k, key: k }));
        solicitudes.forEach((row: Record<string, unknown>) => sheet1.addRow(row));
      }

      const sheet2 = workbook.addWorksheet('Actividades');
      if (actividades.length > 0) {
        sheet2.columns = Object.keys(actividades[0]).map((k: string) => ({ header: k, key: k }));
        actividades.forEach((row: Record<string, unknown>) => sheet2.addRow(row));
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, 'Dashboard-Kronos.xlsx');
    } catch (err) {
      console.error('Error exportando Excel:', err);
    } finally {
      setExportingExcel(false);
    }
  };

  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError(null);

      const dateRange = getDashboardDateRange(dateFilter, selectedMonthDate);

      let url = '/api/requests-general/view-tasks';
      if (dateRange) {
        const params = new URLSearchParams({
          date_from: dateRange.startDate,
          date_to: dateRange.endDate,
        });
        url = `${url}?${params}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error || 'Error al cargar los datos del dashboard'
        );
      }

      const result = await response.json();
      setTasks(result.data || []);
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  // Calculate statistics
  const stats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.estado_tarea === 'Completada').length,
    pending: tasks.filter((t) => t.estado_tarea === 'Pendiente').length,
    inProgress: tasks.filter((t) => t.estado_tarea === 'En Proceso').length,
    active: tasks.filter((t) => t.activo_tarea).length,
  };

  // Prepare data for charts with project colors
  const processData = tasks.reduce((acc, task) => {
    const process = task.proceso_solicitud || 'Sin Proceso';
    acc[process] = (acc[process] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const processChartData = Object.entries(processData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const categoryData = tasks.reduce((acc, task) => {
    const category = task.categoria_solicitud || 'Sin Categoría';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const categoryChartData = Object.entries(categoryData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Sortable keys per filter:
  //   month    → YYYY-MM-DD  (daily)
  //   quarter  → YYYY-MM-DD of week's Sunday (weekly)
  //   semester → YYYY-MM     (monthly)
  //   year     → YYYY-MM     (monthly)
  //   all      → YYYY-Qn     (quarterly, e.g. "2025-Q1")
  const getDateKey = (date: Date, filter: DateFilter): string => {
    const year = date.getFullYear();
    const month = date.getMonth();

    switch (filter) {
      case 'month':
        return formatDateLocal(date);
      case 'quarter': {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay()); // rewind to Sunday
        return formatDateLocal(weekStart);
      }
      case 'semester':
      case 'year':
        return `${year}-${String(month + 1).padStart(2, '0')}`;
      case 'all': {
        const q = Math.floor(month / 3) + 1;
        return `${year}-Q${q}`;
      }
      default:
        return formatDateLocal(date);
    }
  };

  // Time series data with dynamic grouping based on dateFilter (independent of global dateFilter)
  const timeSeriesData = tasks.reduce((acc, task) => {
    const date = new Date(task.fecha_creacion_solicitud);
    const key = getDateKey(date, dateFilter);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const formatTimeSeriesLabel = (key: string): string => {
    if (dateFilter === 'year' || dateFilter === 'semester') {
      const [y, m] = key.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    }
    if (dateFilter === 'month' || dateFilter === 'quarter') {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    }
    if (dateFilter === 'all') {
      // "2025-Q1" → "Q1 2025"
      const [year, q] = key.split('-');
      return `${q} ${year}`;
    }
    return key;
  };

  // Build complete time series for dateFilter, filling missing periods with 0
  const buildCompleteTimeSeries = (): [string, number][] => {
    const now = new Date();
    switch (dateFilter) {
      case 'month': {
        const range = getDashboardDateRange('month', selectedMonthDate)!;
        const result: [string, number][] = [];
        const cur = new Date(range.startDate + 'T00:00:00');
        const end = new Date(range.endDate + 'T00:00:00');
        while (cur <= end) {
          const key = formatDateLocal(cur);
          result.push([key, timeSeriesData[key] || 0]);
          cur.setDate(cur.getDate() + 1);
        }
        return result;
      }
      case 'quarter': {
        const range = getDashboardDateRange('quarter', selectedMonthDate)!;
        const start = new Date(range.startDate + 'T00:00:00');
        const end = new Date(range.endDate + 'T00:00:00');
        const cur = new Date(start);
        cur.setDate(start.getDate() - start.getDay()); // rewind to Sunday
        const result: [string, number][] = [];
        while (cur <= end) {
          const key = formatDateLocal(cur);
          result.push([key, timeSeriesData[key] || 0]);
          cur.setDate(cur.getDate() + 7);
        }
        return result;
      }
      case 'semester':
      case 'year': {
        const range = getDashboardDateRange(dateFilter, selectedMonthDate)!;
        const start = new Date(range.startDate + 'T00:00:00');
        const end = new Date(range.endDate + 'T00:00:00');
        const result: [string, number][] = [];
        const cur = new Date(start.getFullYear(), start.getMonth(), 1);
        while (cur <= end) {
          const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
          result.push([key, timeSeriesData[key] || 0]);
          cur.setMonth(cur.getMonth() + 1);
        }
        return result;
      }
      case 'all': {
        if (tasks.length === 0) return [];
        const minDate = tasks.reduce((min, t) => {
          const d = new Date(t.fecha_creacion_solicitud);
          return d < min ? d : min;
        }, new Date());
        const result: [string, number][] = [];
        const cur = new Date(minDate.getFullYear(), Math.floor(minDate.getMonth() / 3) * 3, 1);
        while (cur <= now) {
          const q = Math.floor(cur.getMonth() / 3) + 1;
          const key = `${cur.getFullYear()}-Q${q}`;
          result.push([key, timeSeriesData[key] || 0]);
          cur.setMonth(cur.getMonth() + 3);
        }
        return result;
      }
      default:
        return Object.entries(timeSeriesData).sort((a, b) => a[0].localeCompare(b[0]));
    }
  };

  const timeSeriesChartData = buildCompleteTimeSeries().map(([key, count]) => ({
    date: formatTimeSeriesLabel(key),
    Tareas: count,
  }));

  // Cost per activity data
  const costStats = {
    totalCost: tasks.reduce((sum, t) => sum + (t.costo_tarea || 0), 0),
    tasksWithCost: tasks.filter((t) => t.costo_tarea && t.costo_tarea > 0).length,
    averageCost:
      tasks.filter((t) => t.costo_tarea && t.costo_tarea > 0).length > 0
        ? tasks.reduce((sum, t) => sum + (t.costo_tarea || 0), 0) /
          tasks.filter((t) => t.costo_tarea && t.costo_tarea > 0).length
        : 0,
    maxCost: Math.max(...tasks.map((t) => t.costo_tarea || 0), 0),
  };

  // Cost by activity (task name)
  const costByActivityData = tasks.reduce((acc, task) => {
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
  const costByCenterData = tasks.reduce((acc, task) => {
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
  const costByProcessData = tasks.reduce((acc, task) => {
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

  const totalBreakdownChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(
        [
          {
            label: 'Completadas',
            value: stats.completed,
            color: statusChartColors.completada,
          },
          {
            label: 'Pendientes',
            value: stats.pending,
            color: statusChartColors.pendiente,
          },
          {
            label: 'En proceso',
            value: stats.inProgress,
            color: statusChartColors.enProceso,
          },
        ],
        false
      ),
    [stats.completed, stats.pending, stats.inProgress]
  );

  const doughnutLegend = { showLegend: false } as const;

  const completedShareChart = useMemo(
    () =>
      buildShareDoughnut(
        stats.completed,
        stats.total,
        statusChartColors.completada,
        'Completadas',
        doughnutLegend
      ),
    [stats.completed, stats.total]
  );

  const pendingShareChart = useMemo(
    () =>
      buildShareDoughnut(
        stats.pending,
        stats.total,
        statusChartColors.pendiente,
        'Pendientes',
        doughnutLegend
      ),
    [stats.pending, stats.total]
  );

  const inProgressShareChart = useMemo(
    () =>
      buildShareDoughnut(
        stats.inProgress,
        stats.total,
        statusChartColors.enProceso,
        'En proceso',
        doughnutLegend
      ),
    [stats.inProgress, stats.total]
  );

  const trendAreaChart = buildAreaLineChart(
    timeSeriesChartData.map((d) => ({ label: d.date, value: d.Tareas })),
    projectColors.secondary
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
    trend: resolveChartHeight('standard', chartViewport),
    bar: resolveChartHeight('hero', chartViewport),
    pie: resolveChartHeight('medium', chartViewport),
  };

  if (!session) {
    return null;
  }

  return (
    <DashboardPageShell
      title='Actividades'
      description='Sigue el volumen, el estado y la evolución de las tareas. Los filtros usan la fecha de creación de la solicitud.'
      toolbar={
        <DashboardDateToolbar
          dateFilter={dateFilter}
          onDateFilterChange={setDateFilter}
          selectedMonthDate={selectedMonthDate}
          onSelectedMonthDateChange={setSelectedMonthDate}
          onRefresh={fetchTasks}
          loading={loading}
          onExport={exportDashboardToExcel}
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
              {(loadingAdmin || isAdmin) && (
                <ActividadesSection
                  priority={1}
                  title='Desempeño por encargado'
                  description='Detalle por persona o equipo. Útil para administradores que reparten carga de trabajo.'
                >
                  {loadingAdmin ? (
                    <Group justify='center' py='xl'>
                      <Loader size='sm' />
                    </Group>
                  ) : (
                    <Card shadow='sm' padding={getDashboardCardPadding()} radius='md' withBorder>
                      <Group gap='xs' mb='md'>
                        <IconUsers size={18} color={projectColors.primary} />
                        <Text size='sm' fw={600}>
                          Actividades por encargado de área
                        </Text>
                      </Group>
                      <EncargadoActivitiesChart
                        tasks={tasks}
                        periodLabel={getFilterLabel(dateFilter)}
                      />
                    </Card>
                  )}
                </ActividadesSection>
              )}

              <ActividadesSection
                priority={isAdmin ? 2 : 1}
                title='Panorama del periodo'
                description='Cada tarjeta resume un indicador y su gráfica: composición del total o participación frente al resto.'
              >
                <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing={{ base: 'md', sm: 'lg' }}>
                  <MetricInsightCard
                    label='Total tareas'
                    value={formatNumber(stats.total)}
                    hint={`Periodo ${getFilterLabel(dateFilter)}`}
                    color={projectColors.primary}
                    icon={IconChartBar}
                    loading={loading}
                    chartTitle='Composición del total'
                    chartDescription='Cuántas tareas hay en cada estado'
                    chartType='bar'
                    chartData={totalBreakdownChart.data}
                    chartOptions={totalBreakdownChart.options}
                    emptyMessage='No hay tareas en este periodo'
                  />
                  <MetricInsightCard
                    label='Completadas'
                    value={formatNumber(stats.completed)}
                    hint={`${completionRate}% del total · avance del equipo`}
                    sharePercent={pct(stats.completed)}
                    color={projectColors.success}
                    icon={IconCheck}
                    loading={loading}
                    chartTitle='Participación completadas'
                    chartDescription='Porción del total ya finalizada'
                    chartType='pie'
                    chartData={completedShareChart.data}
                    chartOptions={completedShareChart.options}
                  />
                  <MetricInsightCard
                    label='Pendientes'
                    value={formatNumber(stats.pending)}
                    hint='Requieren atención o asignación'
                    sharePercent={pct(stats.pending)}
                    color={projectColors.warning}
                    icon={IconClock}
                    loading={loading}
                    chartTitle='Participación pendientes'
                    chartDescription='Porción del total aún sin iniciar o en espera'
                    chartType='pie'
                    chartData={pendingShareChart.data}
                    chartOptions={pendingShareChart.options}
                  />
                  <MetricInsightCard
                    label='En proceso'
                    value={formatNumber(stats.inProgress)}
                    hint='Trabajo en curso en el periodo'
                    sharePercent={pct(stats.inProgress)}
                    color={projectColors.secondary}
                    icon={IconTrendingUp}
                    loading={loading}
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
                      Hay más tareas pendientes ({formatNumber(stats.pending)}) que completadas (
                      {formatNumber(stats.completed)}). Revisa asignaciones y plazos del periodo.
                    </Text>
                  </Paper>
                )}
              </ActividadesSection>

              <ActividadesSection
                priority={isAdmin ? 3 : 2}
                title='Evolución en el tiempo'
                description='Muestra si el volumen de tareas sube o baja según el periodo elegido en la barra superior.'
              >
                <ChartCard
                  title='Tendencia de tareas creadas'
                  description='Cantidad de tareas por intervalo dentro del rango filtrado'
                >
                  {loading ? (
                    <Skeleton height={chartHeights.trend} radius='md' />
                  ) : timeSeriesChartData.length > 0 ? (
                    <ChartContainer
                      type='line'
                      data={trendAreaChart.data}
                      options={trendAreaChart.options}
                      height={chartHeights.trend}
                    />
                  ) : (
                    <Flex h={chartHeights.trend} align='center' justify='center'>
                      <Stack align='center' gap='sm'>
                        <IconChartLine size={48} color={projectColors.primary} opacity={0.3} />
                        <Text c='dimmed' size='sm' ta='center'>
                          No hay datos para graficar la tendencia en este periodo
                        </Text>
                      </Stack>
                    </Flex>
                  )}
                </ChartCard>
              </ActividadesSection>
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
                    >
                      {loading ? (
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
                    >
                      {loading ? (
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
                    loading={loading}
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
                    loading={loading}
                  />
                  <KpiStatCard
                    label='Costo promedio'
                    value={formatCurrency(costStats.averageCost)}
                    hint='Por actividad que registra costo'
                    color='#ea580c'
                    icon={IconTrendingUp}
                    loading={loading}
                  />
                  <KpiStatCard
                    label='Costo máximo'
                    value={formatCurrency(costStats.maxCost)}
                    hint='Mayor valor registrado en una tarea'
                    color='#dc2626'
                    icon={IconTrendingDown}
                    loading={loading}
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
