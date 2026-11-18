'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Button,
  Flex,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Table,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBuilding,
  IconCalendar,
  IconCalendarMonth,
  IconCheck,
  IconClockHour4,
  IconHourglass,
  IconRefresh,
  IconTicket,
} from '@tabler/icons-react';
import {
  buildHorizontalMultiColorBarChart,
  buildPieChart,
  buildVerticalBarChart,
} from '../../../lib/charts/builders';
import type {
  HelpdeskDashboardData,
  NamedCount,
} from '../../../lib/help-desk/dashboard/aggregate';
import { ActividadesSection, ChartCard, KpiStatCard } from '../../dashboard/actividades/ActividadesUi';
import { ChartContainer } from '../../dashboard/ChartContainer';
import DashboardPageShell from '../../dashboard/DashboardPageShell';
import { useChartViewport } from '../../dashboard/useChartViewport';
import { useDashboardChartPalette } from '../../dashboard/useDashboardChartPalette';
import { useProjectColors } from '../../dashboard/useProjectColors';

const ALL = '__all__';
const MONTH_OPTIONS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
].map((label, index) => ({ value: String(index + 1), label }));
/** Bars shown in the technician and category charts. */
const MAX_BARS = 12;

const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);

function formatDays(days: number | null): string {
  if (days == null) return '—';
  const value = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(days);
  return `${value} ${days === 1 ? 'día' : 'días'}`;
}

function formatLongDate(isoDay: string | null): string {
  if (!isoDay) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDay}T00:00:00Z`));
}

function CountTable({
  title,
  description,
  column,
  items,
  loading,
}: {
  title: string;
  description: string;
  column: string;
  items: NamedCount[];
  loading: boolean;
}) {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  return (
    <ChartCard title={title} description={description} height='auto'>
      {loading ? (
        <Skeleton height={260} />
      ) : items.length === 0 ? (
        <Text c='dimmed' ta='center' py='md' size='sm'>
          Sin casos para los filtros seleccionados
        </Text>
      ) : (
        <ScrollArea.Autosize mah={300} type='auto'>
          <Table striped highlightOnHover withTableBorder stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{column}</Table.Th>
                <Table.Th ta='right'>Recuento</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item) => (
                <Table.Tr key={item.name}>
                  <Table.Td>
                    <Text size='sm' lineClamp={2}>
                      {item.name}
                    </Text>
                  </Table.Td>
                  <Table.Td ta='right'>{formatNumber(item.total)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th>Total</Table.Th>
                <Table.Th ta='right'>{formatNumber(total)}</Table.Th>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </ScrollArea.Autosize>
      )}
    </ChartCard>
  );
}

export default function HelpdeskDashboardView() {
  const { status: sessionStatus } = useSession();
  const projectColors = useProjectColors();
  const { categoricalPalette } = useDashboardChartPalette();
  const chartViewport = useChartViewport();

  const [company, setCompany] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [month, setMonth] = useState(ALL);
  const [data, setData] = useState<HelpdeskDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (company !== ALL) params.set('company', company);
      if (year !== ALL) {
        params.set('year', year);
        if (month !== ALL) params.set('month', month);
      }
      const res = await fetch(`/api/help-desk/dashboard?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los indicadores.');
      setData(json as HelpdeskDashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }, [company, year, month]);

  useEffect(() => {
    if (sessionStatus === 'authenticated') void load();
  }, [sessionStatus, load]);

  const companyOptions = useMemo(
    () => [
      { value: ALL, label: 'Todas las empresas' },
      ...(data?.filterOptions.companies ?? []).map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [data]
  );

  const yearOptions = useMemo(
    () => [
      { value: ALL, label: 'Todo el histórico' },
      ...(data?.filterOptions.years ?? []).map((y) => ({ value: String(y), label: String(y) })),
    ],
    [data]
  );

  const kpis = data?.kpis;
  const isMobile = chartViewport.isMobile;

  const monthChart = useMemo(
    () =>
      buildVerticalBarChart(
        (data?.byMonth ?? []).map((m) => ({ name: m.label, value: m.total })),
        projectColors.primary,
        { labelSuffix: 'casos', datasetLabel: 'Casos', rotateLabels: (data?.byMonth.length ?? 0) > 8 }
      ),
    [data, projectColors.primary]
  );

  const barItems = useCallback(
    (items: NamedCount[], offset: number) =>
      items.slice(0, MAX_BARS).map((item, index) => ({
        label: item.name,
        value: item.total,
        color: categoricalPalette[(index + offset) % categoricalPalette.length],
      })),
    [categoricalPalette]
  );

  const technicianItems = useMemo(() => barItems(data?.byTechnician ?? [], 0), [data, barItems]);
  const categoryItems = useMemo(() => barItems(data?.byCategory ?? [], 3), [data, barItems]);

  const technicianChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(technicianItems, isMobile, {
        valueLabel: 'casos',
        datasetLabel: 'Por técnico',
        truncateLabels: true,
        compact: chartViewport.isCompact,
      }),
    [technicianItems, isMobile, chartViewport.isCompact]
  );

  const categoryChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(categoryItems, isMobile, {
        valueLabel: 'casos',
        datasetLabel: 'Por categoría',
        truncateLabels: true,
        compact: chartViewport.isCompact,
      }),
    [categoryItems, isMobile, chartViewport.isCompact]
  );

  const pie = useCallback(
    (items: NamedCount[], offset: number) =>
      buildPieChart(
        items.map((item, index) => ({
          name: item.name,
          value: item.total,
          color: categoricalPalette[(index + offset) % categoricalPalette.length],
        })),
        { showLegend: true, cutout: '55%' }
      ),
    [categoricalPalette]
  );

  const statusPie = useMemo(() => pie(data?.byStatus ?? [], 0), [data, pie]);
  const typePie = useMemo(() => pie(data?.byType ?? [], 4), [data, pie]);

  const barHeight = (count: number) => Math.max(200, count * (chartViewport.isCompact ? 38 : 44) + 48);

  if (forbidden) {
    return (
      <DashboardPageShell title='Dashboard Helpdesk'>
        <Alert color='red' variant='light' icon={<IconAlertCircle size={20} />} title='Sin acceso'>
          No tiene acceso a este módulo. Si lo necesita, solicítelo al área de Tecnología.
        </Alert>
      </DashboardPageShell>
    );
  }

  const periodLabel =
    year === ALL
      ? `Histórico completo desde el ${formatLongDate(data?.firstCaseDate ?? null)}`
      : month === ALL
        ? `Año ${year}`
        : `${MONTH_OPTIONS[Number(month) - 1].label} de ${year}`;

  return (
    <DashboardPageShell
      title='Dashboard Helpdesk'
      description={
        <Text size='sm' c='dimmed'>
          Indicadores de la mesa de ayuda a partir del módulo de Tickets · {periodLabel}
        </Text>
      }
      toolbar={
        <Button
          variant='light'
          leftSection={<IconRefresh size={16} />}
          onClick={() => void load()}
          loading={loading}
        >
          Actualizar
        </Button>
      }
    >
      {error ? (
        <Alert icon={<IconAlertCircle size={20} />} title='Error al cargar' color='red' variant='light'>
          {error}
        </Alert>
      ) : null}

      {kpis && kpis.resolvedWithoutEndDate > 0 ? (
        <Alert icon={<IconAlertTriangle size={20} />} color='yellow' variant='light' title='Casos resueltos sin fecha de cierre'>
          {formatNumber(kpis.resolvedWithoutEndDate)} de {formatNumber(kpis.resolved)} casos resueltos no
          tienen fecha de cierre. El tiempo medio de resolución se calcula solo con los{' '}
          {formatNumber(kpis.resolvedWithEndDate)} que sí la tienen.
        </Alert>
      ) : null}

      <Paper p={{ base: 'sm', md: 'md' }} radius='md' withBorder>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='md'>
          <Select
            label='Empresa'
            leftSection={<IconBuilding size={18} />}
            data={companyOptions}
            value={company}
            onChange={(v) => setCompany(v ?? ALL)}
            allowDeselect={false}
            searchable={companyOptions.length > 6}
          />
          <Select
            label='Año'
            leftSection={<IconCalendar size={18} />}
            data={yearOptions}
            value={year}
            onChange={(v) => {
              setYear(v ?? ALL);
              if (!v || v === ALL) setMonth(ALL);
            }}
            allowDeselect={false}
          />
          <Select
            label='Mes'
            leftSection={<IconCalendarMonth size={18} />}
            data={[{ value: ALL, label: 'Todos los meses' }, ...MONTH_OPTIONS]}
            value={month}
            onChange={(v) => setMonth(v ?? ALL)}
            allowDeselect={false}
            disabled={year === ALL}
            description={year === ALL ? 'Elija primero un año' : undefined}
          />
        </SimpleGrid>
      </Paper>

      <ActividadesSection priority={1} title='Resumen' description='Casos del periodo y empresa seleccionados.'>
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing={{ base: 'sm', sm: 'md' }}>
          <KpiStatCard
            label='Casos en el periodo'
            value={kpis ? formatNumber(kpis.total) : '—'}
            hint={kpis ? `${formatNumber(kpis.cancelled)} cancelados` : ''}
            color={projectColors.primary}
            icon={IconTicket}
            loading={loading && !data}
          />
          <KpiStatCard
            label='Resueltos'
            value={kpis ? formatNumber(kpis.resolved) : '—'}
            hint='Casos en estado Resuelto'
            sharePercent={kpis && kpis.total > 0 ? (kpis.resolved / kpis.total) * 100 : 0}
            color={projectColors.success}
            icon={IconCheck}
            loading={loading && !data}
          />
          <KpiStatCard
            label='Pendientes'
            value={kpis ? formatNumber(kpis.pending) : '—'}
            hint='Abiertos y demás estados sin cerrar'
            sharePercent={kpis && kpis.total > 0 ? (kpis.pending / kpis.total) * 100 : 0}
            color={projectColors.warning}
            icon={IconHourglass}
            loading={loading && !data}
          />
          <KpiStatCard
            label='Tiempo medio de resolución'
            value={kpis ? formatDays(kpis.avgResolutionDays) : '—'}
            hint={
              kpis
                ? `Con ${formatNumber(kpis.resolvedWithEndDate)} casos resueltos con fecha de cierre`
                : ''
            }
            color={projectColors.secondary}
            icon={IconClockHour4}
            loading={loading && !data}
          />
        </SimpleGrid>
      </ActividadesSection>

      <ActividadesSection priority={5} title='Evolución y demanda' description='Casos por mes y por departamento.'>
        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing='lg'>
          <div style={{ gridColumn: chartViewport.isCompact ? undefined : 'span 2', minWidth: 0 }}>
            <ChartCard title='Total de casos por mes' description='Según la fecha de creación del caso' height='auto'>
              {loading && !data ? (
                <Skeleton height={280} />
              ) : (data?.byMonth.length ?? 0) > 0 ? (
                <ChartContainer
                  type='bar'
                  data={monthChart.data}
                  options={monthChart.options}
                  height={280}
                  scrollable={(data?.byMonth.length ?? 0) > (chartViewport.isCompact ? 6 : 14)}
                />
              ) : (
                <Text c='dimmed' ta='center' py='md' size='sm'>
                  Sin casos para los filtros seleccionados
                </Text>
              )}
            </ChartCard>
          </div>
          <CountTable
            title='Recuento por departamento'
            description='Departamento que reporta el caso'
            column='Departamento'
            items={data?.byDepartment ?? []}
            loading={loading && !data}
          />
        </SimpleGrid>
      </ActividadesSection>

      <ActividadesSection priority={3} title='Técnicos y categorías' description='Quién atiende y qué tipo de casos llegan.'>
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='lg'>
          <ChartCard
            title='Recuento por técnico'
            description={`Técnico asignado${(data?.byTechnician.length ?? 0) > MAX_BARS ? ` · los ${MAX_BARS} con más casos` : ''}`}
            height='auto'
          >
            {loading && !data ? (
              <Skeleton height={barHeight(6)} />
            ) : technicianItems.length > 0 ? (
              <ChartContainer
                type='bar'
                data={technicianChart.data}
                options={technicianChart.options}
                height={barHeight(technicianItems.length)}
              />
            ) : (
              <Text c='dimmed' ta='center' py='md' size='sm'>
                Sin casos para los filtros seleccionados
              </Text>
            )}
          </ChartCard>
          <ChartCard title='Recuento por categoría' description='Categoría del caso' height='auto'>
            {loading && !data ? (
              <Skeleton height={barHeight(6)} />
            ) : categoryItems.length > 0 ? (
              <ChartContainer
                type='bar'
                data={categoryChart.data}
                options={categoryChart.options}
                height={barHeight(categoryItems.length)}
              />
            ) : (
              <Text c='dimmed' ta='center' py='md' size='sm'>
                Sin casos para los filtros seleccionados
              </Text>
            )}
          </ChartCard>
        </SimpleGrid>
      </ActividadesSection>

      <ActividadesSection priority={2} title='Estado, tipo y detalle' description='Composición de los casos y temas más frecuentes.'>
        <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing='lg'>
          <ChartCard title='Casos por estado' height='auto'>
            {loading && !data ? (
              <Skeleton height={260} />
            ) : (data?.byStatus.length ?? 0) > 0 ? (
              <ChartContainer type='pie' data={statusPie.data} options={statusPie.options} height={260} scrollable={false} />
            ) : (
              <Flex align='center' justify='center' mih={200}>
                <Text c='dimmed' size='sm'>
                  Sin casos
                </Text>
              </Flex>
            )}
          </ChartCard>
          <ChartCard title='Tipo de solicitud' height='auto'>
            {loading && !data ? (
              <Skeleton height={260} />
            ) : (data?.byType.length ?? 0) > 0 ? (
              <ChartContainer type='pie' data={typePie.data} options={typePie.options} height={260} scrollable={false} />
            ) : (
              <Flex align='center' justify='center' mih={200}>
                <Text c='dimmed' size='sm'>
                  Sin casos
                </Text>
              </Flex>
            )}
          </ChartCard>
          <CountTable
            title='Recuento por subcategoría'
            description='Subcategoría del caso'
            column='Subcategoría'
            items={data?.bySubcategory ?? []}
            loading={loading && !data}
          />
        </SimpleGrid>
        <CountTable
          title='Recuento por actividad'
          description='Actividad registrada en el caso'
          column='Actividad'
          items={data?.byActivity ?? []}
          loading={loading && !data}
        />
      </ActividadesSection>
    </DashboardPageShell>
  );
}
