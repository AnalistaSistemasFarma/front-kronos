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
import { ChartContainer } from './ChartContainer';
import {
  buildHorizontalMultiColorBarChart,
  buildHorizontalStackedBarChart,
  buildPieChart,
  buildSinglePersonBarChart,
} from '../../lib/charts/builders';
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
  getStatusBadgeStyle,
  getResponsiveChartHeight,
} from './chartTheme';
import { useChartViewport } from './useChartViewport';
import { useDashboardChartPalette } from './useDashboardChartPalette';
import { StatusMetricGradientCard } from './actividades/ActividadesUi';
import { ResolutionTimeTrendChart } from './ResolutionTimeTrendChart';

const chartLabelColor = 'var(--chart-text)';
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
  hora_inicio_tarea?: string | null;
  fecha_fin_tarea?: string | null;
  encargado_proceso?: string | null;
  id_solicitud: number;
  asunto_solicitud: string;
  proceso_solicitud: string;
  categoria_solicitud: string;
}

function encargadoNames(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return ['Sin encargado'];
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : ['Sin encargado'];
}

function taskBelongsToEncargado(
  encargadoProceso: string | null | undefined,
  selectedEncargado: string
): boolean {
  return encargadoNames(encargadoProceso).includes(selectedEncargado);
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
  const { palette, statusSeries } = useDashboardChartPalette();
  return (
    <Paper
      p='sm'
      radius='md'
      w={fullWidth ? '100%' : undefined}
      style={{
        background: 'var(--chart-panel)',
        border: `1px solid ${palette.blue100}`,
      }}
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
  const { statusColors } = useDashboardChartPalette();
  const items = [
    { label: 'Completadas', value: completada, color: statusColors.completada },
    { label: 'Pendientes', value: pendiente, color: statusColors.pendiente },
    { label: 'En proceso', value: enProceso, color: statusColors.enProceso },
  ];

  return (
    <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='xs' mt='sm'>
      {items.map((item) => (
        <Box
          key={item.label}
          ta='center'
          p='xs'
          style={{
            background: 'var(--app-surface-raised)',
            borderRadius: 8,
            border: '1px solid var(--app-border-subtle)',
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
  const { palette, statusColors } = useDashboardChartPalette();
  const total = completada + pendiente + enProceso;
  if (total === 0) return null;

  const segments = [
    { value: completada, color: statusColors.completada },
    { value: enProceso, color: statusColors.enProceso },
    { value: pendiente, color: statusColors.pendiente },
  ].filter((s) => s.value > 0);

  return (
    <Box
      style={{
        display: 'flex',
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        background: palette.blue50,
      }}
    >
      {segments.map((seg) => (
        <Box
          key={seg.color}
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

function PersonCardsGrid({ people }: { people: AssigneeRow[] }) {
  const { palette } = useDashboardChartPalette();
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
            style={{ border: `1px solid ${palette.blue100}` }}
          >
            <Group wrap='nowrap' gap='sm' align='flex-start' mb='xs'>
              <ThemeIcon size={40} radius='md' variant='gradient' gradient={palette.gradient}>
                <Text size='xs' fw={700} c='white'>
                  {getInitials(person.asignado)}
                </Text>
              </ThemeIcon>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group justify='space-between' wrap='nowrap' gap='xs'>
                  <Text size='sm' fw={700} lineClamp={2} style={{ color: palette.primary }}>
                    {person.asignado}
                  </Text>
                  <Badge
                    variant='filled'
                    size='sm'
                    styles={{
                      root: {
                        backgroundColor: palette.primary,
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

function complianceBadgeStyles(isDark: boolean, palette: ReturnType<typeof useDashboardChartPalette>['palette']) {
  return {
    root: {
      backgroundColor: isDark ? 'rgba(91, 155, 255, 0.28)' : palette.blue50,
      color: isDark ? '#f0f4ff' : palette.primary,
      fontWeight: 700,
      border: isDark
        ? '1px solid rgba(91, 155, 255, 0.5)'
        : `1px solid ${palette.blue100}`,
    },
  };
}

function TeamSummaryTable({ people }: { people: AssigneeRow[] }) {
  const { palette, statusColors, isDark } = useDashboardChartPalette();
  const badgeStyles = complianceBadgeStyles(isDark, palette);
  return (
    <Box mt='lg'>
      <Text size='sm' fw={700} mb='sm' style={{ color: palette.primary }}>
        Resumen del equipo
      </Text>

      <Stack gap='sm' hiddenFrom='md'>
        {people.map((person) => (
          <Paper
            key={person.asignado}
            p='sm'
            radius='md'
            style={{
              background: palette.chartPanelBg,
              border: `1px solid ${palette.chartPanelBorder}`,
            }}
          >
            <Group justify='space-between' mb='xs' wrap='wrap' gap='xs'>
              <Text size='sm' fw={700} style={{ color: palette.primary }}>
                {person.asignado}
              </Text>
              <Badge variant='outline' size='sm' styles={badgeStyles}>
                {completionRate(person)}% cumpl.
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 2, xs: 4 }} spacing={6}>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Total
                </Text>
                <Text fw={700} style={{ color: chartLabelColor }}>
                  {person.total}
                </Text>
              </Box>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Compl.
                </Text>
                <Text fw={700} style={{ color: statusColors.completada }}>
                  {person.Completada}
                </Text>
              </Box>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Pend.
                </Text>
                <Text fw={700} style={{ color: statusColors.pendiente }}>
                  {person.Pendiente}
                </Text>
              </Box>
              <Box ta='center'>
                <Text size='xs' c='dimmed'>
                  Proc.
                </Text>
                <Text fw={700} style={{ color: statusColors.enProceso }}>
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
            thead: { backgroundColor: palette.blue100 },
            th: {
              color: chartLabelColor,
              fontWeight: 600,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            },
            td: { color: chartLabelColor },
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
                  <Text size='sm' fw={600} lineClamp={2} style={{ color: palette.primary }}>
                    {person.asignado}
                  </Text>
                </Table.Td>
                <Table.Td ta='center' fw={600} style={{ color: chartLabelColor }}>
                  {person.total}
                </Table.Td>
                <Table.Td ta='center' style={{ color: statusColors.completada }}>
                  {person.Completada}
                </Table.Td>
                <Table.Td ta='center' style={{ color: statusColors.pendiente }}>
                  {person.Pendiente}
                </Table.Td>
                <Table.Td ta='center' style={{ color: statusColors.enProceso }}>
                  {person['En Proceso']}
                </Table.Td>
                <Table.Td ta='right'>
                  <Badge variant='outline' size='sm' styles={badgeStyles}>
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

function TeamPerformanceCharts({
  people,
  tasks,
  encargadoName,
}: {
  people: AssigneeRow[];
  tasks: TaskWithEncargado[];
  encargadoName: string;
}) {
  const { palette } = useDashboardChartPalette();
  const { isCompact } = useChartViewport();
  const names = people.map((p) => p.asignado);
  const chartHeight = getResponsiveChartHeight(people.length, isCompact);
  const stackedChart = useMemo(() => buildHorizontalStackedBarChart(people), [people]);
  return (
    <Paper
      p={{ base: 'sm', sm: 'md', lg: 'lg' }}
      radius='md'
      mt='md'
      style={{ border: `1px solid ${palette.chartPanelBorder}` }}
    >
      <Stack gap='sm' mb='md'>
        <Box>
          <Text size='sm' fw={700} style={{ color: palette.primary }}>
            Panorama del equipo
          </Text>
          <Text size='xs' mt={2} style={{ color: chartLabelColor }}>
            Distribución de tareas y cumplimiento por colaborador
          </Text>
        </Box>
        <ChartStatusLegend fullWidth />
      </Stack>

      <ChartContainer
        type='bar'
        data={stackedChart.data}
        options={stackedChart.options}
        height={chartHeight}
        scrollable={people.length > 4}
      />

      <TeamSummaryTable people={people} />

      <ResolutionTimeTrendChart
        tasks={tasks}
        title='Tendencia de tiempos del equipo'
        subtitle={`Promedio de tiempo de trabajo · suma de ${people.length} colaboradores bajo ${encargadoName}`}
      />
    </Paper>
  );
}

function IndividualPerformanceView({
  people,
  tasks,
  selectedAsignado,
  onSelectAsignado,
}: {
  people: AssigneeRow[];
  tasks: TaskWithEncargado[];
  selectedAsignado: string | null;
  onSelectAsignado: (name: string) => void;
}) {
  const { palette, statusColors } = useDashboardChartPalette();
  const { isMobile, isCompact } = useChartViewport();
  const person = people.find((p) => p.asignado === selectedAsignado) ?? people[0];

  const pieSize = isMobile ? 160 : isCompact ? 180 : 220;
  const barChartHeight = isMobile ? 140 : isCompact ? 160 : 180;

  const pieSlices = useMemo(
    () =>
      person
        ? [
            { name: 'Completadas', value: person.Completada, color: statusColors.completada },
            { name: 'Pendientes', value: person.Pendiente, color: statusColors.pendiente },
            {
              name: 'En proceso',
              value: person['En Proceso'],
              color: statusColors.enProceso,
            },
          ].filter((d) => d.value > 0)
        : [],
    [person, statusColors]
  );

  const pieChart = useMemo(() => buildPieChart(pieSlices, { showLegend: false }), [pieSlices]);
  const personBarChart = useMemo(
    () => (person ? buildSinglePersonBarChart(person) : undefined),
    [person]
  );
  const pieChartHeight = pieSize + 24;

  if (!person || !personBarChart) return null;

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
        style={{ border: `1px solid ${palette.blue100}` }}
      >
        <Group wrap='wrap' gap='md' mb='lg' align='flex-start'>
          <ThemeIcon
            size={isMobile ? 44 : 52}
            radius='md'
            variant='gradient'
            gradient={palette.gradient}
          >
            <Text fw={700} c='white'>
              {getInitials(person.asignado)}
            </Text>
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 160 }}>
            <Text fw={700} size={isMobile ? 'md' : 'lg'} style={{ color: palette.primary }}>
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
            <Text size='sm' fw={700} mb={4} style={{ color: palette.primary }}>
              Estado de las tareas asignadas
            </Text>
            <Text size='xs' mb='sm' style={{ color: chartLabelColor }}>
              Completadas, pendientes y en proceso de esta persona
            </Text>
            {person.total > 0 && pieSlices.length > 0 ? (
              <Box w='100%' style={{ maxWidth: pieChartHeight, margin: '0 auto' }}>
                <ChartContainer
                  type='pie'
                  data={pieChart.data}
                  options={pieChart.options}
                  height={pieChartHeight}
                />
                <Group justify='center' gap='md' mt='xs' wrap='wrap'>
                  {pieSlices.map((slice) => (
                    <Group key={slice.name} gap={6}>
                      <Box
                        w={10}
                        h={10}
                        style={{
                          borderRadius: 2,
                          backgroundColor:
                            slice.name === 'Completadas'
                              ? statusColors.completada
                              : slice.name === 'Pendientes'
                                ? statusColors.pendiente
                                : statusColors.enProceso,
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
            <Text size='sm' fw={700} mb='xs' style={{ color: palette.primary }}>
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
                  section: { backgroundColor: statusColors.completada },
                }}
              />
              <Text size='xs' ta='center' mt={4} fw={700} style={{ color: statusColors.completada }}>
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

        <Box mt='lg'>
          <Text size='sm' fw={700} mb='sm' style={{ color: palette.primary }}>
            Barras de estado individual
          </Text>
          <Text size='xs' mb='sm' style={{ color: chartLabelColor }}>
            Composición por estado de {person.asignado}
          </Text>
          <ChartContainer
            type='bar'
            data={personBarChart.data}
            options={personBarChart.options}
            height={barChartHeight}
            scrollable={false}
          />
        </Box>
      </Paper>

      <ResolutionTimeTrendChart
        tasks={tasks}
        assigneeFilter={person.asignado}
        title={`Tendencia de tiempos · ${person.asignado}`}
        subtitle='Desde que empieza a trabajarla hasta que la finaliza · solo tareas con ambas fechas'
      />
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
  const { palette } = useDashboardChartPalette();
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
            style={{ border: `1px solid ${palette.blue100}` }}
          >
            <Group justify='space-between' align='flex-start' wrap='nowrap' gap='xs' mb={6}>
              <Text size='sm' fw={600} lineClamp={1} style={{ color: palette.primary, flex: 1 }}>
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
                    <Text span fw={600} c={palette.primary}>
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
  const { palette, statusColors, barPalette, barPaletteMantine } =
    useDashboardChartPalette();
  const [selectedEncargado, setSelectedEncargado] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [taskPage, setTaskPage] = useState(1);
  const [personViewMode, setPersonViewMode] = useState<PersonViewMode>('team');
  const [selectedAsignado, setSelectedAsignado] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAsignado(null);
    setPersonViewMode('team');
    setTaskPage(1);
  }, [selectedEncargado]);

  const encargadoChartData = useMemo(() => {
    const counts = tasks.reduce(
      (acc, task) => {
        for (const key of encargadoNames(task.encargado_proceso)) {
          acc[key] = (acc[key] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    const max = Math.max(...Object.values(counts), 1);

    return Object.entries(counts)
      .map(([encargado, tareas], index) => {
        const paletteIndex = index % barPalette.length;
        return {
          encargado,
          tareas,
          color: barPaletteMantine[paletteIndex % barPaletteMantine.length],
          barHex: barPalette[paletteIndex],
          pct: Math.round((tareas / max) * 100),
        };
      })
      .sort((a, b) => b.tareas - a.tareas);
  }, [tasks, barPalette, barPaletteMantine]);

  const { isMobile, isCompact } = useChartViewport();

  const overviewChartHeight = useMemo(
    () => getResponsiveChartHeight(encargadoChartData.length, isCompact),
    [encargadoChartData.length, isCompact]
  );

  const overviewBarChart = useMemo(
    () =>
      buildHorizontalMultiColorBarChart(
        encargadoChartData.map((d) => ({
          label: d.encargado,
          value: d.tareas,
          color: d.barHex,
        })),
        isMobile
      ),
    [encargadoChartData, isMobile]
  );

  const assigneeChartData = useMemo(() => {
    if (!selectedEncargado) return [];

    const filtered = tasks.filter((t) =>
      taskBelongsToEncargado(t.encargado_proceso, selectedEncargado)
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
      .filter((t) => taskBelongsToEncargado(t.encargado_proceso, selectedEncargado))
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
      <Paper p='xl' radius='md' style={{ background: palette.chartSurface }}>
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
          <Text size='sm' fw={600} style={{ color: palette.primary }}>
            Actividades por encargado de área
          </Text>
          <Text size='xs' fw={500} style={{ color: chartLabelColor }}>
            Periodo {periodLabel} · {totalTasks} actividades en total
          </Text>
        </Box>
        {!selectedEncargado && (
          <Badge
            variant='light'
            size='lg'
            styles={{
              root: {
                backgroundColor: palette.blue50,
                color: palette.primary,
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
            style={{
              background: palette.chartSurface,
              border: `1px solid ${palette.borderAccent}`,
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
                  gradient={palette.gradient}
                >
                  <Text fw={700} size='sm' c='white'>
                    {getInitials(selectedEncargado)}
                  </Text>
                </ThemeIcon>
                <Box>
                  <Text fw={600} size='md' style={{ color: palette.primary }}>
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
                gradient={palette.gradient}
                size='lg'
              >
                Periodo {periodLabel}
              </Badge>
            </Group>

            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='sm' mb='lg'>
              <StatusMetricGradientCard
                label='Completadas'
                value={detailStatusSummary.Completada}
                icon={IconCheck}
                kind='completada'
                accentColor={statusColors.completada}
              />
              <StatusMetricGradientCard
                label='Pendientes'
                value={detailStatusSummary.Pendiente}
                icon={IconClock}
                kind='pendiente'
                accentColor={statusColors.pendiente}
              />
              <StatusMetricGradientCard
                label='En proceso'
                value={detailStatusSummary['En Proceso']}
                icon={IconProgress}
                kind='enProceso'
                accentColor={statusColors.enProceso}
              />
            </SimpleGrid>

            <Stack gap='sm' mb='xs'>
              <Box>
                <Text size='sm' fw={700} style={{ color: palette.primary }}>
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
                {personViewMode === 'team' && (
                  <TeamPerformanceCharts
                    people={assigneeChartData}
                    tasks={detailRows}
                    encargadoName={selectedEncargado}
                  />
                )}
                {personViewMode === 'individual' && (
                  <IndividualPerformanceView
                    people={assigneeChartData}
                    tasks={detailRows}
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
              p='md'
              radius='md'
              style={{
                background: tableOpen ? palette.blue50 : palette.chartPanelBg,
                border: `1px solid ${tableOpen ? palette.borderAccentStrong : palette.chartPanelBorder}`,
              }}
            >
              <Group justify='space-between'>
                <Group gap='xs'>
                  <ThemeIcon
                    size='sm'
                    variant='gradient'
                    gradient={palette.gradient}
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
                        backgroundColor: palette.blue100,
                        color: palette.blue800,
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
              radius='md'
              p={{ base: 'sm', sm: 'md' }}
              style={{ border: `1px solid ${palette.blue100}` }}
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
            style={{
              background: palette.chartPanelBg,
              border: `1px solid ${palette.chartPanelBorder}`,
            }}
          >
            <Text size='xs' fw={600} mb='sm' style={{ color: chartLabelColor }}>
              Actividades por encargado — haga clic en una fila para ver el detalle del equipo
            </Text>
            <ChartContainer
              type='bar'
              data={overviewBarChart.data}
              options={overviewBarChart.options}
              height={overviewChartHeight}
            />
          </Paper>

          <Text size='sm' fw={600} style={{ color: palette.primary }}>
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
                    p={0}
                    radius='md'
                    style={{
                      overflow: 'hidden',
                      background: palette.chartPanelBg,
                      border: `1px solid ${palette.chartPanelBorder}`,
                      transition: 'box-shadow 0.15s ease, transform 0.15s ease',
                    }}
                    styles={{
                      root: {
                        '&:hover': {
                          boxShadow: `0 4px 14px ${palette.blue800}22`,
                          transform: 'translateY(-1px)',
                          borderColor: palette.borderAccent,
                          backgroundColor: palette.blue50,
                        },
                      },
                    }}
                  >
                    <Group wrap='nowrap' gap={0} align='stretch'>
                      <Box
                        w={4}
                        style={{ flexShrink: 0, backgroundColor: item.barHex }}
                        aria-hidden
                      />
                      <Box p='md' style={{ flex: 1, minWidth: 0 }}>
                    <Group wrap='nowrap' gap='sm' align='flex-start'>
                      <ThemeIcon size={36} radius='md' color={item.color}>
                        <Text size='xs' fw={700} c='white'>
                          {getInitials(item.encargado)}
                        </Text>
                      </ThemeIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size='sm' fw={700} lineClamp={2} style={{ color: palette.primary }}>
                          {item.encargado}
                        </Text>
                        <Group gap='xs' mt={4}>
                          <IconUser size={12} color={palette.blue700} />
                          <Text size='xs' fw={500} style={{ color: chartLabelColor }}>
                            {item.tareas} {item.tareas === 1 ? 'actividad' : 'actividades'}
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
                            root: { backgroundColor: palette.blue100 },
                            section: { backgroundColor: item.barHex },
                          }}
                        />
                      </Box>
                      <IconChevronRight size={16} color={palette.blue700} />
                    </Group>
                      </Box>
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
