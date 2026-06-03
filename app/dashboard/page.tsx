'use client';

import { useState, useEffect } from 'react';
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
  Select,
  Button,
  Alert,
  Skeleton,
  Badge,
  Tabs,
  Box,
  Container,
  Paper,
  Flex,
  ActionIcon,
  Divider,
  Loader,
} from '@mantine/core';
import { BarChart, PieChart, AreaChart } from '@mantine/charts';
import EncargadoActivitiesChart from '../../components/dashboard/EncargadoActivitiesChart';
import {
  formatDateLocal,
  getDashboardDateRange,
  getFilterLabel,
  getPeriodRangeLabel,
  getQuarterLabel,
  getSemesterLabel,
  isReferenceAtCurrentPeriod,
  shiftReferenceMonth,
  type DashboardDateFilter,
} from '../../lib/dashboard/dateRange';
import {
  chartAxisTickStyle,
  chartYAxisProps,
  dashboardChartTheme,
  statusChartColors,
} from '../../components/dashboard/chartTheme';
import { ChartContainer } from '../../components/dashboard/ChartContainer';
import {
  IconAlertCircle,
  IconRefresh,
  IconChartBar,
  IconChartPie,
  IconChartLine,
  IconTrendingUp,
  IconTrendingDown,
  IconClock,
  IconCheck,
  IconX,
  IconCoin,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
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

export default function Dashboard() {
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
  const [appliedRange, setAppliedRange] = useState<string | null>(null);

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
      const applied = result.filters_applied as
        | { date_from?: string | null; date_to?: string | null }
        | undefined;
      if (applied?.date_from && applied?.date_to) {
        setAppliedRange(`${applied.date_from} → ${applied.date_to}`);
      } else {
        setAppliedRange(null);
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  const activeDateRange = getDashboardDateRange(dateFilter, selectedMonthDate);

  // Calculate statistics
  const stats = {
    total: tasks.length,
    completed: tasks.filter((t) => t.estado_tarea === 'Completada').length,
    pending: tasks.filter((t) => t.estado_tarea === 'Pendiente').length,
    inProgress: tasks.filter((t) => t.estado_tarea === 'En Proceso').length,
    active: tasks.filter((t) => t.activo_tarea).length,
  };

  // Prepare data for charts with project colors
  const otrosEstado = tasks.filter(
    (t) => !['Completada', 'Pendiente', 'En Proceso'].includes(t.estado_tarea)
  ).length;

  const statusData = [
    { name: 'Completadas', value: stats.completed, color: statusChartColors.completada },
    { name: 'Pendientes', value: stats.pending, color: statusChartColors.pendiente },
    { name: 'En Proceso', value: stats.inProgress, color: statusChartColors.enProceso },
    ...(otrosEstado > 0
      ? [{ name: 'Otros', value: otrosEstado, color: dashboardChartTheme.blue600 }]
      : []),
  ].filter((item) => item.value > 0);

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

  if (status === 'loading') {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <Skeleton height={50} circle mb='xl' />
        <Skeleton height={8} radius='xl' />
        <Skeleton height={8} mt={6} radius='xl' width='70%' />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <Container size='xl' py='xl'>
      <Stack gap='lg'>
        {/* Header */}
        <Group justify='space-between'>
          <div>
            <Title order={2}>Dashboard - Actividades de Solicitudes</Title>
            <Text size='sm' c='dimmed'>
              Análisis por fecha de creación de la solicitud
            </Text>
            {activeDateRange && (
              <Text size='xs' c='dimmed' mt={4}>
                {getFilterLabel(dateFilter)} · {appliedRange ?? getPeriodRangeLabel(dateFilter, selectedMonthDate)}
                {dateFilter === 'quarter' && ` (${getQuarterLabel(selectedMonthDate)})`}
                {dateFilter === 'semester' && ` (${getSemesterLabel(selectedMonthDate)} ${selectedMonthDate.getFullYear()})`}
                {dateFilter === 'year' && ` (${selectedMonthDate.getFullYear()})`}
              </Text>
            )}
          </div>
          <Group align='flex-end'>
            <Select
              label='Periodo'
              data={[
                { value: 'month', label: 'Mensual' },
                { value: 'quarter', label: 'Trimestral' },
                { value: 'semester', label: 'Semestral' },
                { value: 'year', label: 'Anual' },
              ]}
              value={dateFilter}
              onChange={(value) => setDateFilter((value as DateFilter) ?? 'month')}
              allowDeselect={false}
              w={150}
            />
            {(dateFilter === 'month' ||
              dateFilter === 'quarter' ||
              dateFilter === 'semester' ||
              dateFilter === 'year') && (
              <Group gap={4}>
                <ActionIcon
                  variant='light'
                  onClick={() =>
                    setSelectedMonthDate(shiftReferenceMonth(selectedMonthDate, dateFilter, -1))
                  }
                >
                  <IconChevronLeft size={16} />
                </ActionIcon>
                <Text fw={500} w={140} ta='center' size='sm'>
                  {dateFilter === 'month' &&
                    selectedMonthDate.toLocaleDateString('es-CO', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  {dateFilter === 'quarter' && getQuarterLabel(selectedMonthDate)}
                  {dateFilter === 'semester' &&
                    `${getSemesterLabel(selectedMonthDate)} ${selectedMonthDate.getFullYear()}`}
                  {dateFilter === 'year' && String(selectedMonthDate.getFullYear())}
                </Text>
                <ActionIcon
                  variant='light'
                  disabled={isReferenceAtCurrentPeriod(selectedMonthDate, dateFilter)}
                  onClick={() =>
                    setSelectedMonthDate(shiftReferenceMonth(selectedMonthDate, dateFilter, 1))
                  }
                >
                  <IconChevronRight size={16} />
                </ActionIcon>
              </Group>
            )}
            <Button
              variant='light'
              onClick={fetchTasks}
              loading={loading}
              leftSection={<IconRefresh size={16} />}
            >
              Actualizar
            </Button>
            <Button
              variant='outline'
              color='green'
              onClick={exportDashboardToExcel}
              loading={exportingExcel}
              leftSection={<IconDownload size={16} />}
            >
              Descargar Excel
            </Button>
          </Group>
        </Group>

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
            tab: {
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
              Resumen General
            </Tabs.Tab>
            <Tabs.Tab value='process' leftSection={<IconChartLine size={16} />}>
              Por Proceso
            </Tabs.Tab>
            <Tabs.Tab value='category' leftSection={<IconTrendingUp size={16} />}>
              Por Categoría
            </Tabs.Tab>
            <Tabs.Tab value='cost' leftSection={<IconCoin size={16} />}>
              Costo por Actividad
            </Tabs.Tab>
          </Tabs.List>

          {/* Overview Tab */}
          <Tabs.Panel value='overview'>
            <Stack gap='lg' mt='md'>
              {/* Stats Cards */}
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      Total Tareas
                    </Text>
                    <IconChartBar size={20} color={projectColors.primary} />
                  </Group>
                  <Title order={3} style={{ color: projectColors.primary }}>
                    {formatNumber(stats.total)}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    Periodo: {getFilterLabel(dateFilter)}
                  </Text>
                </Card>

                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      Completadas
                    </Text>
                    <IconCheck size={20} color={projectColors.success} />
                  </Group>
                  <Title order={3} style={{ color: projectColors.success }}>
                    {formatNumber(stats.completed)}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    {stats.total > 0
                      ? `${((stats.completed / stats.total) * 100).toFixed(1)}%`
                      : '0%'}
                  </Text>
                </Card>

                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      Pendientes
                    </Text>
                    <IconClock size={20} color={projectColors.warning} />
                  </Group>
                  <Title order={3} style={{ color: projectColors.warning }}>
                    {formatNumber(stats.pending)}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    {stats.total > 0
                      ? `${((stats.pending / stats.total) * 100).toFixed(1)}%`
                      : '0%'}
                  </Text>
                </Card>

                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      En Proceso
                    </Text>
                    <IconTrendingUp size={20} color={projectColors.secondary} />
                  </Group>
                  <Title order={3} style={{ color: projectColors.secondary }}>
                    {formatNumber(stats.inProgress)}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    {stats.total > 0
                      ? `${((stats.inProgress / stats.total) * 100).toFixed(1)}%`
                      : '0%'}
                  </Text>
                </Card>
              </SimpleGrid>

              {/* Gráficos principales: 50% / 50% */}
              <Grid gutter='lg' align='stretch'>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <Card shadow='sm' padding='lg' radius='md' withBorder h='100%'>
                    <Title order={4} mb='md'>
                      Distribución por Estado
                    </Title>
                    {statusData.length > 0 ? (
                      <ChartContainer height={300} minWidth={0}>
                        <Flex justify='center' align='center' w='100%' mih={300}>
                          <PieChart
                            data={statusData}
                            withLabels
                            labelsType='percent'
                            withTooltip
                            tooltipDataSource='segment'
                            size={240}
                          />
                        </Flex>
                      </ChartContainer>
                    ) : (
                      <Flex h={300} align='center' justify='center'>
                        <Text size='sm' c='dimmed' ta='center'>
                          No hay actividades con estado en este periodo
                        </Text>
                      </Flex>
                    )}
                  </Card>
                </Grid.Col>

                <Grid.Col span={{ base: 12, md: 6 }}>
                  <Card shadow='sm' padding='lg' radius='md' withBorder h='100%'>
                    <Group justify='space-between' mb='md' wrap='nowrap'>
                      <Title order={4}>Tendencia de Tareas</Title>
                      <Select
                        size='xs'
                        w={130}
                        data={[
                          { value: 'month', label: 'Mensual' },
                          { value: 'quarter', label: 'Trimestral' },
                          { value: 'semester', label: 'Semestral' },
                          { value: 'year', label: 'Anual' },
                        ]}
                        value={dateFilter}
                        onChange={(v) => setDateFilter((v as DateFilter) ?? 'month')}
                        allowDeselect={false}
                        styles={{
                          input: {
                            background: 'linear-gradient(135deg, #113562 0%, #3db6e0 100%)',
                            color: 'white',
                            border: 'none',
                            fontWeight: 600,
                          },
                        }}
                      />
                    </Group>
                    {timeSeriesChartData.length > 0 ? (
                      <ChartContainer height={300}>
                      <AreaChart
                        w='100%'
                        h={300}
                        data={timeSeriesChartData}
                        dataKey='date'
                        series={[
                          {
                            name: 'Tareas',
                            label: 'Tareas',
                            color: projectColors.secondary,
                          },
                        ]}
                        curveType='monotone'
                        withDots
                        dotProps={{
                          r: 4,
                          strokeWidth: 2,
                          fill: 'white',
                          stroke: projectColors.secondary,
                        }}
                        activeDotProps={{
                          r: 6,
                          strokeWidth: 2,
                          fill: projectColors.secondary,
                          stroke: 'white',
                        }}
                        withTooltip
                        tooltipProps={{
                          content: ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string | number }) => {
                            if (!active || !payload?.length) return null;
                            return (
                              <Paper
                                shadow='md'
                                p='sm'
                                radius='md'
                                withBorder
                                style={{ minWidth: 130, borderColor: '#e9ecef' }}
                              >
                                <Text size='xs' c='dimmed' mb={6} tt='capitalize'>
                                  {label}
                                </Text>
                                <Group gap='xs' align='baseline'>
                                  <Box
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: '50%',
                                      backgroundColor: projectColors.secondary,
                                      flexShrink: 0,
                                    }}
                                  />
                                  <Text
                                    fw={700}
                                    size='xl'
                                    style={{ color: projectColors.primary, lineHeight: 1 }}
                                  >
                                    {payload[0].value}
                                  </Text>
                                  <Text size='xs' c='dimmed'>
                                    tareas
                                  </Text>
                                </Group>
                              </Paper>
                            );
                          },
                        }}
                        gridProps={{
                          stroke: '#cbd5e1',
                          strokeDasharray: '4 4',
                          vertical: false,
                        }}
                        xAxisProps={{ tick: chartAxisTickStyle }}
                        yAxisProps={chartYAxisProps}
                        withPointLabels={timeSeriesChartData.length <= 15}
                        fillOpacity={0.15}
                      />
                      </ChartContainer>
                    ) : (
                      <Flex h={300} align='center' justify='center'>
                        <Stack align='center' gap='sm'>
                          <IconChartLine size={48} color={projectColors.primary} opacity={0.3} />
                          <Text c='dimmed' size='sm'>
                            No hay datos disponibles para este periodo
                          </Text>
                        </Stack>
                      </Flex>
                    )}
                  </Card>
                </Grid.Col>
              </Grid>

              {/* Encargados: fila completa debajo (solo admin) */}
              {loadingAdmin ? (
                <Group justify='center' py='lg'>
                  <Loader size='sm' />
                </Group>
              ) : isAdmin ? (
                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Divider
                    mb='lg'
                    label='Actividades por encargado (solo administrador)'
                    labelPosition='center'
                  />
                  <EncargadoActivitiesChart
                    tasks={tasks}
                    periodLabel={getFilterLabel(dateFilter)}
                  />
                </Card>
              ) : null}
            </Stack>
          </Tabs.Panel>


          {/* Process Tab */}
          <Tabs.Panel value='process'>
            <Stack gap='lg' mt='md'>
              <Card shadow='sm' padding='lg' radius='md' withBorder>
                <Title order={4} mb='md'>
                  Tareas por Proceso (Top 10)
                </Title>
                <ChartContainer height={400}>
                <BarChart
                  w='100%'
                  h={400}
                  data={processChartData}
                  dataKey='name'
                  series={[{ name: 'value', label: 'Cantidad', color: 'blue.6' }]}
                  withTooltip
                  tooltipProps={{
                    content: ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string | number }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <Paper shadow='md' p='sm' radius='md' withBorder style={{ minWidth: 160, borderColor: '#e9ecef' }}>
                          <Text size='xs' c='dimmed' mb={6}>{label}</Text>
                          <Group gap='xs' align='baseline'>
                            <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: projectColors.primary, flexShrink: 0 }} />
                            <Text fw={700} size='xl' style={{ color: projectColors.primary, lineHeight: 1 }}>{payload[0].value}</Text>
                            <Text size='xs' c='dimmed'>tareas</Text>
                          </Group>
                        </Paper>
                      );
                    },
                  }}
                  withLegend
                  xAxisProps={{
                    angle: -45,
                    textAnchor: 'end',
                    height: 100,
                  }}
                />
                </ChartContainer>
              </Card>

              <Card shadow='sm' padding='lg' radius='md' withBorder>
                <Title order={4} mb='md'>
                  Resumen por Proceso
                </Title>
                <Stack gap='sm'>
                  {processChartData.map((item) => (
                    <Paper key={item.name} p='sm' withBorder>
                      <Flex justify='space-between' align='center'>
                        <Text size='sm'>{item.name}</Text>
                        <Badge variant='light'>{formatNumber(item.value)} tareas</Badge>
                      </Flex>
                    </Paper>
                  ))}
                </Stack>
              </Card>
            </Stack>
          </Tabs.Panel>

          {/* Category Tab */}
          <Tabs.Panel value='category'>
            <Stack gap='lg' mt='md'>
              <Card shadow='sm' padding='lg' radius='md' withBorder>
                <Title order={4} mb='md'>
                  Tareas por Categoría (Top 10)
                </Title>
                <ChartContainer height={400}>
                <BarChart
                  w='100%'
                  h={400}
                  data={categoryChartData}
                  dataKey='name'
                  series={[{ name: 'value', label: 'Cantidad', color: 'blue.5' }]}
                  withTooltip
                  tooltipProps={{
                    content: ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string | number }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <Paper shadow='md' p='sm' radius='md' withBorder style={{ minWidth: 160, borderColor: '#e9ecef' }}>
                          <Text size='xs' c='dimmed' mb={6}>{label}</Text>
                          <Group gap='xs' align='baseline'>
                            <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: projectColors.success, flexShrink: 0 }} />
                            <Text fw={700} size='xl' style={{ color: projectColors.primary, lineHeight: 1 }}>{payload[0].value}</Text>
                            <Text size='xs' c='dimmed'>tareas</Text>
                          </Group>
                        </Paper>
                      );
                    },
                  }}
                  withLegend
                  xAxisProps={{
                    angle: -45,
                    textAnchor: 'end',
                    height: 100,
                  }}
                />
                </ChartContainer>
              </Card>

              <Card shadow='sm' padding='lg' radius='md' withBorder>
                <Title order={4} mb='md'>
                  Resumen por Categoría
                </Title>
                <Stack gap='sm'>
                  {categoryChartData.map((item) => (
                    <Paper key={item.name} p='sm' withBorder>
                      <Flex justify='space-between' align='center'>
                        <Text size='sm'>{item.name}</Text>
                        <Badge variant='light' color='green'>
                          {formatNumber(item.value)} tareas
                        </Badge>
                      </Flex>
                    </Paper>
                  ))}
                </Stack>
              </Card>
            </Stack>
          </Tabs.Panel>

          {/* Cost Tab */}
          <Tabs.Panel value='cost'>
            <Stack gap='lg' mt='md'>
              {/* Cost Stats Cards */}
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      Costo Total
                    </Text>
                    <IconCoin size={20} color='green' />
                  </Group>
                  <Title order={3} c='green'>
                    {formatCurrency(costStats.totalCost)}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    Periodo: {getFilterLabel(dateFilter)}
                  </Text>
                </Card>

                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      Tareas con Costo
                    </Text>
                    <IconChartBar size={20} color='blue' />
                  </Group>
                  <Title order={3} c='blue'>
                    {costStats.tasksWithCost}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    de {stats.total} tareas totales
                  </Text>
                </Card>

                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      Costo Promedio
                    </Text>
                    <IconTrendingUp size={20} color='orange' />
                  </Group>
                  <Title order={3} c='orange'>
                    {formatCurrency(costStats.averageCost)}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    Por actividad con costo
                  </Text>
                </Card>

                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Group justify='space-between' mb='xs'>
                    <Text size='sm' c='dimmed'>
                      Costo Máximo
                    </Text>
                    <IconTrendingDown size={20} color='red' />
                  </Group>
                  <Title order={3} c='red'>
                    {formatCurrency(costStats.maxCost)}
                  </Title>
                  <Text size='xs' c='dimmed'>
                    Mayor costo registrado
                  </Text>
                </Card>
              </SimpleGrid>

              {/* Cost Charts */}
              <Grid>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <Card shadow='sm' padding='lg' radius='md' withBorder>
                    <Title order={4} mb='md'>
                      Distribución de Costos por Proceso
                    </Title>
                    {costDistributionData.length > 0 ? (
                      <ChartContainer height={320} minWidth={280}>
                        <Flex justify='center' w='100%'>
                          <PieChart
                            data={costDistributionData}
                            withLabels
                            labelsType='percent'
                            withTooltip
                            tooltipDataSource='segment'
                            size={300}
                          />
                        </Flex>
                      </ChartContainer>
                    ) : (
                      <Text c='dimmed' ta='center' py='xl'>
                        No hay datos de costos disponibles
                      </Text>
                    )}
                  </Card>
                </Grid.Col>

                <Grid.Col span={{ base: 12, md: 6 }}>
                  <Card shadow='sm' padding='lg' radius='md' withBorder>
                    <Title order={4} mb='md'>
                      Costo por Actividad (Top 10)
                    </Title>
                    {costByActivityChartData.length > 0 ? (
                      <ChartContainer height={300}>
                      <BarChart
                        w='100%'
                        h={300}
                        data={costByActivityChartData}
                        dataKey='name'
                        series={[{ name: 'cost', label: 'Costo', color: 'blue.5' }]}
                        withTooltip
                        xAxisProps={{
                          angle: -45,
                          textAnchor: 'end',
                          height: 100,
                        }}
                      />
                      </ChartContainer>
                    ) : (
                      <Text c='dimmed' ta='center' py='xl'>
                        No hay datos de costos disponibles
                      </Text>
                    )}
                  </Card>
                </Grid.Col>
              </Grid>

              {/* Cost by Process */}
              <Card shadow='sm' padding='lg' radius='md' withBorder>
                <Title order={4} mb='md'>
                  Costo por Proceso (Top 10)
                </Title>
                {costByProcessChartData.length > 0 ? (
                  <ChartContainer height={400}>
                  <BarChart
                    w='100%'
                    h={400}
                    data={costByProcessChartData}
                    dataKey='name'
                    series={[{ name: 'cost', label: 'Costo', color: 'blue.6' }]}
                    withTooltip
                    withLegend
                    xAxisProps={{
                      angle: -45,
                      textAnchor: 'end',
                      height: 100,
                    }}
                  />
                  </ChartContainer>
                ) : (
                  <Text c='dimmed' ta='center' py='xl'>
                    No hay datos de costos disponibles
                  </Text>
                )}
              </Card>

              {/* Cost by Center */}
              {costByCenterChartData.length > 0 && (
                <Card shadow='sm' padding='lg' radius='md' withBorder>
                  <Title order={4} mb='md'>
                    Costo por Centro de Costo (Top 10)
                  </Title>
                  <ChartContainer height={400}>
                  <BarChart
                    w='100%'
                    h={400}
                    data={costByCenterChartData}
                    dataKey='name'
                    series={[{ name: 'cost', label: 'Costo', color: 'blue.4' }]}
                    withTooltip
                    withLegend
                    xAxisProps={{
                      angle: -45,
                      textAnchor: 'end',
                      height: 100,
                    }}
                  />
                  </ChartContainer>
                </Card>
              )}

              {/* Detailed Cost Summary */}
              <Card shadow='sm' padding='lg' radius='md' withBorder>
                <Title order={4} mb='md'>
                  Resumen Detallado de Costos por Actividad
                </Title>
                <Stack gap='sm'>
                  {costByActivityChartData.length > 0 ? (
                    costByActivityChartData.map((item) => (
                      <Paper key={item.name} p='sm' withBorder>
                        <Flex justify='space-between' align='center' wrap='wrap' gap='sm'>
                          <Text size='sm' fw={500} style={{ flex: 1, minWidth: '200px' }}>
                            {item.name}
                          </Text>
                          <Group gap='md'>
                            <Badge variant='light' color='teal'>
                              {item.count} tareas
                            </Badge>
                            <Badge variant='filled' color='green'>
                              {formatCurrency(item.cost)}
                            </Badge>
                            <Text size='xs' c='dimmed'>
                              Prom: {formatCurrency(item.avgCost)}
                            </Text>
                          </Group>
                        </Flex>
                      </Paper>
                    ))
                  ) : (
                    <Text c='dimmed' ta='center' py='xl'>
                      No hay datos de costos disponibles
                    </Text>
                  )}
                </Stack>
              </Card>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
