'use client';

import { useMemo } from 'react';
import { Alert, Box, Group, Paper, Text, ThemeIcon } from '@mantine/core';
import {
  IconChartLine,
  IconMinus,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';
import { ChartContainer } from '../dashboard/ChartContainer';
import { useChartViewport } from '../dashboard/useChartViewport';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';
import { buildTrendTimeChart } from '../../lib/charts/builders';
import { trendDownColor, trendFlatColor, trendUpColor } from '../../lib/charts/defaults';
import {
  formatResolutionDuration,
  type TimeTrendSummary,
} from '../../lib/request-general/solicitadoAnalytics';
import type { ResolutionTrend } from '../../lib/dashboard/resolutionTimeSeries';

function resolveTrend(changePct: number | null | undefined): ResolutionTrend | null {
  if (changePct == null) return null;
  if (changePct > 0.5) return 'up';
  if (changePct < -0.5) return 'down';
  return 'flat';
}

function TrendChip({
  trend,
  label,
}: {
  trend: ResolutionTrend | null;
  label: string | null;
}) {
  if (!label) {
    return (
      <Group gap={4} wrap='nowrap'>
        <IconMinus size={14} color={trendFlatColor} />
        <Text size='xs' fw={700} style={{ color: trendFlatColor }}>
          Primer periodo
        </Text>
      </Group>
    );
  }

  const color =
    trend === 'up' ? trendUpColor : trend === 'down' ? trendDownColor : trendFlatColor;
  const Icon = trend === 'up' ? IconTrendingUp : trend === 'down' ? IconTrendingDown : IconMinus;

  return (
    <Group gap={4} wrap='nowrap'>
      <Icon size={16} color={color} stroke={2.5} />
      <Text size='xs' fw={700} style={{ color }}>
        {label}
      </Text>
    </Group>
  );
}

/** Gráfica de tiempo personal con flechas sube/baja y scroll horizontal. */
export function PersonalTimeTrendBlock({
  title,
  description,
  summary,
  emptyMessage,
  entranceKey,
}: {
  title: string;
  description: string;
  summary: TimeTrendSummary;
  emptyMessage: string;
  entranceKey?: string | number;
}) {
  const viewport = useChartViewport();
  const { palette } = useDashboardChartPalette();
  const points = summary.points;

  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const maxTiempo = Math.max(...points.map((d) => d.tiempo), 0.05);
    const yMax = maxTiempo < 1 ? Math.max(maxTiempo * 1.4, 0.08) : maxTiempo * 1.2;
    return buildTrendTimeChart(points, yMax, viewport.isMobile);
  }, [points, viewport.isMobile]);

  const scrollMinWidth = Math.max(points.length * 88 + 120, points.length > 4 ? 480 : 0);

  const last = points[points.length - 1];
  const lastTrend = resolveTrend(last?.changePct);

  if (!chart || points.length === 0) {
    return (
      <Paper p='md' radius='lg' withBorder style={{ borderColor: palette.blue100 }}>
        <Text fw={700} mb={4} style={{ color: palette.primary }}>
          {title}
        </Text>
        <Text size='xs' c='dimmed' mb='md'>
          {description}
        </Text>
        <Alert color='gray' variant='light'>
          {emptyMessage}
        </Alert>
      </Paper>
    );
  }

  return (
    <Paper p='md' radius='lg' withBorder style={{ borderColor: palette.blue100 }}>
      <Group justify='space-between' align='flex-start' wrap='wrap' gap='sm' mb='md'>
        <Group gap='sm' align='flex-start' style={{ flex: 1, minWidth: 200 }}>
          <ThemeIcon size={44} radius='md' variant='gradient' gradient={palette.gradient}>
            <IconChartLine size={22} />
          </ThemeIcon>
          <Box>
            <Text fw={700} style={{ color: palette.primary }}>
              {title}
            </Text>
            <Text size='xs' c='dimmed' mt={2}>
              {description}
            </Text>
          </Box>
        </Group>

        {last ? (
          <Paper
            px='md'
            py='xs'
            radius='md'
            withBorder
            style={{
              borderColor:
                lastTrend === 'up'
                  ? 'rgba(22, 163, 74, 0.4)'
                  : lastTrend === 'down'
                    ? 'rgba(220, 38, 38, 0.4)'
                    : palette.blue100,
              background: palette.chartPanelBg,
            }}
          >
            <Text size='xs' fw={600} ta='center' c='dimmed'>
              Último periodo
            </Text>
            <Group gap='xs' justify='center' mt={4} wrap='nowrap'>
              <Text fw={800} size='lg' style={{ color: palette.primary }}>
                {formatResolutionDuration(last.tiempo)}
              </Text>
              <TrendChip trend={lastTrend} label={last.changeLabel ?? null} />
            </Group>
          </Paper>
        ) : null}
      </Group>

      <Box
        style={{
          borderRadius: 12,
          border: `1px solid ${palette.blue100}`,
          background: palette.chartPanelBg,
        }}
      >
        <ChartContainer
          entranceKey={entranceKey ?? 'trend'}
          type='line'
          height={280}
          data={chart.data}
          options={chart.options}
          minWidth={scrollMinWidth > 0 ? scrollMinWidth : undefined}
          scrollable
        />
      </Box>

      {points.length > 1 ? (
        <Box mt='md' className='chart-scroll-x' style={{ overflowX: 'auto' }}>
          <Group gap='xs' wrap='nowrap' pb={4} style={{ width: 'max-content', minWidth: '100%' }}>
            {points.map((point, index) => {
              const trend = resolveTrend(point.changePct);
              return (
                <Paper
                  key={`${point.period}-${index}`}
                  px='sm'
                  py={8}
                  radius='xl'
                  withBorder
                  style={{
                    flexShrink: 0,
                    borderColor:
                      trend === 'up'
                        ? 'rgba(22, 163, 74, 0.35)'
                        : trend === 'down'
                          ? 'rgba(220, 38, 38, 0.35)'
                          : palette.chartPanelBorder,
                    background: palette.chartPanelBg,
                  }}
                >
                  <Group gap={8} wrap='nowrap'>
                    <Text size='xs' fw={700} style={{ color: palette.primary }}>
                      {point.period}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {formatResolutionDuration(point.tiempo)}
                    </Text>
                    <TrendChip
                      trend={index === 0 ? null : trend}
                      label={index === 0 ? null : point.changeLabel ?? null}
                    />
                  </Group>
                </Paper>
              );
            })}
          </Group>
        </Box>
      ) : null}

      <Text size='xs' ta='center' mt='sm' c='dimmed'>
        Cada punto es tu tiempo promedio de ese periodo ·{' '}
        <Text span fw={700} style={{ color: trendUpColor }}>
          ↑ Verde
        </Text>{' '}
        = tardaste más ·{' '}
        <Text span fw={700} style={{ color: trendDownColor }}>
          ↓ Rojo
        </Text>{' '}
        = fuiste más rápido
      </Text>
    </Paper>
  );
}

/** Ancho mínimo para forzar scroll horizontal cuando hay muchas categorías. */
export function chartScrollMinWidth(itemCount: number, perItem = 76, floor = 420): number | undefined {
  if (itemCount <= 4) return undefined;
  return Math.max(itemCount * perItem + 100, floor);
}
