'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Collapse,
  Group,
  Paper,
  SimpleGrid,
  Text,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import {
  IconTrendingDown,
  IconTrendingUp,
  IconMinus,
  IconClockHour4,
  IconChartLine,
  IconChecklist,
  IconChevronDown,
  IconChevronRight,
} from '@tabler/icons-react';
import { ChartContainer } from './ChartContainer';
import { useChartViewport } from './useChartViewport';
import {
  buildResolutionTimeSeries,
  formatResolutionDuration,
  toChartRows,
  type ResolutionTrend,
  type TaskForResolutionTime,
} from '../../lib/dashboard/resolutionTimeSeries';
import { dashboardChartTheme } from './chartTheme';
import { buildTrendTimeChart } from '../../lib/charts/builders';
import { chartLabelColor, trendDownColor, trendUpColor, trendFlatColor } from '../../lib/charts/defaults';

const chartScrollStyle = {
  overflowX: 'auto' as const,
  WebkitOverflowScrolling: 'touch' as const,
  width: '100%',
};

/** Ancho mínimo del gráfico lineal para permitir scroll horizontal en móvil/tablet */
function getTrendChartScrollMinWidth(
  pointCount: number,
  isMobile: boolean,
  isCompact: boolean
): number {
  if (!isCompact) {
    return pointCount > 8 ? pointCount * 56 + 120 : 0;
  }
  if (pointCount <= 1) return isMobile ? 300 : 360;
  const perPoint = isMobile ? 92 : 72;
  const padding = isMobile ? 128 : 148;
  return Math.max(pointCount * perPoint + padding, isMobile ? 320 : 400);
}

function TrendBadge({
  trend,
  changePct,
  size = 'md',
}: {
  trend: ResolutionTrend | null;
  changePct: number | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (trend == null || changePct == null) {
    return (
      <Group gap={4} wrap='nowrap'>
        <IconMinus size={size === 'sm' ? 12 : 14} color={trendFlatColor} />
        <Text size={size === 'lg' ? 'sm' : 'xs'} fw={700} style={{ color: trendFlatColor }}>
          Inicio
        </Text>
      </Group>
    );
  }

  const color = trend === 'up' ? trendUpColor : trend === 'down' ? trendDownColor : trendFlatColor;
  const Icon = trend === 'up' ? IconTrendingUp : trend === 'down' ? IconTrendingDown : IconMinus;
  const sign = changePct > 0 ? '+' : '';

  return (
    <Group gap={4} wrap='nowrap'>
      <Icon size={size === 'lg' ? 20 : size === 'md' ? 16 : 14} color={color} stroke={2.5} />
      <Text size={size === 'lg' ? 'lg' : size === 'md' ? 'sm' : 'xs'} fw={800} style={{ color }}>
        {sign}
        {Math.abs(changePct).toFixed(1)}%
      </Text>
    </Group>
  );
}

function TrendPointDetail({ row }: { row: ReturnType<typeof toChartRows>[number] }) {
  return (
    <Paper
      shadow='lg'
      p='sm'
      radius='md'
      withBorder
      mt='sm'
      style={{
        borderColor: dashboardChartTheme.blue100,
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      }}
    >
      <Text size='xs' fw={700} mb={6} style={{ color: dashboardChartTheme.primary }}>
        {row.period}
      </Text>
      <Group justify='space-between' gap='md' mb={4}>
        <Text size='xs' style={{ color: chartLabelColor }}>
          Tiempo promedio
        </Text>
        <Text size='sm' fw={800} style={{ color: dashboardChartTheme.primary }}>
          {formatResolutionDuration(row.tiempo ?? 0)}
        </Text>
      </Group>
      <Group justify='space-between' gap='md' mb={row.changePct != null ? 6 : 0}>
        <Text size='xs' style={{ color: chartLabelColor }}>
          Tareas finalizadas
        </Text>
        <Text size='xs' fw={700}>
          {row.tareas ?? 0}
        </Text>
      </Group>
      {row.changePct != null && (
        <Box pt={6} style={{ borderTop: '1px solid #e2e8f0' }}>
          <Group justify='space-between'>
            <Text size='xs' style={{ color: chartLabelColor }}>
              vs periodo anterior
            </Text>
            <TrendBadge trend={row.trend ?? null} changePct={row.changePct} size='sm' />
          </Group>
        </Box>
      )}
    </Paper>
  );
}

export interface ResolutionTimeTrendChartProps {
  tasks: TaskForResolutionTime[];
  /** Si se define, solo tareas de esa persona */
  assigneeFilter?: string | null;
  title: string;
  subtitle?: string;
}

function TrendChartBody({
  title,
  subtitle,
  summary,
  trendPoints,
  chartHeight,
  isMobile,
  isCompact,
}: {
  title: string;
  subtitle: string;
  summary: ReturnType<typeof buildResolutionTimeSeries>;
  trendPoints: ReturnType<typeof toChartRows>;
  chartHeight: number;
  isMobile: boolean;
  isCompact: boolean;
}) {
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  useEffect(() => {
    setPinnedIndex(null);
  }, [trendPoints]);

  const maxTiempo = Math.max(...trendPoints.map((d) => d.tiempo), 0.05);
  const yMax = maxTiempo < 1 ? Math.max(maxTiempo * 1.4, 0.08) : maxTiempo * 1.2;
  const { data: chartData, options: chartOptions } = buildTrendTimeChart(
    trendPoints,
    yMax,
    isMobile
  );

  const mergedOptions = useMemo(
    () => ({
      ...chartOptions,
      plugins: {
        ...chartOptions.plugins,
        tooltip: {
          ...chartOptions.plugins?.tooltip,
          enabled: !isMobile,
        },
      },
    }),
    [chartOptions, isMobile]
  );
  if (summary.completedTasks === 0) {
    return (
      <Text size='sm' c='dimmed' ta='center' py='lg'>
        No hay tareas con fecha de inicio y de finalización en este periodo.
      </Text>
    );
  }

  return (
    <>
      <Group justify='space-between' align='flex-start' wrap='wrap' gap='sm' mb='md'>
        <Group gap='sm' align='flex-start' style={{ flex: 1, minWidth: 200 }}>
          <ThemeIcon
            size={isMobile ? 40 : 48}
            radius='md'
            variant='gradient'
            gradient={dashboardChartTheme.gradient}
          >
            <IconChartLine size={isMobile ? 20 : 24} />
          </ThemeIcon>
          <Box>
            <Text size={isMobile ? 'sm' : 'md'} fw={700} style={{ color: dashboardChartTheme.primary }}>
              {title}
            </Text>
            <Text size='xs' mt={2} style={{ color: chartLabelColor }}>
              {subtitle}
            </Text>
          </Box>
        </Group>
        <Paper
          px='md'
          py='xs'
          radius='md'
          withBorder
          style={{
            borderColor:
              summary.latestTrend === 'up'
                ? 'rgba(22, 163, 74, 0.35)'
                : summary.latestTrend === 'down'
                  ? 'rgba(220, 38, 38, 0.35)'
                  : dashboardChartTheme.blue100,
            background: '#fff',
          }}
        >
          <Text size='xs' fw={600} ta='center' style={{ color: chartLabelColor }}>
            Último periodo
          </Text>
          <Group gap='xs' justify='center' mt={4}>
            <Text fw={800} size='lg' style={{ color: dashboardChartTheme.primary }}>
              {formatResolutionDuration(summary.latestAvgHours ?? 0)}
            </Text>
            <TrendBadge
              trend={summary.latestTrend}
              changePct={summary.latestChangePct}
              size='md'
            />
          </Group>
        </Paper>
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='sm' mb='md'>
        <Paper p='sm' radius='md' withBorder bg='white' style={{ borderColor: '#e2e8f0' }}>
          <Group gap={6} mb={4}>
            <IconClockHour4 size={14} color={dashboardChartTheme.primary} />
            <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
              Promedio general
            </Text>
          </Group>
          <Text fw={800} size='xl' style={{ color: dashboardChartTheme.primary }}>
            {formatResolutionDuration(summary.overallAvgHours ?? 0)}
          </Text>
        </Paper>
        <Paper p='sm' radius='md' withBorder bg='white' style={{ borderColor: '#e2e8f0' }}>
          <Group gap={6} mb={4}>
            <IconChecklist size={14} color={dashboardChartTheme.primary} />
            <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
              Tareas medidas
            </Text>
          </Group>
          <Text fw={800} size='xl' style={{ color: dashboardChartTheme.primary }}>
            {summary.completedTasks}
          </Text>
        </Paper>
        <Paper p='sm' radius='md' withBorder bg='white' style={{ borderColor: '#e2e8f0' }}>
          <Text size='xs' fw={600} mb={4} style={{ color: chartLabelColor }}>
            Tendencia reciente
          </Text>
          <Group gap='xs' align='center'>
            <TrendBadge
              trend={summary.latestTrend}
              changePct={summary.latestChangePct}
              size='lg'
            />
            <Text size='xs' style={{ color: chartLabelColor }}>
              {summary.latestTrend === 'up'
                ? 'Subió el tiempo'
                : summary.latestTrend === 'down'
                  ? 'Bajó el tiempo'
                  : 'Sin cambio'}
            </Text>
          </Group>
        </Paper>
      </SimpleGrid>

      <Box
        style={{
          ...chartScrollStyle,
          borderRadius: 12,
          border: `1px solid ${dashboardChartTheme.blue100}`,
          background: '#fff',
        }}
      >
        <ChartContainer
          type='line'
          data={chartData}
          options={mergedOptions}
          height={chartHeight}
          minWidth={getTrendChartScrollMinWidth(
            summary.points.length,
            isMobile,
            isCompact
          )}
          onChartClick={
            isMobile
              ? (index) => {
                  if (index == null) {
                    setPinnedIndex(null);
                    return;
                  }
                  setPinnedIndex((prev) => (prev === index ? null : index));
                }
              : undefined
          }
        />
      </Box>

      {isMobile && pinnedIndex !== null && trendPoints[pinnedIndex] && (
        <TrendPointDetail row={trendPoints[pinnedIndex]} />
      )}

      {summary.points.length > 1 && (
        <Box mt='md' style={chartScrollStyle}>
          <Group gap='xs' wrap='nowrap' pb={4} style={{ width: 'max-content', minWidth: '100%' }}>
            {summary.points.slice(1).map((point) => (
              <Paper
                key={point.periodKey}
                px='sm'
                py={6}
                radius='xl'
                withBorder
                style={{
                  flexShrink: 0,
                  borderColor:
                    point.trend === 'up'
                      ? 'rgba(22, 163, 74, 0.25)'
                      : point.trend === 'down'
                        ? 'rgba(220, 38, 38, 0.25)'
                        : '#e2e8f0',
                  background: '#fff',
                }}
              >
                <Group gap={6} wrap='nowrap'>
                  <Text size='xs' fw={600} style={{ color: chartLabelColor }}>
                    {point.label}
                  </Text>
                  <TrendBadge trend={point.trend} changePct={point.changePct} size='sm' />
                </Group>
              </Paper>
            ))}
          </Group>
        </Box>
      )}

      {isCompact && summary.completedTasks > 0 && (
        <Text size='xs' c='dimmed' ta='center' mt={4}>
          Desliza para ver el gráfico · Toca un punto para ver el detalle
        </Text>
      )}

      <Text size='xs' ta='center' mt='sm' style={{ color: chartLabelColor }}>
        <Text span fw={700} style={{ color: trendUpColor }}>
          ▲ Verde
        </Text>{' '}
        = tiempo subió ·{' '}
        <Text span fw={700} style={{ color: trendDownColor }}>
          ▼ Rojo
        </Text>{' '}
        = tiempo bajó (más rápido)
      </Text>
    </>
  );
}

export function ResolutionTimeTrendChart({
  tasks,
  assigneeFilter,
  title,
  subtitle = 'Tiempo desde que empieza a trabajar la tarea hasta que la finaliza',
}: ResolutionTimeTrendChartProps) {
  const [open, setOpen] = useState(false);
  const { isMobile, isCompact } = useChartViewport();
  const chartHeight = isMobile ? 220 : isCompact ? 260 : 300;

  useEffect(() => {
    setOpen(false);
  }, [tasks, assigneeFilter, title]);

  const summary = useMemo(
    () => buildResolutionTimeSeries(tasks, assigneeFilter),
    [tasks, assigneeFilter]
  );

  const chartData = useMemo(() => toChartRows(summary.points), [summary.points]);
  const trendPoints = chartData;

  const headerLabel = title.replace(/^Tendencia de tiempos\s*·?\s*/i, '') || title;

  return (
    <Box mt='md'>
      <UnstyledButton onClick={() => setOpen((value) => !value)} w='100%'>
        <Paper
          withBorder
          p='md'
          radius='md'
          style={{
            borderColor: open ? dashboardChartTheme.borderAccentStrong : undefined,
            background: open ? dashboardChartTheme.blue50 : 'white',
          }}
        >
          <Group justify='space-between' wrap='nowrap' gap='sm'>
            <Group gap='xs' wrap='nowrap' style={{ flex: 1, minWidth: 0 }}>
              <ThemeIcon
                size='sm'
                variant='gradient'
                gradient={dashboardChartTheme.gradient}
                style={{ flexShrink: 0 }}
              >
                <IconChartLine size={14} />
              </ThemeIcon>
              <Box style={{ minWidth: 0 }}>
                <Text size='sm' fw={600} lineClamp={1}>
                  Tendencia de tiempos
                  {headerLabel !== title && headerLabel ? (
                    <Text span c='dimmed' fw={500}>
                      {' '}
                      · {headerLabel}
                    </Text>
                  ) : null}
                </Text>
                {!open && summary.completedTasks > 0 && (
                  <Text size='xs' c='dimmed' lineClamp={1}>
                    {formatResolutionDuration(summary.overallAvgHours ?? 0)} promedio ·{' '}
                    {summary.completedTasks}{' '}
                    {summary.completedTasks === 1 ? 'tarea' : 'tareas'}
                  </Text>
                )}
              </Box>
              <Badge
                variant='light'
                size='sm'
                style={{ flexShrink: 0 }}
                styles={{
                  root: {
                    backgroundColor: dashboardChartTheme.blue100,
                    color: dashboardChartTheme.blue800,
                  },
                }}
              >
                {summary.completedTasks}
              </Badge>
            </Group>
            {open ? (
              <IconChevronDown size={18} style={{ flexShrink: 0 }} />
            ) : (
              <IconChevronRight size={18} style={{ flexShrink: 0 }} />
            )}
          </Group>
        </Paper>
      </UnstyledButton>

      <Collapse in={open}>
        <Paper
          withBorder
          radius='md'
          p={{ base: 'sm', sm: 'md', lg: 'lg' }}
          mt='xs'
          style={{
            borderColor: dashboardChartTheme.blue100,
            background:
              'linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(232,244,252,0.35) 100%)',
          }}
        >
          <TrendChartBody
            title={title}
            subtitle={subtitle}
            summary={summary}
            trendPoints={trendPoints}
            chartHeight={chartHeight}
            isMobile={isMobile}
            isCompact={isCompact}
          />
        </Paper>
      </Collapse>
    </Box>
  );
}
