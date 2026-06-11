'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Alert,
  Badge,
  Flex,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuilding,
  IconCategory2,
  IconCheck,
  IconClock,
  IconClockHour4,
  IconFilter,
  IconTicket,
} from '@tabler/icons-react';
import {
  buildAreaLineChart,
  buildHorizontalMultiColorBarChart,
  buildPieChart,
  buildTicketStatusStackedBar,
  ticketStatusChartColors,
} from '../../lib/charts/builders';
import { getFilterLabel } from '../../lib/dashboard/dateRange';
import { exportTicketsExcel } from '../../lib/dashboard/excel';
import {
  ALL_CATEGORIES_VALUE,
  ALL_COMPANIES_VALUE,
  buildCategoryCompanyRows,
  buildCategoryFrequencyMetrics,
  buildCompanyFrequencyMetrics,
  buildScopedCreationTimeSeries,
  buildStatusStackedRowsByLabel,
  computeAverageIntervalDays,
  filterCasesByCategory,
  filterCasesByCompany,
  formatIntervalLabel,
  getCategoryLabel,
  listCategories,
  listCompanies,
  statusPercentages,
} from '../../lib/dashboard/ticketCategoryAnalytics';
import {
  countByStatus,
  dedupeHelpDeskCases,
  getCompanyLabel,
  type HelpDeskCase,
} from '../../lib/dashboard/ticketAnalytics';
import { useDashboardTickets } from '../../lib/dashboard/useDashboardTickets';
import {
  ActividadesSection,
  ChartCard,
  KpiStatCard,
  StatusInsightPanel,
  type StatusInsightItem,
} from './actividades/ActividadesUi';
import { ChartContainer, FillHeightChartContainer } from './ChartContainer';
import DashboardDateToolbar, { DashboardPeriodHint } from './DashboardDateToolbar';
import DashboardPageShell from './DashboardPageShell';
import { useChartViewport } from './useChartViewport';
import { useDashboardChartPalette } from './useDashboardChartPalette';
import { useProjectColors } from './useProjectColors';

export default function TicketsCategoryCompanyView() {
  const projectColors = useProjectColors();
  const { categoricalPalette } = useDashboardChartPalette();
  const chartViewport = useChartViewport();
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

  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES_VALUE);
  const [companyFilter, setCompanyFilter] = useState(ALL_COMPANIES_VALUE);
  const [exportingExcel, setExportingExcel] = useState(false);

  const cases = useMemo(
    () => dedupeHelpDeskCases(rawCases as HelpDeskCase[]),
    [rawCases]
  );

  const scopedCases = useMemo(() => {
    let result = cases;
    result = filterCasesByCategory(result, categoryFilter);
    result = filterCasesByCompany(result, companyFilter);
    return result;
  }, [cases, categoryFilter, companyFilter]);

  const isFiltered =
    categoryFilter !== ALL_CATEGORIES_VALUE || companyFilter !== ALL_COMPANIES_VALUE;

  useEffect(() => {
    setCategoryFilter(ALL_CATEGORIES_VALUE);
    setCompanyFilter(ALL_COMPANIES_VALUE);
  }, [dateFilter, selectedMonthDate]);

  const handleExportExcel = useCallback(async () => {
    try {
      setExportingExcel(true);
      await exportTicketsExcel({ dateFilter, selectedMonthDate, appliedRange });
    } catch (err) {
      console.error('Error exportando tickets:', err);
    } finally {
      setExportingExcel(false);
    }
  }, [dateFilter, selectedMonthDate, appliedRange]);

  const scopedCounts = useMemo(() => countByStatus(scopedCases), [scopedCases]);
  const pct = useMemo(() => statusPercentages(scopedCounts), [scopedCounts]);

  const categoryOptions = useMemo(() => {
    const names = listCategories(cases);
    const options = [
      { value: ALL_CATEGORIES_VALUE, label: 'Todas las categorías' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
    if (
      categoryFilter !== ALL_CATEGORIES_VALUE &&
      !names.includes(categoryFilter)
    ) {
      options.push({
        value: categoryFilter,
        label: `${categoryFilter} (sin casos en el periodo)`,
      });
    }
    return options;
  }, [cases, categoryFilter]);

  const companyOptions = useMemo(() => {
    const names = listCompanies(cases);
    const options = [
      { value: ALL_COMPANIES_VALUE, label: 'Todas las empresas' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
    if (companyFilter !== ALL_COMPANIES_VALUE && !names.includes(companyFilter)) {
      options.push({
        value: companyFilter,
        label: `${companyFilter} (sin casos en el periodo)`,
      });
    }
    return options;
  }, [cases, companyFilter]);

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

  const categoryFrequency = useMemo(
    () => buildCategoryFrequencyMetrics(scopedCases, 8),
    [scopedCases]
  );

  const companyFrequency = useMemo(
    () => buildCompanyFrequencyMetrics(scopedCases, 8),
    [scopedCases]
  );

  const matrixRows = useMemo(
    () => buildCategoryCompanyRows(scopedCases, 12),
    [scopedCases]
  );

  const avgIntervalScoped = useMemo(
    () => computeAverageIntervalDays(scopedCases),
    [scopedCases]
  );

  const creationTimeSeries = useMemo(
    () => buildScopedCreationTimeSeries(scopedCases, dateFilter, selectedMonthDate),
    [scopedCases, dateFilter, selectedMonthDate]
  );

  const statusPie = useMemo(
    () =>
      buildPieChart(
        statusInsightItems.map((i) => ({
          name: i.label,
          value: i.count,
          color: i.color,
        })),
        { showLegend: !chartViewport.isMobile, cutout: '58%' }
      ),
    [statusInsightItems, chartViewport.isMobile]
  );

  const categoryBarItems = useMemo(
    () =>
      categoryFrequency.map((item, index) => ({
        label: item.name,
        value: item.total,
        color: categoricalPalette[index % categoricalPalette.length],
      })),
    [categoryFrequency, categoricalPalette]
  );

  const companyBarItems = useMemo(
    () =>
      companyFrequency.map((item, index) => ({
        label: item.name,
        value: item.total,
        color: categoricalPalette[(index + 3) % categoricalPalette.length],
      })),
    [companyFrequency, categoricalPalette]
  );

  const categoryBarChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(categoryBarItems, chartViewport.isMobile, {
        valueLabel: 'tickets',
        datasetLabel: 'Por categoría',
        truncateLabels: true,
        compact: chartViewport.isCompact,
      }),
    [categoryBarItems, chartViewport.isMobile, chartViewport.isCompact]
  );

  const companyBarChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(companyBarItems, chartViewport.isMobile, {
        valueLabel: 'tickets',
        datasetLabel: 'Por empresa',
        truncateLabels: true,
        compact: chartViewport.isCompact,
      }),
    [companyBarItems, chartViewport.isMobile, chartViewport.isCompact]
  );

  const matrixStackedRows = useMemo(
    () =>
      matrixRows.slice(0, 8).map((row) => ({
        tecnico: truncateLabel(`${row.category} · ${row.company}`, 42),
        Abierto: row.counts.abierto,
        'En progreso': row.counts.enProgreso,
        Resuelto: row.counts.resuelto,
        Cerrado: row.counts.cerrado,
      })),
    [matrixRows]
  );

  const matrixStackedChart = useMemo(
    () => buildTicketStatusStackedBar(matrixStackedRows, true),
    [matrixStackedRows]
  );

  const dimensionStackedRows = useMemo(() => {
    if (companyFilter !== ALL_COMPANIES_VALUE) {
      return buildStatusStackedRowsByLabel(scopedCases, getCategoryLabel, 8);
    }
    if (categoryFilter !== ALL_CATEGORIES_VALUE) {
      return buildStatusStackedRowsByLabel(scopedCases, getCompanyLabel, 8);
    }
    return buildStatusStackedRowsByLabel(scopedCases, getCompanyLabel, 8);
  }, [scopedCases, categoryFilter, companyFilter]);

  const dimensionStackedChart = useMemo(
    () => buildTicketStatusStackedBar(dimensionStackedRows, true),
    [dimensionStackedRows]
  );

  const dimensionStackedTitle = useMemo(() => {
    if (companyFilter !== ALL_COMPANIES_VALUE) return 'Estados por categoría';
    if (categoryFilter !== ALL_CATEGORIES_VALUE) return 'Estados por empresa';
    return 'Estados por empresa (top 8)';
  }, [categoryFilter, companyFilter]);

  const creationLine = useMemo(
    () => buildAreaLineChart(creationTimeSeries, projectColors.secondary),
    [creationTimeSeries, projectColors.secondary]
  );

  const closedRate =
    scopedCounts.total > 0
      ? ((scopedCounts.resuelto + scopedCounts.cerrado) / scopedCounts.total) * 100
      : 0;

  const formatNumber = (n: number) => new Intl.NumberFormat('es-CO').format(n);

  const filterDescription = useMemo(() => {
    if (!isFiltered) {
      return 'Demanda por categoría y empresa · estados y frecuencia de solicitudes';
    }
    const parts: string[] = [];
    if (categoryFilter !== ALL_CATEGORIES_VALUE) parts.push(categoryFilter);
    if (companyFilter !== ALL_COMPANIES_VALUE) parts.push(companyFilter);
    return `Filtro activo: ${parts.join(' · ')}`;
  }, [isFiltered, categoryFilter, companyFilter]);

  const barChartHeight = (count: number) =>
    Math.max(200, count * (chartViewport.isCompact ? 38 : 44) + 48);

  const stackedChartHeight = (count: number) =>
    Math.max(220, count * 36 + 72);

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
            {filterDescription}
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
      <Paper p={{ base: 'sm', md: 'md' }} radius='md' withBorder>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing='md'>
          <Select
            label='Categoría'
            description='Tipo de solicitud'
            leftSection={<IconCategory2 size={18} />}
            data={categoryOptions}
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v ?? ALL_CATEGORIES_VALUE)}
            allowDeselect={false}
            searchable={categoryOptions.length > 6}
            nothingFoundMessage='Sin categorías en el periodo'
          />
          <Select
            label='Empresa'
            description='Compañía de origen'
            leftSection={<IconBuilding size={18} />}
            data={companyOptions}
            value={companyFilter}
            onChange={(v) => setCompanyFilter(v ?? ALL_COMPANIES_VALUE)}
            allowDeselect={false}
            searchable={companyOptions.length > 6}
            nothingFoundMessage='Sin empresas en el periodo'
          />
        </SimpleGrid>
        {isFiltered ? (
          <Group mt='sm' gap='xs'>
            <IconFilter size={14} />
            <Text size='xs' c='dimmed'>
              {formatNumber(scopedCounts.total)} tickets ·{' '}
              {formatNumber(new Set(scopedCases.map(getCategoryLabel)).size)} categorías ·{' '}
              {formatNumber(new Set(scopedCases.map(getCompanyLabel)).size)} empresas
            </Text>
          </Group>
        ) : null}
      </Paper>

      {error ? (
        <Alert icon={<IconAlertCircle size={20} />} title='Error al cargar' color='red' variant='light'>
          {error}
        </Alert>
      ) : null}

      <ActividadesSection
        priority={1}
        title='Resumen del periodo'
        description='Indicadores clave y composición de estados en gráfica.'
      >
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing={{ base: 'sm', sm: 'md' }}>
          <KpiStatCard
            label='Total tickets'
            value={loading ? '—' : formatNumber(scopedCounts.total)}
            hint={`${getFilterLabel(dateFilter)} · ${formatNumber(new Set(scopedCases.map(getCategoryLabel)).size)} cat. · ${formatNumber(new Set(scopedCases.map(getCompanyLabel)).size)} emp.`}
            color={projectColors.primary}
            icon={IconTicket}
            loading={loading}
          />
          <KpiStatCard
            label='Backlog activo'
            value={
              loading ? '—' : formatNumber(scopedCounts.abierto + scopedCounts.enProgreso)
            }
            hint={`${formatNumber(scopedCounts.abierto)} abiertos · ${formatNumber(scopedCounts.enProgreso)} en progreso`}
            sharePercent={pct.abierto + pct.enProgreso}
            color={ticketStatusChartColors.enProgreso}
            icon={IconClock}
            loading={loading}
          />
          <KpiStatCard
            label='Frecuencia media'
            value={loading ? '—' : formatIntervalLabel(avgIntervalScoped)}
            hint='Tiempo entre tickets consecutivos (aprox.)'
            color={projectColors.secondary}
            icon={IconClockHour4}
            loading={loading}
          />
          <KpiStatCard
            label='Tasa de cierre'
            value={loading ? '—' : `${Math.round(closedRate)}%`}
            hint={`${formatNumber(scopedCounts.resuelto + scopedCounts.cerrado)} resueltos o cerrados`}
            sharePercent={closedRate}
            color={projectColors.success}
            icon={IconCheck}
            loading={loading}
          />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing='lg'>
          <StatusInsightPanel
            items={statusInsightItems}
            total={scopedCounts.total}
            loading={loading}
          />
          <ChartCard
            height='100%'
            title='Composición de estados'
            description='Proporción de tickets por estado en el filtro activo'
          >
            {loading ? (
              <Skeleton style={{ flex: 1, minHeight: 200 }} radius='md' />
            ) : statusInsightItems.length > 0 ? (
              <FillHeightChartContainer
                type='pie'
                data={statusPie.data}
                options={statusPie.options}
              />
            ) : (
              <Flex flex={1} align='center' justify='center' mih={200}>
                <Text c='dimmed' size='sm' ta='center'>
                  Sin tickets en el periodo
                </Text>
              </Flex>
            )}
          </ChartCard>
        </SimpleGrid>
      </ActividadesSection>

      <ActividadesSection
        priority={2}
        title='Volumen por categoría y empresa'
        description='Top orígenes de demanda y ritmo de llegada en el tiempo.'
      >
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='lg' mb='lg'>
          <ChartCard
            height='auto'
            title='Top categorías'
            description='Tickets por tipo de solicitud'
          >
            {loading ? (
              <Skeleton height={barChartHeight(6)} />
            ) : categoryBarItems.length > 0 ? (
              <ChartContainer
                type='bar'
                data={categoryBarChart.data}
                options={categoryBarChart.options}
                height={barChartHeight(categoryBarItems.length)}
              />
            ) : (
              <Text c='dimmed' ta='center' py='md' size='sm'>
                Sin categorías en el periodo
              </Text>
            )}
          </ChartCard>
          <ChartCard
            height='auto'
            title='Top empresas'
            description='Tickets por compañía de origen'
          >
            {loading ? (
              <Skeleton height={barChartHeight(6)} />
            ) : companyBarItems.length > 0 ? (
              <ChartContainer
                type='bar'
                data={companyBarChart.data}
                options={companyBarChart.options}
                height={barChartHeight(companyBarItems.length)}
              />
            ) : (
              <Text c='dimmed' ta='center' py='md' size='sm'>
                Sin empresas en el periodo
              </Text>
            )}
          </ChartCard>
        </SimpleGrid>

        <ChartCard
          title='Entrada de tickets'
          description={`Evolución en ${getFilterLabel(dateFilter).toLowerCase()} · frecuencia media ${formatIntervalLabel(avgIntervalScoped)}`}
          height='auto'
        >
          {loading ? (
            <Skeleton height={220} />
          ) : creationTimeSeries.length > 0 ? (
            <ChartContainer
              type='line'
              data={creationLine.data}
              options={creationLine.options}
              height={220}
              scrollable={
                creationTimeSeries.length > (chartViewport.isCompact ? 6 : 10)
              }
            />
          ) : (
            <Text c='dimmed' ta='center' py='md' size='sm'>
              Sin tickets en el periodo
            </Text>
          )}
        </ChartCard>
      </ActividadesSection>

      <ActividadesSection
        priority={3}
        title='Estados y cruce categoría × empresa'
        description='Dónde se concentra el backlog y las combinaciones más frecuentes.'
      >
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing='lg' mb='lg'>
          <ChartCard
            title={dimensionStackedTitle}
            description='Abiertos, en progreso, resueltos y cerrados'
            height='auto'
          >
            {loading ? (
              <Skeleton height={stackedChartHeight(6)} />
            ) : dimensionStackedRows.length > 0 ? (
              <ChartContainer
                type='bar'
                data={dimensionStackedChart.data}
                options={dimensionStackedChart.options}
                height={stackedChartHeight(dimensionStackedRows.length)}
              />
            ) : (
              <Text c='dimmed' ta='center' py='md' size='sm'>
                Sin datos para graficar
              </Text>
            )}
          </ChartCard>
          <ChartCard
            title='Top cruces categoría · empresa'
            description='Estados por combinación más frecuente'
            height='auto'
          >
            {loading ? (
              <Skeleton height={stackedChartHeight(6)} />
            ) : matrixStackedRows.length > 0 ? (
              <ChartContainer
                type='bar'
                data={matrixStackedChart.data}
                options={matrixStackedChart.options}
                height={stackedChartHeight(matrixStackedRows.length)}
              />
            ) : (
              <Text c='dimmed' ta='center' py='md' size='sm'>
                Sin combinaciones en el periodo
              </Text>
            )}
          </ChartCard>
        </SimpleGrid>

        <Paper radius='md' withBorder p={{ base: 'xs', sm: 'md' }}>
          <Text size='sm' fw={600} mb='sm'>
            Tabla de detalle
          </Text>
          {loading ? (
            <Skeleton height={200} />
          ) : matrixRows.length > 0 ? (
            <Table.ScrollContainer minWidth={560}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Categoría</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th ta='right'>Total</Table.Th>
                    <Table.Th ta='right' visibleFrom='sm'>
                      Pendientes
                    </Table.Th>
                    <Table.Th ta='right'>Cerrados</Table.Th>
                    <Table.Th visibleFrom='md'>Frecuencia</Table.Th>
                    <Table.Th>Estado</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {matrixRows.map((row) => {
                    const pending = row.counts.abierto + row.counts.enProgreso;
                    const dominant = dominantStatus(row.counts);
                    return (
                      <Table.Tr key={`${row.category}-${row.company}`}>
                        <Table.Td>
                          <Text size='sm' fw={600} lineClamp={2}>
                            {row.category}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm' lineClamp={1}>
                            {row.company}
                          </Text>
                        </Table.Td>
                        <Table.Td ta='right' fw={600}>
                          {formatNumber(row.total)}
                        </Table.Td>
                        <Table.Td ta='right' visibleFrom='sm'>
                          <Text size='sm' c={pending > 0 ? 'orange' : 'dimmed'}>
                            {formatNumber(pending)}
                          </Text>
                        </Table.Td>
                        <Table.Td ta='right'>
                          {formatNumber(row.counts.resuelto + row.counts.cerrado)}
                        </Table.Td>
                        <Table.Td visibleFrom='md'>
                          <Text size='xs' c='dimmed'>
                            {formatIntervalLabel(row.avgIntervalDays)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size='sm' variant='light' color={statusBadgeColor(dominant)}>
                            {dominant}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text c='dimmed' ta='center' py='lg' size='sm'>
              Sin tickets para los filtros seleccionados
            </Text>
          )}
        </Paper>
      </ActividadesSection>
    </DashboardPageShell>
  );
}

function truncateLabel(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function dominantStatus(counts: ReturnType<typeof countByStatus>): string {
  const entries = [
    { label: 'Abierto', value: counts.abierto },
    { label: 'En progreso', value: counts.enProgreso },
    { label: 'Resuelto', value: counts.resuelto },
    { label: 'Cerrado', value: counts.cerrado },
  ];
  const top = entries.sort((a, b) => b.value - a.value)[0];
  return top && top.value > 0 ? top.label : '—';
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'Abierto':
      return 'blue';
    case 'En progreso':
      return 'violet';
    case 'Resuelto':
      return 'green';
    case 'Cerrado':
      return 'gray';
    default:
      return 'gray';
  }
}
