'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Collapse,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Badge,
  Pagination,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { ChartContainer } from './ChartContainer';
import { buildHorizontalMultiColorBarChart } from '../../lib/charts/builders';
import {
  IconChevronLeft,
  IconChevronDown,
  IconChevronRight,
  IconUser,
  IconCheck,
  IconClock,
  IconProgress,
  IconList,
} from '@tabler/icons-react';
import { getStatusBadgeStyle, resolveScrollableBarChartLayout } from './chartTheme';
import { useChartViewport } from './useChartViewport';
import { useDashboardChartPalette } from './useDashboardChartPalette';
import { StatusMetricGradientCard } from './actividades/ActividadesUi';
import { ResolutionTimeTrendChart } from './ResolutionTimeTrendChart';
import {
  buildLeaderSummaries,
  completionRate,
  normalizeAsignado,
  taskBelongsToEncargado,
  taskDevelopmentLabel,
  type LeaderActivitySummary,
  type TaskWithEncargado,
} from '../../lib/dashboard/leaderActivityMetrics';

const chartLabelColor = 'var(--chart-text)';
const TASKS_PER_PAGE = 10;

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function CollaboratorsTooltip({
  collaborators,
  children,
}: {
  collaborators: string[];
  children: ReactNode;
}) {
  if (collaborators.length === 0) {
    return <>{children}</>;
  }
  return (
    <Tooltip
      multiline
      w={280}
      withArrow
      position='top-start'
      label={
        <Stack gap={4}>
          <Text size='xs' fw={700}>
            Personas que trabajaron en estas actividades
          </Text>
          {collaborators.map((name) => (
            <Text key={name} size='xs'>
              · {name}
            </Text>
          ))}
        </Stack>
      }
    >
      {children}
    </Tooltip>
  );
}

function complianceBadgeStyles(
  isDark: boolean,
  palette: ReturnType<typeof useDashboardChartPalette>['palette']
) {
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

function LeadersSummaryTable({ leaders }: { leaders: LeaderActivitySummary[] }) {
  const { palette, statusColors, isDark } = useDashboardChartPalette();
  const badgeStyles = complianceBadgeStyles(isDark, palette);

  return (
    <Box mt='lg'>
      <Text size='sm' fw={700} mb='sm' style={{ color: palette.primary }}>
        Resumen por líder de área
      </Text>
      <Text size='xs' c='dimmed' mb='sm'>
        Pase el cursor sobre un líder para ver quiénes trabajaron en sus actividades
      </Text>

      <Stack gap='sm' hiddenFrom='md'>
        {leaders.map((leader) => (
          <CollaboratorsTooltip key={leader.encargado} collaborators={leader.collaborators}>
            <Paper
              p='sm'
              radius='md'
              style={{
                background: palette.chartPanelBg,
                border: `1px solid ${palette.chartPanelBorder}`,
                cursor: 'default',
              }}
            >
              <Group justify='space-between' mb='xs' wrap='wrap' gap='xs'>
                <Text size='sm' fw={700} style={{ color: palette.primary }}>
                  {leader.encargado}
                </Text>
                <Badge variant='outline' size='sm' styles={badgeStyles}>
                  {completionRate(leader)}% cumpl.
                </Badge>
              </Group>
              <SimpleGrid cols={{ base: 2, xs: 4 }} spacing={6}>
                <Box ta='center'>
                  <Text size='xs' c='dimmed'>Total</Text>
                  <Text fw={700}>{leader.total}</Text>
                </Box>
                <Box ta='center'>
                  <Text size='xs' c='dimmed'>Compl.</Text>
                  <Text fw={700} style={{ color: statusColors.completada }}>{leader.Completada}</Text>
                </Box>
                <Box ta='center'>
                  <Text size='xs' c='dimmed'>Pend.</Text>
                  <Text fw={700} style={{ color: statusColors.pendiente }}>{leader.Pendiente}</Text>
                </Box>
                <Box ta='center'>
                  <Text size='xs' c='dimmed'>Proc.</Text>
                  <Text fw={700} style={{ color: statusColors.enProceso }}>{leader['En Proceso']}</Text>
                </Box>
              </SimpleGrid>
            </Paper>
          </CollaboratorsTooltip>
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
              <Table.Th>Líder de área</Table.Th>
              <Table.Th ta='center'>Total</Table.Th>
              <Table.Th ta='center'>Compl.</Table.Th>
              <Table.Th ta='center'>Pend.</Table.Th>
              <Table.Th ta='center'>En proc.</Table.Th>
              <Table.Th ta='right'>Cumplimiento</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {leaders.map((leader) => (
              <Table.Tr key={leader.encargado}>
                <Table.Td>
                  <CollaboratorsTooltip collaborators={leader.collaborators}>
                    <Box style={{ cursor: 'default' }}>
                      <Text size='sm' fw={600} lineClamp={2} style={{ color: palette.primary }}>
                        {leader.encargado}
                      </Text>
                      {leader.collaborators.length > 0 && (
                        <Text size='xs' c='dimmed' lineClamp={1}>
                          {leader.collaborators.length}{' '}
                          {leader.collaborators.length === 1 ? 'colaborador' : 'colaboradores'}
                        </Text>
                      )}
                    </Box>
                  </CollaboratorsTooltip>
                </Table.Td>
                <Table.Td ta='center' fw={600}>{leader.total}</Table.Td>
                <Table.Td ta='center' style={{ color: statusColors.completada }}>{leader.Completada}</Table.Td>
                <Table.Td ta='center' style={{ color: statusColors.pendiente }}>{leader.Pendiente}</Table.Td>
                <Table.Td ta='center' style={{ color: statusColors.enProceso }}>{leader['En Proceso']}</Table.Td>
                <Table.Td ta='right'>
                  <Badge variant='outline' size='sm' styles={badgeStyles}>
                    {completionRate(leader)}%
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

function ActivityDetailTable({
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
      <Stack gap='sm' hiddenFrom='sm'>
        {pageRows.map((row) => {
          const duration = taskDevelopmentLabel(row);
          return (
            <Tooltip
              key={row.id_tarea}
              multiline
              w={300}
              withArrow
              label={
                <Stack gap={4}>
                  <Text size='xs' fw={700}>Detalle de la actividad</Text>
                  <Text size='xs'>Trabajó: {normalizeAsignado(row.asignado_tarea)}</Text>
                  {duration ? <Text size='xs'>Tiempo de desarrollo: {duration}</Text> : null}
                  {row.hora_inicio_tarea ? (
                    <Text size='xs'>Inicio: {row.hora_inicio_tarea}</Text>
                  ) : null}
                  {(row.fecha_fin_tarea || row.fecha_resolucion_tarea) ? (
                    <Text size='xs'>
                      Cierre: {row.fecha_fin_tarea || row.fecha_resolucion_tarea}
                    </Text>
                  ) : null}
                </Stack>
              }
            >
              <Paper p='sm' radius='md' style={{ border: `1px solid ${palette.blue100}`, cursor: 'default' }}>
                <Group justify='space-between' align='flex-start' wrap='nowrap' gap='xs' mb={6}>
                  <Text size='sm' fw={600} lineClamp={1} style={{ color: palette.primary, flex: 1 }}>
                    {row.tarea}
                  </Text>
                  <Badge size='sm' {...getStatusBadgeStyle(row.estado_tarea)} style={{ flexShrink: 0 }}>
                    {row.estado_tarea}
                  </Badge>
                </Group>
                <Text size='xs' c='dimmed'>
                  {normalizeAsignado(row.asignado_tarea)}
                  {duration ? ` · ${duration}` : ''}
                </Text>
                <Text size='xs' c='dimmed' lineClamp={2} mt={4}>
                  #{row.id_solicitud} · {row.asunto_solicitud}
                </Text>
              </Paper>
            </Tooltip>
          );
        })}
      </Stack>

      <Table.ScrollContainer minWidth={640} type='native' visibleFrom='sm'>
        <Table striped highlightOnHover fz='sm' layout='fixed'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w='32%'>Actividad</Table.Th>
              <Table.Th w={110}>Estado</Table.Th>
              <Table.Th w={100}>Tiempo</Table.Th>
              <Table.Th>Solicitud</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pageRows.map((row) => {
              const duration = taskDevelopmentLabel(row);
              return (
                <Table.Tr key={row.id_tarea}>
                  <Table.Td>
                    <Tooltip
                      multiline
                      w={280}
                      withArrow
                      label={
                        <Stack gap={4}>
                          <Text size='xs' fw={700}>{row.tarea}</Text>
                          <Text size='xs'>Trabajó: {normalizeAsignado(row.asignado_tarea)}</Text>
                          {duration ? <Text size='xs'>Desarrollo: {duration}</Text> : null}
                        </Stack>
                      }
                    >
                      <Text size='sm' fw={500} lineClamp={2} style={{ cursor: 'default' }}>
                        {row.tarea}
                      </Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>
                    <Badge size='sm' {...getStatusBadgeStyle(row.estado_tarea)}>
                      {row.estado_tarea}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs' fw={600} style={{ color: duration ? palette.primary : undefined }}>
                      {duration ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='xs' lineClamp={2}>
                      <Text span fw={600} c={palette.primary}>#{row.id_solicitud}</Text>{' '}
                      {row.asunto_solicitud}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {rows.length > 0 && (
        <Stack gap='sm' mt='md' align='stretch'>
          <Text size='xs' ta={{ base: 'center', sm: 'left' }} style={{ color: chartLabelColor }}>
            Mostrando {rangeFrom}–{rangeTo} de {rows.length} actividades
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
  teamTasks?: TaskWithEncargado[];
  categoryMembers?: Record<string, string[]>;
  periodLabel: string;
}

export default function EncargadoActivitiesChart({
  tasks,
  teamTasks,
  periodLabel,
}: EncargadoActivitiesChartProps) {
  const { palette, statusColors, barPalette, barPaletteMantine } = useDashboardChartPalette();
  const [selectedEncargado, setSelectedEncargado] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(true);
  const [taskPage, setTaskPage] = useState(1);

  const teamSourceTasks = teamTasks && teamTasks.length > 0 ? teamTasks : tasks;

  const leaderSummaries = useMemo(() => buildLeaderSummaries(tasks), [tasks]);

  const encargadoChartData = useMemo(() => {
    const max = Math.max(...leaderSummaries.map((l) => l.total), 1);
    return leaderSummaries.map((leader, index) => {
      const paletteIndex = index % barPalette.length;
      return {
        encargado: leader.encargado,
        tareas: leader.total,
        collaborators: leader.collaborators,
        color: barPaletteMantine[paletteIndex % barPaletteMantine.length],
        barHex: barPalette[paletteIndex],
        pct: Math.round((leader.total / max) * 100),
      };
    });
  }, [leaderSummaries, barPalette, barPaletteMantine]);

  const selectedLeader = useMemo(
    () => leaderSummaries.find((l) => l.encargado === selectedEncargado) ?? null,
    [leaderSummaries, selectedEncargado]
  );

  const detailRows = useMemo(() => {
    if (!selectedEncargado) return [];
    return teamSourceTasks
      .filter((t) => taskBelongsToEncargado(t.encargado_proceso, selectedEncargado))
      .sort((a, b) => {
        const ta = a.tarea || '';
        const tb = b.tarea || '';
        return ta.localeCompare(tb, 'es') || (a.id_tarea ?? 0) - (b.id_tarea ?? 0);
      });
  }, [teamSourceTasks, selectedEncargado]);

  const activeLeader = useMemo((): LeaderActivitySummary | null => {
    if (!selectedEncargado) return null;
    if (selectedLeader) return selectedLeader;

    const counts = { Completada: 0, Pendiente: 0, 'En Proceso': 0 };
    for (const task of detailRows) {
      const status = task.estado_tarea || 'Pendiente';
      if (status in counts) {
        counts[status as keyof typeof counts] += 1;
      } else {
        counts.Pendiente += 1;
      }
    }
    const collaborators = [
      ...new Set(detailRows.map((t) => normalizeAsignado(t.asignado_tarea))),
    ].sort((a, b) => a.localeCompare(b, 'es'));

    return {
      encargado: selectedEncargado,
      ...counts,
      total: detailRows.length,
      collaborators,
      tasks: detailRows,
    };
  }, [selectedEncargado, selectedLeader, detailRows]);

  useEffect(() => {
    setTaskPage(1);
    setTableOpen(true);
  }, [selectedEncargado, detailRows.length]);

  const { isMobile, isCompact } = useChartViewport();
  const overviewChartLayout = useMemo(
    () => resolveScrollableBarChartLayout(encargadoChartData.length, isCompact),
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

  const overviewBarChartOptions = useMemo(() => {
    const base = overviewBarChart.options;
    return {
      ...base,
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins?.tooltip,
          callbacks: {
            ...base.plugins?.tooltip?.callbacks,
            afterBody: (items: { dataIndex?: number }[]) => {
              const idx = items[0]?.dataIndex ?? 0;
              const collabs = encargadoChartData[idx]?.collaborators ?? [];
              if (collabs.length === 0) {
                return ['', 'Sin colaboradores en actividades de este líder'];
              }
              return ['', 'Colaboradores:', ...collabs.map((name) => `· ${name}`)];
            },
          },
        },
      },
    };
  }, [overviewBarChart.options, encargadoChartData]);

  const leaderSelectOptions = useMemo(
    () =>
      encargadoChartData.map((item) => ({
        value: item.encargado,
        label: `${item.encargado} (${item.tareas} act.)`,
      })),
    [encargadoChartData]
  );

  if (tasks.length === 0 && !selectedEncargado) {
    return (
      <Paper p='xl' radius='md' style={{ background: palette.chartSurface }}>
        <Stack align='center' gap='sm'>
          <ThemeIcon size={48} radius='xl' variant='light' color='blue'>
            <IconUser size={24} />
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
            Rendimiento por líder de área
          </Text>
          <Text size='xs' fw={500} style={{ color: chartLabelColor }}>
            Periodo {periodLabel} · {tasks.length} actividades · solo líderes (colaboradores al pasar el cursor)
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
            {leaderSummaries.length} {leaderSummaries.length === 1 ? 'líder' : 'líderes'}
          </Badge>
        )}
      </Group>

      {selectedEncargado && activeLeader ? (
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
                  Líderes
                </Button>
                <ThemeIcon size={44} radius='md' variant='gradient' gradient={palette.gradient}>
                  <Text fw={700} size='sm' c='white'>
                    {getInitials(selectedEncargado)}
                  </Text>
                </ThemeIcon>
                <Box>
                  <Text fw={600} size='md' style={{ color: palette.primary }}>
                    {selectedEncargado}
                  </Text>
                  <CollaboratorsTooltip collaborators={activeLeader.collaborators}>
                    <Text size='xs' c='dimmed' style={{ cursor: 'default' }}>
                      {detailRows.length} actividades · {activeLeader.collaborators.length}{' '}
                      {activeLeader.collaborators.length === 1 ? 'persona' : 'personas'} en el equipo
                    </Text>
                  </CollaboratorsTooltip>
                </Box>
              </Group>
              <Badge variant='gradient' gradient={palette.gradient} size='lg'>
                {completionRate(activeLeader)}% cumplimiento
              </Badge>
            </Group>

            {detailRows.length === 0 && (
              <Paper p='md' radius='md' mb='lg' withBorder bg='gray.0'>
                <Text size='sm' c='dimmed' ta='center'>
                  Este líder no tiene actividades en el periodo ({periodLabel}). Cambie las fechas o
                  vuelva a la lista de líderes.
                </Text>
              </Paper>
            )}

            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='sm' mb='lg'>
              <StatusMetricGradientCard
                label='Completadas'
                value={activeLeader.Completada}
                icon={IconCheck}
                kind='completada'
                accentColor={statusColors.completada}
              />
              <StatusMetricGradientCard
                label='Pendientes'
                value={activeLeader.Pendiente}
                icon={IconClock}
                kind='pendiente'
                accentColor={statusColors.pendiente}
              />
              <StatusMetricGradientCard
                label='En proceso'
                value={activeLeader['En Proceso']}
                icon={IconProgress}
                kind='enProceso'
                accentColor={statusColors.enProceso}
              />
            </SimpleGrid>

            <ResolutionTimeTrendChart
              tasks={detailRows}
              title={`Tendencia de tiempos · ${selectedEncargado}`}
              subtitle='Promedio de tiempo de desarrollo por actividad cerrada bajo este líder (min, h o días según el caso)'
              variant='inline'
            />
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
                  <ThemeIcon size='sm' variant='gradient' gradient={palette.gradient}>
                    <IconList size={14} />
                  </ThemeIcon>
                  <Text size='sm' fw={600}>
                    Actividades del líder
                  </Text>
                  <Badge variant='light' size='sm' styles={{ root: { backgroundColor: palette.blue100, color: palette.blue800 } }}>
                    {detailRows.length}
                  </Badge>
                </Group>
                {tableOpen ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              </Group>
            </Paper>
          </UnstyledButton>

          <Collapse in={tableOpen}>
            <Paper radius='md' p={{ base: 'sm', sm: 'md' }} style={{ border: `1px solid ${palette.blue100}` }}>
              <Text size='xs' c='dimmed' mb='sm'>
                Pase el cursor sobre una actividad para ver quién la trabajó y su tiempo de desarrollo
              </Text>
              <ActivityDetailTable rows={detailRows} page={taskPage} onPageChange={setTaskPage} />
            </Paper>
          </Collapse>
        </Stack>
      ) : (
        <>
          <Paper
            p={{ base: 'sm', sm: 'md', lg: 'lg' }}
            radius='lg'
            style={{
              background: palette.chartSurface,
              border: `1px solid ${palette.borderAccent}`,
            }}
          >
            <Text size='sm' fw={700} mb={4} style={{ color: palette.primary }}>
              Seleccionar líder de área
            </Text>
            <Text size='xs' c='dimmed' mb='md'>
              Elija un líder para ver sus actividades, tiempos y colaboradores del equipo
            </Text>

            <Select
              label='Ir directo a un líder'
              placeholder='Busque o elija un líder…'
              data={leaderSelectOptions}
              searchable
              clearable
              nothingFoundMessage='Sin coincidencias'
              mb='md'
              onChange={(value) => {
                if (value) setSelectedEncargado(value);
              }}
              styles={{
                label: { fontWeight: 600, fontSize: 12, color: chartLabelColor },
              }}
            />

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
              {encargadoChartData.map((item) => (
                <CollaboratorsTooltip key={item.encargado} collaborators={item.collaborators}>
                  <Paper
                    p={0}
                    radius='md'
                    style={{
                      overflow: 'hidden',
                      background: palette.chartPanelBg,
                      border: `1px solid ${palette.chartPanelBorder}`,
                      cursor: 'default',
                    }}
                  >
                    <Group wrap='nowrap' gap={0} align='stretch'>
                      <Box w={4} style={{ flexShrink: 0, backgroundColor: item.barHex }} aria-hidden />
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
                            <Text size='xs' fw={500} mt={4} style={{ color: chartLabelColor }}>
                              {item.tareas} {item.tareas === 1 ? 'actividad' : 'actividades'}
                              {item.collaborators.length > 0
                                ? ` · ${item.collaborators.length} en equipo`
                                : ''}
                            </Text>
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
                            <Button
                              variant='light'
                              color='blue'
                              size='compact-sm'
                              mt='sm'
                              onClick={() => setSelectedEncargado(item.encargado)}
                            >
                              Ver actividades
                            </Button>
                          </Box>
                        </Group>
                      </Box>
                    </Group>
                  </Paper>
                </CollaboratorsTooltip>
              ))}
            </SimpleGrid>
          </Paper>

          <Paper
            p={{ base: 'sm', sm: 'md', lg: 'lg' }}
            radius='lg'
            style={{
              background: palette.chartPanelBg,
              border: `1px solid ${palette.chartPanelBorder}`,
            }}
          >
            <Text size='sm' fw={700} mb={4} style={{ color: palette.primary }}>
              Carga de actividades por líder
            </Text>
            <Text size='xs' c='dimmed' mb='sm'>
              Pase el cursor sobre una barra para ver los colaboradores que trabajaron en esas actividades
            </Text>
            <ChartContainer
              type='bar'
              data={overviewBarChart.data}
              options={overviewBarChartOptions}
              height={overviewChartLayout.height}
              maxHeight={overviewChartLayout.maxHeight}
              scrollable={overviewChartLayout.scrollHorizontal}
            />
          </Paper>

          <LeadersSummaryTable leaders={leaderSummaries} />
        </>
      )}
    </Stack>
  );
}
