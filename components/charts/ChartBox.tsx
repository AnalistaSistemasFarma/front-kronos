'use client';

import { Box, Skeleton } from '@mantine/core';
import type {
  ActiveElement,
  Chart as ChartJS,
  ChartData,
  ChartEvent,
  ChartOptions,
  ChartType,
} from 'chart.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { scheduleLayoutUpdate } from '../../lib/dom/scheduleLayoutUpdate';
import { Chart } from 'react-chartjs-2';
import {
  applyClickOnlyTooltipToChart,
  mergeClickOnlyTooltipOptions,
  shouldUseClickOnlyTooltip,
} from '../../lib/charts/clickOnlyTooltip';
import { mergeChartOptionsForTheme } from '../../lib/charts/chartColorScheme';
import { getChartDevicePixelRatio } from '../../lib/charts/defaults';
import { useTheme } from '../providers';
import { useChartViewport } from '../dashboard/useChartViewport';
import '../../lib/charts/register';

type ChartBoxProps<T extends ChartType = ChartType> = {
  type: T;
  data: ChartData<T>;
  options?: ChartOptions<T>;
  height: number;
  minWidth?: number;
  onChartClick?: (index: number | null) => void;
  pinnedIndex?: number | null;
  /** Sincroniza resize cuando cambia el contenedor padre (scroll, breakpoint) */
  layoutRevision?: number | string;
};

export function ChartBox<T extends ChartType = ChartType>({
  type,
  data,
  options,
  height,
  minWidth = 0,
  onChartClick,
  pinnedIndex,
  layoutRevision = 0,
}: ChartBoxProps<T>) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isCompact, layoutEpoch, resizeTick } = useChartViewport();
  const [ready, setReady] = useState(false);
  const [clickTooltipActive, setClickTooltipActive] = useState<ActiveElement[] | null>(
    null
  );
  const clickTooltipActiveRef = useRef<ActiveElement[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartJS<T> | null>(null);

  clickTooltipActiveRef.current = clickTooltipActive;

  const tooltipEnabledOption = options?.plugins?.tooltip?.enabled;
  const tooltipEnabledByOptions =
    typeof tooltipEnabledOption === 'boolean' ? tooltipEnabledOption : undefined;
  const useClickOnlyTooltip = shouldUseClickOnlyTooltip(
    Boolean(isCompact),
    tooltipEnabledByOptions,
    pinnedIndex !== undefined
  );

  useEffect(() => {
    setClickTooltipActive(null);
  }, [data, type]);

  const resizeChart = useCallback(() => {
    requestAnimationFrame(() => {
      chartRef.current?.resize();
    });
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || entry.contentRect.width <= 0) return;
      scheduleLayoutUpdate(() => {
        setReady(true);
        resizeChart();
      });
    });

    observer.observe(node);
    if (node.getBoundingClientRect().width > 0) setReady(true);

    return () => observer.disconnect();
  }, [resizeChart, height, minWidth, layoutRevision]);

  useEffect(() => {
    resizeChart();
  }, [
    height,
    minWidth,
    layoutEpoch,
    resizeTick,
    layoutRevision,
    isCompact,
    resizeChart,
  ]);

  const handleClick = useCallback(
    (event: ChartEvent, elements: ActiveElement[], chart: ChartJS<T>) => {
      if (useClickOnlyTooltip) {
        applyClickOnlyTooltipToChart(
          chart,
          event,
          elements,
          clickTooltipActiveRef.current,
          (next) => {
            clickTooltipActiveRef.current = next;
            setClickTooltipActive(next);
          }
        );
      }

      if (onChartClick) {
        const index = elements[0]?.index;
        onChartClick(typeof index === 'number' ? index : null);
      }

      const userOnClick = options?.onClick as
        | ((event: ChartEvent, elements: ActiveElement[], chart: ChartJS<T>) => void)
        | undefined;
      userOnClick?.(event, elements, chart);
    },
    [useClickOnlyTooltip, onChartClick, options]
  );

  const tooltipVisible =
    pinnedIndex !== undefined
      ? pinnedIndex !== null
      : useClickOnlyTooltip
        ? clickTooltipActive !== null && clickTooltipActive.length > 0
        : tooltipEnabledByOptions !== false;

  const optionsWithInteraction = mergeClickOnlyTooltipOptions(
    options,
    useClickOnlyTooltip,
    tooltipVisible
  );

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    ...optionsWithInteraction,
    onClick: handleClick,
    plugins: {
      ...optionsWithInteraction?.plugins,
      tooltip: {
        ...optionsWithInteraction?.plugins?.tooltip,
        ...(pinnedIndex !== undefined
          ? {
              enabled: pinnedIndex !== null,
            }
          : useClickOnlyTooltip
            ? {
                enabled: tooltipVisible,
              }
            : {}),
      },
    },
  } as ChartOptions<T>;

  const mergedOptions = mergeChartOptionsForTheme(
    {
      ...baseOptions,
      devicePixelRatio: getChartDevicePixelRatio(),
    },
    isDark
  );

  const useExpandedWidth = minWidth <= 0;

  return (
    <Box
      ref={containerRef}
      w='100%'
      style={{
        height,
        minHeight: height,
        width: '100%',
        maxWidth: '100%',
        minWidth: minWidth > 0 ? minWidth : undefined,
        position: 'relative',
      }}
    >
      {ready ? (
        <Chart
          ref={(instance) => {
            chartRef.current = instance ?? null;
          }}
          type={type}
          data={data}
          options={mergedOptions as ChartOptions<T>}
          style={{
            display: 'block',
            width: useExpandedWidth ? '100%' : minWidth,
            height: '100%',
            maxWidth: useExpandedWidth ? '100%' : undefined,
          }}
        />
      ) : (
        <Skeleton height={height} radius='md' w='100%' />
      )}
    </Box>
  );
}

