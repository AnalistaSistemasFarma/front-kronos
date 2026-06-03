'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Flex,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Badge,
  Pagination,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import { BarChart, PieChart } from '@mantine/charts';
import { ChartContainer } from './ChartContainer';
import {
  IconChevronLeft,
  IconChevronDown,
  IconChevronRight,
  IconUsers,
  IconUser,
  IconCheck,
  IconClock,
  IconProgress,
  IconChartBar,
  IconChartPie,
  IconLayoutGrid,
} from '@tabler/icons-react';
import {
  dashboardChartTheme,
  encargadoBarPalette,
  encargadoBarPaletteMantine,
  getStatusBadgeStyle,
  buildCategoryYAxisProps,
  buildValueXAxisProps,
  executiveBarChartProps,
  getResponsiveChartHeight,
  getResponsiveYAxisWidth,
  statusChartColors,
  statusSeries,
} from './chartTheme';
import { useChartViewport } from './useChartViewport';

const chartLabelColor = '#334155';
const TASKS_PER_PAGE = 10;

type PersonViewMode = 'team' | 'individual' | 'cards';

type AssigneeRow = {
  asignado: string;
  Completada: number;
  Pendiente: number;
  'En Proceso': number;
  total: number;
};

function completionRate(row: AssigneeRow): number {
  if (row.total === 0) return 0;
  return Math.round((row.Completada / row.total) * 100);
}

export interface TaskWithEncargado {
  id_tarea: number;
  tarea: string;
  estado_tarea: string;
  asignado_tarea: string;
  encargado_proceso?: string | null;
  id_solicitud: number;
  asunto_solicitud: string;
  proceso_solicitud: string;
  categoria_solicitud: string;
}

function normalizeEncargado(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Sin encargado';
}

function normalizeAsignado(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Sin asignar';
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function ChartStatusLegend({ fullWidth = false }: { fullWidth?: boolean }) {
  return (
    <Paper
      p='sm'
      radius='md'
      withBorder
      w={fullWidth ? '100%' : undefined}
      style={{ background: '#fff', borderColor: dashboardChartTheme.blue100 }}
    >
      <Group gap='md' justify='center' wrap='wrap'>
        {statusSeries.map((s) => (
          <Group key={s.name} gap={8}>
            <Box
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: s.color,
                flexShrink: 0,
              }}
            />
            <Text size='sm' fw={600} style={{ color: chartLabelColor }}>
              {s.label}
            </Text>
          </Group>
        ))}
      </Group>
    </Paper>
  );
}

function PersonStatusCounts({
  completada,
  pendiente,
  enProceso,
}: {
  completada: number;
  pendiente: number;
  enProceso: number;
}) {
  const items = [
    { label: 'Completadas', value: completada, color: statusChartColors.completada },
    { label: 'Pendientes', value: pendiente, color: statusChartColors.pendiente },
    { label: 'En proceso', value: enProceso, color: statusChartColors.enProceso },
  ];

  return (
    <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='xs' mt='sm'>
      {items.map((item) => (
        <Box
          key={item.label}
          ta='center'
          p='xs'
          style={{
            background: '#f8fafc',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
            {item.label}
          </Text>
          <Text size='xl' fw={800} lh={1.2} mt={4} style={{ color: item.color }}>
            {item.value}
          </Text>
        </Box>
      ))}
    </SimpleGrid>
  );
}

function StatusDistributionBar({
  completada,
  pendiente,
  enProceso,
}: {
  completada: number;
  pendiente: number;
  enProceso: number;
}) {
  const total = completada + pendiente + enProceso;
  if (total === 0) return null;

  const segments = [
    { value: completada, color: statusChartColors.completada },
    { value: enProceso, color: statusChartColors.enProceso },
    { value: pendiente, color: statusChartColors.pendiente },
  ].filter((s) => s.value > 0);

  return (
    <Box
      style={{
        display: 'flex',
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        background: dashboardChartTheme.blue50,
      }}
    >
      {segments.map((seg, i) => (
        <Box
          key={i}
          style={{
            flex: seg.value,
            backgroundColor: seg.color,
            minWidth: seg.value > 0 ? 4 : 0,
          }}
        />
      ))}
    </Box>
  );
}

function ChartTooltip({
  label,
  value,
  color,
  suffix = 'tareas',
}: {
  label: string;
  value: number;
  color: string;
  suffix?: string;
}) {
  return (
    <Paper shadow='md' p='sm' radius='md' withBorder style={{ minWidth: 160, borderColor: '#e9ecef' }}>
      <Text size='xs' c='dimmed' mb={6} lineClamp={2}>
        {label}
      </Text>
      <Group gap='xs' align='baseline'>
        <Box
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
        <Text fw={700} size='xl' style={{ color: dashboardChartTheme.primary, lineHeight: 1 }}>
          {value}
        </Text>
        <Text size='xs' c='dimmed'>
          {suffix}
        </Text>
      </Group>
    </Paper>
  );
}

function PersonCardsGrid({ people }: { people: AssigneeRow[] }) {
  const maxTeam = Math.max(...people.map((p) => p.total), 1);

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing='sm' mt='md'>
      {people.map((person) => {
        const pct = Math.round((person.total / maxTeam) * 100);
        return (
          <Paper
            key={person.asignado}
            p={{ base: 'sm', sm: 'md' }}
            radius='md'
            withBorder
            bg='white'
            style={{ borderColor: dashboardChartTheme.blue100 }}
          >
            <Group wrap='nowrap' gap='sm' align='flex-start' mb='xs'>
              <ThemeIcon size={40} radius='md' variant='gradient' gradient={dashboardChartTheme.gradient}>
                <Text size='xs' fw={700} c='white'>
                  {getInitials(person.asignado)}
                </Text>
              </ThemeIcon>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group justify='space-between' wrap='nowrap' gap='xs'>
                  <Text size='sm' fw={700} lineClamp={2} style={{ color: dashboardChartTheme.primary }}>
                    {person.asignado}
                  </Text>
                  <Badge
                    variant='filled'
                    size='sm'
                    styles={{
                      root: {
                        backgroundColor: dashboardChartTheme.primary,
                        color: '#fff',
                        flexShrink: 0,
                      },
                    }}
                  >
                    {person.total}
                  </Badge>
                </Group>
                <Text size='xs' fw={500} mt={4} style={{ color: chartLabelColor }}>
                  {pct}% de la carga · {completionRate(person)}% completado
                </Text>
              </Box>
            </Group>
            <PersonStatusCounts
              completada={person.Completada}
              pendiente={person.Pendiente}
              enProceso={person['En Proceso']}
            />
            <StatusDistributionBar
              completada={person.Completada}
              pendiente={person.Pendiente}
              enProceso={person['En Proceso']}
            />
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

function TeamExecutiveTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly { name?: string; value?: number; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const name = label != null ? String(label) : '';

  const person = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
  const completadas = Number(payload.find((p) => p.name === 'Completada')?.value) || 0;
  const pct = person > 0 ? Math.round((completadas / person) * 100) : 0;

  return (
    <Paper shadow='sm' p='sm' radius='md' withBorder style={{ borderColor: '#e2e8f0', minWidth: 200 }}>
      <Text size='xs' fw={700} mb={8} style={{ color: dashboardChartTheme.primary }}>
        {name}
      </Text>
      {payload
        .filter((p) => Number(p.value) > 0)
        .map((p) => (
          <Group key={p.name} justify='space-between' gap='md' mb={4}>
            <Group gap={6}>
              <Box w={8} h={8} style={{ borderRadius: 2, backgroundColor: p.color }} />
              <Text size='xs' style={{ color: chartLabelColor }}>
                {p.name}
              </Text>
            </Group>
            <Text size='xs' fw={700}>
              {p.value}
            </Text>
          </Group>
        ))}
      <Box pt={6} mt={4} style={{ borderTop: '1px solid #e2e8f0' }}>
        <Group justify='space-between'>
          <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
            Total · Cumplimiento
          </Text>
          <Text size='xs' fw={700} style={{ color: dashboardChartTheme.primary }}>
            {person} tareas · {pct}%
          </Text>
        </Group>
      </Box>
    </Paper>
  );
}

function TeamSummaryTable({ people }: { people: AssigneeRow[] }) {
  return (
    <Box mt='lg'>
      <Text size='sm' fw={700} mb='sm' style={{ color: dashboardChartTheme.primary }}>
        Resumen del equipo
      </Text>

      <Stack gap='sm' hiddenFrom='md'>
        {people.map((person) => (
          <Paper
            key={person.asignado}
            p='sm'
            radius='md'
            withBorder
            style={{ borderColor: dashboardChartTheme.blue100 }}
          >
            <Group justify='space-between' mb='xs' wrap='wrap' gap='xs'>
              <Text size='sm' fw={700} style={{ color: dashboardChartTheme.primary }}>
                {person.asignado}
              </Text>
              <Badge
                variant='light'
                size='sm'
                styles={{
                  root: {
                    backgroundColor: '#f1f5f9',
                    color: dashboardChartTheme.primary,
                    fontWeight: 700,
                  },
                }}
              >
                {completionRate(person)}% cumpl.
              </Badge>
            </Group>
            <SimpleGrid cols={4} spacing={6}>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Total
                </Text>
                <Text fw={700}>{person.total}</Text>
              </Box>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Compl.
                </Text>
                <Text fw={700} style={{ color: statusChartColors.completada }}>
                  {person.Completada}
                </Text>
              </Box>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Pend.
                </Text>
                <Text fw={700} style={{ color: statusChartColors.pendiente }}>
                  {person.Pendiente}
                </Text>
              </Box>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Proc.
                </Text>
                <Text fw={700} style={{ color: statusChartColors.enProceso }}>
                  {person['En Proceso']}
                </Text>
              </Box>
            </SimpleGrid>
          </Paper>
        ))}
      </Stack>

      <Table.ScrollContainer minWidth={520} type='native' visibleFrom='md'>
        <Table
          fz='sm'
          verticalSpacing='xs'
          striped
          highlightOnHover
          styles={{
            thead: { backgroundColor: '#f8fafc' },
            th: {
              color: chartLabelColor,
              fontWeight: 600,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Colaborador</Table.Th>
              <Table.Th ta='center'>Total</Table.Th>
              <Table.Th ta='center'>Compl.</Table.Th>
              <Table.Th ta='center'>Pend.</Table.Th>
              <Table.Th ta='center'>En proc.</Table.Th>
              <Table.Th ta='right'>Cumplimiento</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {people.map((person) => (
              <Table.Tr key={person.asignado}>
                <Table.Td>
                  <Text size='sm' fw={600} lineClamp={2} style={{ color: dashboardChartTheme.primary }}>
                    {person.asignado}
                  </Text>
                </Table.Td>
                <Table.Td ta='center' fw={600}>
                  {person.total}
                </Table.Td>
                <Table.Td ta='center' style={{ color: statusChartColors.completada }}>
                  {person.Completada}
                </Table.Td>
                <Table.Td ta='center' style={{ color: statusChartColors.pendiente }}>
                  {person.Pendiente}
                </Table.Td>
                <Table.Td ta='center' style={{ color: statusChartColors.enProceso }}>
                  {person['En Proceso']}
                </Table.Td>
                <Table.Td ta='right'>
                  <Badge
                    variant='light'
                    size='sm'
                    styles={{
                      root: {
                        backgroundColor: '#f1f5f9',
                        color: dashboardChartTheme.primary,
                        fontWeight: 700,
                      },
                    }}
                  >
                    {completionRate(person)}%
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Box>
  );
}

function TeamPerformanceCharts({ people }: { people: AssigneeRow[] }) {
  const { isMobile, isCompact } = useChartViewport();
  const names = people.map((p) => p.asignado);
  const chartHeight = getResponsiveChartHeight(people.length, isCompact);
  const yAxisWidth = getResponsiveYAxisWidth(names, isMobile);
  const maxTotal = Math.max(...people.map((p) => p.total), 0);
  const chartMargin = isMobile
    ? { top: 8, right: 12, left: 0, bottom: 4 }
    : { top: 12, right: 24, left: 4, bottom: 8 };

  return (
    <Paper
      p={{ base: 'sm', sm: 'md', lg: 'lg' }}
      radius='md'
      withBorder
      bg='white'
      mt='md'
      style={{ borderColor: dashboardChartTheme.chartPanelBorder }}
    >
      <Stack gap='sm' mb='md'>
        <Box>
          <Text size='sm' fw={700} style={{ color: dashboardChartTheme.primary }}>
            Panorama del equipo
          </Text>
          <Text size='xs' mt={2} style={{ color: chartLabelColor }}>
            Distribución de tareas y cumplimiento por colaborador
          </Text>
        </Box>
        <ChartStatusLegend fullWidth />
      </Stack>

      <Box w='100%' style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <ChartContainer height={chartHeight} minWidth={0}>
          <BarChart
            data={people}
            dataKey='asignado'
            orientation='vertical'
            type='stacked'
            series={[...statusSeries]}
            withTooltip
            withLegend={false}
            {...executiveBarChartProps}
            maxBarWidth={isMobile ? 28 : 36}
            barProps={{ radius: 0, strokeWidth: 0 }}
            barChartProps={{ margin: chartMargin }}
            xAxisProps={buildValueXAxisProps(maxTotal, isMobile)}
            yAxisProps={buildCategoryYAxisProps(yAxisWidth, isMobile)}
            tooltipProps={{ cursor: false, content: TeamExecutiveTooltip }}
          />
        </ChartContainer>
      </Box>

      <TeamSummaryTable people={people} />
    </Paper>
  );
}

function IndividualPerformanceView({
  people,
  selectedAsignado,
  onSelectAsignado,
}: {
  people: AssigneeRow[];
  selectedAsignado: string | null;
  onSelectAsignado: (name: string) => void;
}) {
  const { isMobile, isCompact } = useChartViewport();
  const person = people.find((p) => p.asignado === selectedAsignado) ?? people[0];
  if (!person) return null;

  const pieSize = isMobile ? 160 : isCompact ? 180 : 220;
  const barChartHeight = isMobile ? 100 : 120;

  /** Colores Mantine (hex en PieChart a veces no pinta el arco y queda blanco) */
  const pieData = [
    { name: 'Completadas', value: person.Completada, color: 'blue.9' },
    { name: 'Pendientes', value: person.Pendiente, color: 'blue.5' },
    { name: 'En proceso', value: person['En Proceso'], color: 'cyan.5' },
  ].filter((d) => d.value > 0);

  const pieChartHeight = pieSize + 24;

  const barData = [
    {
      asignado: person.asignado,
      Completada: person.Completada,
      Pendiente: person.Pendiente,
      'En Proceso': person['En Proceso'],
    },
  ];

  return (
    <Stack gap='md' mt='md'>
      <Select
        label='Persona a evaluar'
        placeholder='Seleccione'
        data={people.map((p) => ({
          value: p.asignado,
          label: `${p.asignado} (${p.total} tareas)`,
        }))}
        value={person.asignado}
        onChange={(v) => v && onSelectAsignado(v)}
        allowDeselect={false}
        searchable={people.length > 5}
        comboboxProps={{ withinPortal: true }}
      />

      <Paper
        p={{ base: 'sm', sm: 'md', lg: 'lg' }}
        radius='md'
        withBorder
        bg='white'
        style={{ borderColor: dashboardChartTheme.blue100 }}
      >
        <Group wrap='wrap' gap='md' mb='lg' align='flex-start'>
          <ThemeIcon
            size={isMobile ? 44 : 52}
            radius='md'
            variant='gradient'
            gradient={dashboardChartTheme.gradient}
          >
            <Text fw={700} c='white'>
              {getInitials(person.asignado)}
            </Text>
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 160 }}>
            <Text fw={700} size={isMobile ? 'md' : 'lg'} style={{ color: dashboardChartTheme.primary }}>
              {person.asignado}
            </Text>
            <Text size='sm' style={{ color: chartLabelColor }}>
              {person.total} tareas · {completionRate(person)}% de cumplimiento
            </Text>
          </Box>
          <Badge size={isMobile ? 'md' : 'lg'} variant='filled' color='blue'>
            {completionRate(person)}% OK
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={{ base: 'md', sm: 'lg' }}>
          <Box>
            <Text size='sm' fw={700} mb={4} style={{ color: dashboardChartTheme.primary }}>
              Estado de las tareas asignadas
            </Text>
            <Text size='xs' mb='sm' style={{ color: chartLabelColor }}>
              Completadas, pendientes y en proceso de esta persona
            </Text>
            {person.total > 0 && pieData.length > 0 ? (
              <Box w='100%' style={{ maxWidth: pieChartHeight, margin: '0 auto' }}>
                <ChartContainer height={pieChartHeight} minWidth={0}>
                  <PieChart
                    data={pieData}
                    size={pieSize}
                    withTooltip
                    tooltipDataSource='segment'
                    withLabels
                    labelsType='percent'
                    labelsPosition='inside'
                    strokeWidth={1}
                  />
                </ChartContainer>
                <Group justify='center' gap='md' mt='xs' wrap='wrap'>
                  {pieData.map((slice) => (
                    <Group key={slice.name} gap={6}>
                      <Box
                        w={10}
                        h={10}
                        style={{
                          borderRadius: 2,
                          backgroundColor:
                            slice.name === 'Completadas'
                              ? statusChartColors.completada
                              : slice.name === 'Pendientes'
                                ? statusChartColors.pendiente
                                : statusChartColors.enProceso,
                        }}
                      />
                      <Text size='xs' style={{ color: chartLabelColor }}>
                        {slice.name}: {slice.value}
                      </Text>
                    </Group>
                  ))}
                </Group>
              </Box>
            ) : person.total > 0 ? (
              <Stack gap='sm' align='center' py='md'>
                <Text size='sm' c='dimmed' ta='center'>
                  Hay {person.total} tareas, pero sin estados reconocidos para el gráfico.
                </Text>
                <PersonStatusCounts
                  completada={person.Completada}
                  pendiente={person.Pendiente}
                  enProceso={person['En Proceso']}
                />
              </Stack>
            ) : (
              <Text size='sm' c='dimmed' ta='center' py='xl'>
                Sin tareas asignadas en este periodo
              </Text>
            )}
          </Box>
          <Box>
            <Text size='sm' fw={700} mb='xs' style={{ color: dashboardChartTheme.primary }}>
              Detalle numérico
            </Text>
            <PersonStatusCounts
              completada={person.Completada}
              pendiente={person.Pendiente}
              enProceso={person['En Proceso']}
            />
            <Box mt='md'>
              <Text size='xs' fw={600} mb={6} style={{ color: chartLabelColor }}>
                Avance de completadas
              </Text>
              <Progress
                value={completionRate(person)}
                size='xl'
                radius='xl'
                styles={{
                  root: { backgroundColor: '#e2e8f0' },
                  section: { backgroundColor: statusChartColors.completada },
                }}
              />
              <Text size='xs' ta='center' mt={4} fw={700} style={{ color: statusChartColors.completada }}>
                {completionRate(person)}% completadas
              </Text>
            </Box>
            <StatusDistributionBar
              completada={person.Completada}
              pendiente={person.Pendiente}
              enProceso={person['En Proceso']}
            />
          </Box>
        </SimpleGrid>

        <Box mt='lg' visibleFrom='sm'>
          <Text size='sm' fw={700} mb='sm' style={{ color: dashboardChartTheme.primary }}>
            Barras por estado
          </Text>
          <ChartContainer height={barChartHeight} minWidth={0}>
            <BarChart
              data={barData}
              dataKey='asignado'
              orientation='vertical'
              type='default'
              series={[...statusSeries]}
              withTooltip
              withLegend={false}
              {...executiveBarChartProps}
              maxBarWidth={32}
              barChartProps={{ margin: { top: 8, right: 16, left: 4, bottom: 8 } }}
              xAxisProps={buildValueXAxisProps(person.total, isCompact)}
              yAxisProps={buildCategoryYAxisProps(
                getResponsiveYAxisWidth([person.asignado], isMobile),
                isMobile
              )}
            />
          </ChartContainer>
        </Box>
      </Paper>
    </Stack>
  );
}

function TaskDetailTable({
  rows,
  page,
  onPageChange,
}: {
  rows: TaskWithEncargado[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { isMobile } = useChartViewport();
  const totalPages = Math.max(1, Math.ceil(rows.length / TASKS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * TASKS_PER_PAGE;
  const pageRows = rows.slice(start, start + TASKS_PER_PAGE);
  const rangeFrom = rows.length === 0 ? 0 : start + 1;
  const rangeTo = Math.min(start + TASKS_PER_PAGE, rows.length);

  return (
    <Box>
      {/* Móvil: tarjetas */}
      <Stack gap='sm' hiddenFrom='sm'>
        {pageRows.map((row) => (
          <Paper
            key={row.id_tarea}
            p='sm'
            radius='md'
            withBorder
            style={{ borderColor: dashboardChartTheme.blue100 }}
          >
            <Group justify='space-between' align='flex-start' wrap='nowrap' gap='xs' mb={6}>
              <Text size='sm' fw={600} lineClamp={1} style={{ color: dashboardChartTheme.primary, flex: 1 }}>
                {normalizeAsignado(row.asignado_tarea)}
              </Text>
              <Badge size='sm' {...getStatusBadgeStyle(row.estado_tarea)} style={{ flexShrink: 0 }}>
                {row.estado_tarea}
              </Badge>
            </Group>
            <Text size='sm' lineClamp={2} mb={4}>
              {row.tarea}
            </Text>
            <Text size='xs' c='dimmed' lineClamp={2}>
              #{row.id_solicitud} · {row.asunto_solicitud}
            </Text>
          </Paper>
        ))}
        {pageRows.length === 0 && (
          <Text size='sm' c='dimmed' ta='center' py='md'>
            No hay tareas en este periodo
          </Text>
        )}
      </Stack>

      {/* Tablet/desktop: tabla con scroll horizontal */}
      <Table.ScrollContainer minWidth={560} type='native' visibleFrom='sm'>
        <Table
          striped
          highlightOnHover
          fz='sm'
          layout='fixed'
          styles={{
            th: { whiteSpace: 'nowrap', fontSize: 12 },
            td: { verticalAlign: 'top' },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={140}>Asignado</Table.Th>
              <Table.Th w='35%'>Tarea</Table.Th>
              <Table.Th w={110}>Estado</Table.Th>
              <Table.Th>Solicitud</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pageRows.map((row) => (
              <Table.Tr key={row.id_tarea}>
                <Table.Td>
                  <Text size='sm' fw={500} lineClamp={2}>
                    {normalizeAsignado(row.asignado_tarea)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size='sm' lineClamp={2}>
                    {row.tarea}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge size='sm' {...getStatusBadgeStyle(row.estado_tarea)}>
                    {row.estado_tarea}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size='xs' lineClamp={2} title={`#${row.id_solicitud} — ${row.asunto_solicitud}`}>
                    <Text span fw={600} c={dashboardChartTheme.primary}>
                      #{row.id_solicitud}
                    </Text>{' '}
                    {row.asunto_solicitud}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {rows.length > 0 && (
        <Stack gap='sm' mt='md' align='stretch'>
          <Text size='xs' ta={{ base: 'center', sm: 'left' }} style={{ color: chartLabelColor }}>
            Mostrando {rangeFrom}–{rangeTo} de {rows.length} tareas
          </Text>
          {totalPages > 1 && (
            <Group justify='center' w='100%'>
              <Pagination
                total={totalPages}
                value={safePage}
                onChange={onPageChange}
                size='sm'
                withEdges={!isMobile}
                siblings={isMobile ? 0 : 1}
                boundaries={1}
              />
            </Group>
          )}
        </Stack>
      )}
    </Box>
  );
}

interface EncargadoActivitiesChartProps {
  tasks: TaskWithEncargado[];
  periodLabel: string;
}

export default function EncargadoActivitiesChart({
  tasks,
  periodLabel,
}: EncargadoActivitiesChartProps) {
  const [selectedEncargado, setSelectedEncargado] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [taskPage, setTaskPage] = useState(1);
  const [personViewMode, setPersonViewMode] = useState<PersonViewMode>('team');
  const [selectedAsignado, setSelectedAsignado] = useState<string | null>(null);

  useEffect(() => {
    setSelectedEncargado(null);
    setTableOpen(false);
    setTaskPage(1);
    setPersonViewMode('team');
    setSelectedAsignado(null);
  }, [tasks, periodLabel]);

  useEffect(() => {
    setSelectedAsignado(null);
    setPersonViewMode('team');
    setTaskPage(1);
  }, [selectedEncargado]);

  const encargadoChartData = useMemo(() => {
    const counts = tasks.reduce(
      (acc, task) => {
        const key = normalizeEncargado(task.encargado_proceso);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const max = Math.max(...Object.values(counts), 1);

    return Object.entries(counts)
      .map(([encargado, tareas], index) => {
        const paletteIndex = index % encargadoBarPalette.length;
        return {
          encargado,
          tareas,
          color: encargadoBarPaletteMantine[paletteIndex % encargadoBarPaletteMantine.length],
          barHex: encargadoBarPalette[paletteIndex],
          pct: Math.round((tareas / max) * 100),
        };
      })
      .sort((a, b) => b.tareas - a.tareas);
  }, [tasks]);

  const maxEncargadoTareas = useMemo(
    () => Math.max(...encargadoChartData.map((d) => d.tareas), 0),
    [encargadoChartData]
  );

  const { isMobile, isCompact } = useChartViewport();

  const overviewChartHeight = useMemo(
    () => getResponsiveChartHeight(encargadoChartData.length, isCompact),
    [encargadoChartData.length, isCompact]
  );

  const overviewYAxisWidth = useMemo(
    () => getResponsiveYAxisWidth(encargadoChartData.map((d) => d.encargado), isMobile),
    [encargadoChartData, isMobile]
  );

  const assigneeChartData = useMemo(() => {
    if (!selectedEncargado) return [];

    const filtered = tasks.filter(
      (t) => normalizeEncargado(t.encargado_proceso) === selectedEncargado
    );

    const byAssignee = filtered.reduce(
      (acc, task) => {
        const name = normalizeAsignado(task.asignado_tarea);
        if (!acc[name]) {
          acc[name] = { Completada: 0, Pendiente: 0, 'En Proceso': 0 };
        }
        const status = task.estado_tarea || 'Pendiente';
        if (status in acc[name]) {
          acc[name][status as keyof (typeof acc)[string]] += 1;
        } else {
          acc[name].Pendiente += 1;
        }
        return acc;
      },
      {} as Record<string, { Completada: number; Pendiente: number; 'En Proceso': number }>
    );

    return Object.entries(byAssignee)
      .map(([asignado, counts]) => ({
        asignado,
        ...counts,
        total: counts.Completada + counts.Pendiente + counts['En Proceso'],
      }))
      .sort((a, b) => b.total - a.total);
  }, [tasks, selectedEncargado]);

  useEffect(() => {
    if (assigneeChartData.length === 0) {
      setSelectedAsignado(null);
      return;
    }
    if (!selectedAsignado || !assigneeChartData.some((p) => p.asignado === selectedAsignado)) {
      setSelectedAsignado(assigneeChartData[0].asignado);
    }
  }, [assigneeChartData, selectedAsignado]);

  const detailRows = useMemo(() => {
    if (!selectedEncargado) return [];
    return tasks
      .filter((t) => normalizeEncargado(t.encargado_proceso) === selectedEncargado)
      .sort((a, b) => a.asignado_tarea.localeCompare(b.asignado_tarea));
  }, [tasks, selectedEncargado]);

  const detailStatusSummary = useMemo(() => {
    const summary = { Completada: 0, Pendiente: 0, 'En Proceso': 0 };
    detailRows.forEach((row) => {
      const status = row.estado_tarea || 'Pendiente';
      if (status in summary) {
        summary[status as keyof typeof summary] += 1;
      } else {
        summary.Pendiente += 1;
      }
    });
    return summary;
  }, [detailRows]);

  useEffect(() => {
    setTaskPage(1);
  }, [detailRows.length, selectedEncargado]);

  const totalTasks = tasks.length;

  if (tasks.length === 0) {
    return (
      <Paper p='xl' radius='md' style={{ background: dashboardChartTheme.chartSurface }}>
        <Stack align='center' gap='sm'>
          <ThemeIcon size={48} radius='xl' variant='light' color='blue'>
            <IconUsers size={24} />
          </ThemeIcon>
          <Text size='sm' c='dimmed' ta='center'>
            No hay actividades en el periodo ({periodLabel}).
          </Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap='lg'>
      <Group justify='space-between' align='flex-start' wrap='wrap'>
        <Box>
          <Text size='sm' fw={600} style={{ color: dashboardChartTheme.primary }}>
            Actividades por encargado de área
          </Text>
          <Text size='xs' fw={500} style={{ color: chartLabelColor }}>
            Periodo {periodLabel} · {totalTasks} tareas en total
          </Text>
        </Box>
        {!selectedEncargado && (
          <Badge
            variant='light'
            size='lg'
            styles={{
              root: {
                backgroundColor: dashboardChartTheme.blue50,
                color: dashboardChartTheme.primary,
                fontWeight: 700,
                textTransform: 'none',
              },
            }}
          >
            {encargadoChartData.length}{' '}
            {encargadoChartData.length === 1 ? 'encargado' : 'encargados'}
          </Badge>
        )}
      </Group>

      {selectedEncargado ? (
        <Stack gap='md'>
          <Paper
            p={{ base: 'sm', sm: 'md', lg: 'lg' }}
            radius='lg'
            withBorder
            style={{
              background: dashboardChartTheme.chartSurface,
              borderColor: dashboardChartTheme.borderAccent,
            }}
          >
            <Group justify='space-between' mb='lg' wrap='wrap' gap='sm'>
              <Group gap='sm'>
                <Button
                  variant='light'
                  color='blue'
                  size='compact-sm'
                  leftSection={<IconChevronLeft size={14} />}
                  onClick={() => setSelectedEncargado(null)}
                >
                  Encargados
                </Button>
                <ThemeIcon
                  size={44}
                  radius='md'
                  variant='gradient'
                  gradient={dashboardChartTheme.gradient}
                >
                  <Text fw={700} size='sm' c='white'>
                    {getInitials(selectedEncargado)}
                  </Text>
                </ThemeIcon>
                <Box>
                  <Text fw={600} size='md' style={{ color: dashboardChartTheme.primary }}>
                    {selectedEncargado}
                  </Text>
                  <Text size='xs' c='dimmed'>
                    Equipo a cargo · {detailRows.length} tareas · {assigneeChartData.length}{' '}
                    personas
                  </Text>
                </Box>
              </Group>
              <Badge
                variant='gradient'
                gradient={dashboardChartTheme.gradient}
                size='lg'
              >
                Periodo {periodLabel}
              </Badge>
            </Group>

            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='sm' mb='lg'>
              <Paper
                p='sm'
                radius='md'
                withBorder
                style={{ background: dashboardChartTheme.blue50, borderColor: dashboardChartTheme.blue100 }}
              >
                <Group gap='xs' mb={4}>
                  <ThemeIcon
                    size='sm'
                    variant='light'
                    style={{ background: '#fff', color: statusChartColors.completada }}
                  >
                    <IconCheck size={14} />
                  </ThemeIcon>
                  <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
                    Completadas
                  </Text>
                </Group>
                <Text fw={800} size='xl' style={{ color: statusChartColors.completada }}>
                  {detailStatusSummary.Completada}
                </Text>
              </Paper>
              <Paper
                p='sm'
                radius='md'
                withBorder
                style={{ background: dashboardChartTheme.blue50, borderColor: dashboardChartTheme.blue100 }}
              >
                <Group gap='xs' mb={4}>
                  <ThemeIcon
                    size='sm'
                    variant='light'
                    style={{ background: '#fff', color: statusChartColors.pendiente }}
                  >
                    <IconClock size={14} />
                  </ThemeIcon>
                  <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
                    Pendientes
                  </Text>
                </Group>
                <Text fw={800} size='xl' style={{ color: statusChartColors.pendiente }}>
                  {detailStatusSummary.Pendiente}
                </Text>
              </Paper>
              <Paper
                p='sm'
                radius='md'
                withBorder
                style={{ background: dashboardChartTheme.blue50, borderColor: dashboardChartTheme.blue100 }}
              >
                <Group gap='xs' mb={4}>
                  <ThemeIcon
                    size='sm'
                    variant='light'
                    style={{ background: '#fff', color: statusChartColors.enProceso }}
                  >
                    <IconProgress size={14} />
                  </ThemeIcon>
                  <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
                    En proceso
                  </Text>
                </Group>
                <Text fw={700} size='xl' style={{ color: statusChartColors.enProceso }}>
                  {detailStatusSummary['En Proceso']}
                </Text>
              </Paper>
            </SimpleGrid>

            <Stack gap='sm' mb='xs'>
              <Box>
                <Text size='sm' fw={700} style={{ color: dashboardChartTheme.primary }}>
                  Rendimiento del equipo
                </Text>
                <Text size='xs' style={{ color: chartLabelColor }}>
                  Misma información · distinta visualización
                </Text>
              </Box>
              <SegmentedControl
                fullWidth
                value={personViewMode}
                onChange={(v) => setPersonViewMode((v as PersonViewMode) || 'team')}
                data={[
                  {
                    value: 'team',
                    label: (
                      <Group gap={6} wrap='nowrap'>
                        <IconChartBar size={14} />
                        <span>Equipo</span>
                      </Group>
                    ),
                  },
                  {
                    value: 'individual',
                    label: (
                      <Group gap={6} wrap='nowrap'>
                        <IconChartPie size={14} />
                        <span>Individual</span>
                      </Group>
                    ),
                  },
                  {
                    value: 'cards',
                    label: (
                      <Group gap={6} wrap='nowrap'>
                        <IconLayoutGrid size={14} />
                        <span>Tarjetas</span>
                      </Group>
                    ),
                  },
                ]}
              />
            </Stack>

            {assigneeChartData.length > 0 ? (
              <>
                {personViewMode === 'team' && <TeamPerformanceCharts people={assigneeChartData} />}
                {personViewMode === 'individual' && (
                  <IndividualPerformanceView
                    people={assigneeChartData}
                    selectedAsignado={selectedAsignado}
                    onSelectAsignado={setSelectedAsignado}
                  />
                )}
                {personViewMode === 'cards' && (
                  <>
                    <ChartStatusLegend />
                    <PersonCardsGrid people={assigneeChartData} />
                  </>
                )}
              </>
            ) : (
              <Text size='sm' ta='center' py='xl' fw={500} style={{ color: chartLabelColor }}>
                Sin personas asignadas en este encargado.
              </Text>
            )}
          </Paper>

          <UnstyledButton onClick={() => setTableOpen((o) => !o)} w='100%'>
            <Paper
              withBorder
              p='md'
              radius='md'
              style={{
                borderColor: tableOpen ? dashboardChartTheme.borderAccentStrong : undefined,
                background: tableOpen ? dashboardChartTheme.blue50 : 'white',
              }}
            >
              <Group justify='space-between'>
                <Group gap='xs'>
                  <ThemeIcon
                    size='sm'
                    variant='gradient'
                    gradient={dashboardChartTheme.gradient}
                  >
                    <IconUsers size={14} />
                  </ThemeIcon>
                  <Text size='sm' fw={600}>
                    Detalle de tareas
                  </Text>
                  <Badge
                    variant='light'
                    size='sm'
                    styles={{
                      root: {
                        backgroundColor: dashboardChartTheme.blue100,
                        color: dashboardChartTheme.blue800,
                      },
                    }}
                  >
                    {detailRows.length}
                  </Badge>
                </Group>
                {tableOpen ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              </Group>
            </Paper>
          </UnstyledButton>

          <Collapse in={tableOpen}>
            <Paper
              withBorder
              radius='md'
              p={{ base: 'sm', sm: 'md' }}
              style={{ borderColor: dashboardChartTheme.blue100 }}
            >
              <TaskDetailTable
                rows={detailRows}
                page={taskPage}
                onPageChange={setTaskPage}
              />
            </Paper>
          </Collapse>
        </Stack>
      ) : (
        <>
          <Paper
            p={{ base: 'sm', sm: 'md', lg: 'lg' }}
            radius='lg'
            withBorder
            style={{
              background: dashboardChartTheme.chartPanelBg,
              borderColor: dashboardChartTheme.chartPanelBorder,
            }}
          >
            <Text size='xs' fw={600} mb='sm' style={{ color: chartLabelColor }}>
              Tareas por encargado — haga clic en una fila para ver el detalle del equipo
            </Text>
            <Box w='100%' style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <ChartContainer height={overviewChartHeight} minWidth={0}>
              <BarChart
                data={encargadoChartData}
                dataKey='encargado'
                orientation='vertical'
                series={[{ name: 'tareas', color: 'blue.8', label: 'Tareas' }]}
                withTooltip
                withBarValueLabel
                valueFormatter={(v) => `${v}`}
                {...executiveBarChartProps}
                tooltipProps={{
                  cursor: false,
                  content: ({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = encargadoChartData.find((d) => d.encargado === label);
                    return (
                      <ChartTooltip
                        label={String(label)}
                        value={Number(payload[0].value)}
                        color={row?.barHex ?? dashboardChartTheme.primary}
                      />
                    );
                  },
                }}
                maxBarWidth={isMobile ? 24 : encargadoChartData.length <= 3 ? 40 : 28}
                minBarSize={12}
                barChartProps={{
                  margin: isMobile
                    ? { top: 8, right: 12, left: 0, bottom: 4 }
                    : { top: 8, right: 28, left: 4, bottom: 8 },
                }}
                xAxisProps={buildValueXAxisProps(maxEncargadoTareas, isMobile)}
                yAxisProps={buildCategoryYAxisProps(overviewYAxisWidth, isMobile)}
              />
            </ChartContainer>
            </Box>
          </Paper>

          <Text size='sm' fw={600} style={{ color: dashboardChartTheme.primary }}>
            Seleccione un encargado
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            {encargadoChartData.map((item) => (
                <UnstyledButton
                  key={item.encargado}
                  onClick={() => setSelectedEncargado(item.encargado)}
                  w='100%'
                >
                  <Paper
                    p='md'
                    radius='md'
                    withBorder
                    style={{
                      borderLeft: `4px solid ${item.barHex}`,
                      background: 'white',
                      transition: 'box-shadow 0.15s ease, transform 0.15s ease',
                    }}
                    styles={{
                      root: {
                        '&:hover': {
                          boxShadow: `0 4px 14px ${dashboardChartTheme.blue800}22`,
                          transform: 'translateY(-1px)',
                          borderColor: dashboardChartTheme.blue200,
                        },
                      },
                    }}
                  >
                    <Group wrap='nowrap' gap='sm' align='flex-start'>
                      <ThemeIcon size={36} radius='md' color={item.color}>
                        <Text size='xs' fw={700} c='white'>
                          {getInitials(item.encargado)}
                        </Text>
                      </ThemeIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size='sm' fw={700} lineClamp={2} style={{ color: dashboardChartTheme.primary }}>
                          {item.encargado}
                        </Text>
                        <Group gap='xs' mt={4}>
                          <IconUser size={12} color={dashboardChartTheme.blue700} />
                          <Text size='xs' fw={500} style={{ color: chartLabelColor }}>
                            {item.tareas} {item.tareas === 1 ? 'tarea' : 'tareas'}
                            {encargadoChartData.length > 1 ? ` · ${item.pct}% del máximo` : ''}
                          </Text>
                        </Group>
                        <Progress
                          value={item.pct}
                          size='sm'
                          radius='xl'
                          mt='sm'
                          color={item.color}
                          styles={{
                            root: { backgroundColor: '#e2e8f0' },
                            section: { backgroundColor: item.barHex },
                          }}
                        />
                      </Box>
                      <IconChevronRight size={16} color={dashboardChartTheme.blue700} />
                    </Group>
                  </Paper>
                </UnstyledButton>
            ))}
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
