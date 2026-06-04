'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
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
import { chartAxisTickStyle, dashboardChartTheme } from './chartTheme';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

const chartLabelColor = '#334155';
const trendUpColor = '#16a34a';
const trendDownColor = '#dc2626';
const trendFlatColor = '#64748b';

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

function ResolutionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly {
    payload?: {
      period?: string;
      tiempo?: number;
      tareas?: number;
      changePct?: number | null;
      trend?: ResolutionTrend | null;
      totalHours?: number;
    };
  }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <Paper
      shadow='lg'
      p='sm'
      radius='md'
      withBorder
      style={{
        minWidth: 200,
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

type ChartRow = ReturnType<typeof toChartRows>[number] & {
  segUp: number | null;
  segDown: number | null;
};

function buildSegmentChartData(rows: ReturnType<typeof toChartRows>): ChartRow[] {
  const data: ChartRow[] = rows.map((row) => ({
    ...row,
    segUp: null,
    segDown: null,
  }));

  for (let i = 1; i < data.length; i += 1) {
    const key: 'segUp' | 'segDown' =
      data[i].tiempo >= data[i - 1].tiempo ? 'segUp' : 'segDown';
    data[i - 1][key] = data[i - 1].tiempo;
    data[i][key] = data[i].tiempo;
  }

  return data;
}

function BitcoinStyleTimeChart({
  width: widthProp,
  height: heightProp,
  w,
  h,
  data,
  isMobile,
}: {
  width?: number;
  height?: number;
  w?: number;
  h?: number;
  data: ChartRow[];
  isMobile: boolean;
}) {
  const gradientId = useId().replace(/:/g, '');
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const width = (widthProp != null && widthProp > 0 ? widthProp : w) ?? 0;
  const height = (heightProp != null && heightProp > 0 ? heightProp : h) ?? 0;

  useEffect(() => {
    setPinnedIndex(null);
  }, [data]);

  const handleChartClick = useCallback(
    (state: { activeTooltipIndex?: unknown }) => {
      if (!isMobile) return;
      const index = state?.activeTooltipIndex;
      if (typeof index === 'number') {
        setPinnedIndex((prev) => (prev === index ? null : index));
      } else {
        setPinnedIndex(null);
      }
    },
    [isMobile]
  );

  if (width <= 0 || height <= 0) {
    return null;
  }

  const maxTiempo = Math.max(...data.map((d) => d.tiempo), 0.05);
  const yMax = maxTiempo < 1 ? Math.max(maxTiempo * 1.4, 0.08) : maxTiempo * 1.2;

  return (
    <AreaChart
      width={width}
      height={height}
      data={data}
      onClick={handleChartClick}
      margin={{
        top: 12,
        right: isMobile ? 8 : 16,
        left: isMobile ? 0 : 4,
        bottom: isMobile ? 4 : 8,
      }}
    >
      <defs>
        <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor={dashboardChartTheme.secondary} stopOpacity={0.38} />
          <stop offset='55%' stopColor={dashboardChartTheme.blue400} stopOpacity={0.12} />
          <stop offset='100%' stopColor={dashboardChartTheme.blue50} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke='#dce8f2' strokeDasharray='4 4' vertical={false} />
      <XAxis
        dataKey='period'
        tick={isMobile ? { ...chartAxisTickStyle, fontSize: 10 } : chartAxisTickStyle}
        angle={isMobile ? -40 : -28}
        textAnchor='end'
        height={isMobile ? 64 : 56}
        interval={0}
        axisLine={{ stroke: '#94a3b8' }}
        tickLine={false}
      />
      <YAxis
        tick={chartAxisTickStyle}
        axisLine={{ stroke: '#94a3b8' }}
        tickLine={false}
        tickFormatter={(v: number) => formatResolutionDuration(v)}
        width={isMobile ? 52 : 64}
        domain={[0, yMax]}
      />
      <RechartsTooltip
        cursor={isMobile ? undefined : { stroke: dashboardChartTheme.blue200, strokeWidth: 1 }}
        active={isMobile ? pinnedIndex !== null : undefined}
        content={({ active, payload }) => {
          if (isMobile) {
            if (pinnedIndex === null || !data[pinnedIndex]) return null;
            const row = data[pinnedIndex];
            return (
              <ResolutionTooltip
                active
                payload={[
                  {
                    payload: row,
                  },
                ]}
              />
            );
          }
          return <ResolutionTooltip active={active} payload={payload} />;
        }}
      />
      <Area
        type='monotone'
        dataKey='tiempo'
        stroke='transparent'
        fill={`url(#${gradientId})`}
        fillOpacity={1}
        isAnimationActive
        animationDuration={650}
      />
      <Line
        type='monotone'
        dataKey='tiempo'
        stroke={dashboardChartTheme.secondary}
        strokeWidth={2.5}
        dot={(props) => {
          const { cx, cy, index } = props as {
            cx?: number;
            cy?: number;
            index?: number;
          };
          if (cx == null || cy == null || index == null) {
            return <g key='dot-empty' />;
          }
          const isPinned = isMobile && pinnedIndex === index;
          const radius = isPinned ? 8 : isMobile ? 5 : 6;
          return (
            <circle
              key={`dot-${index}`}
              cx={cx}
              cy={cy}
              r={radius}
              fill={isPinned ? dashboardChartTheme.primary : '#fff'}
              stroke={dashboardChartTheme.secondary}
              strokeWidth={2}
              style={{ cursor: isMobile ? 'pointer' : 'default' }}
            />
          );
        }}
        activeDot={
          isMobile
            ? undefined
            : {
                r: 8,
                fill: dashboardChartTheme.primary,
                stroke: '#fff',
                strokeWidth: 2,
              }
        }
        isAnimationActive
        animationDuration={650}
      />
      <Line
        type='monotone'
        dataKey='segUp'
        stroke={trendUpColor}
        strokeWidth={2.75}
        dot={isMobile ? false : {
          r: 4.5,
          fill: '#fff',
          stroke: trendUpColor,
          strokeWidth: 2,
        }}
        activeDot={
          isMobile
            ? undefined
            : {
                r: 6.5,
                fill: trendUpColor,
                stroke: '#fff',
                strokeWidth: 2,
              }
        }
        connectNulls={false}
        isAnimationActive
        animationDuration={650}
      />
      <Line
        type='monotone'
        dataKey='segDown'
        stroke={trendDownColor}
        strokeWidth={2.75}
        dot={isMobile ? false : {
          r: 4.5,
          fill: '#fff',
          stroke: trendDownColor,
          strokeWidth: 2,
        }}
        activeDot={
          isMobile
            ? undefined
            : {
                r: 6.5,
                fill: trendDownColor,
                stroke: '#fff',
                strokeWidth: 2,
              }
        }
        connectNulls={false}
        isAnimationActive
        animationDuration={650}
      />
    </AreaChart>
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
  segmentChartData,
  chartHeight,
  isMobile,
  isCompact,
}: {
  title: string;
  subtitle: string;
  summary: ReturnType<typeof buildResolutionTimeSeries>;
  segmentChartData: ChartRow[];
  chartHeight: number;
  isMobile: boolean;
  isCompact: boolean;
}) {
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
          height={chartHeight}
          minWidth={getTrendChartScrollMinWidth(
            summary.points.length,
            isMobile,
            isCompact
          )}
        >
          <BitcoinStyleTimeChart data={segmentChartData} isMobile={isMobile} />
        </ChartContainer>
      </Box>

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
  const segmentChartData = useMemo(() => buildSegmentChartData(chartData), [chartData]);

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
            segmentChartData={segmentChartData}
            chartHeight={chartHeight}
            isMobile={isMobile}
            isCompact={isCompact}
          />
        </Paper>
      </Collapse>
    </Box>
  );
}
