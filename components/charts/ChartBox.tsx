'use client';

import { Box, Skeleton } from '@mantine/core';
import type {
  ActiveElement,
  Chart as ChartJS,
  ChartData,
  ChartEvent,
  ChartOptions,
  ChartType,
  ChartTypeRegistry,
} from 'chart.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import {
  applyClickOnlyTooltipToChart,
  mergeClickOnlyTooltipOptions,
  shouldUseClickOnlyTooltip,
} from '../../lib/charts/clickOnlyTooltip';
import { mergeChartOptionsForTheme } from '../../lib/charts/chartColorScheme';
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
};

export function ChartBox<T extends ChartType = ChartType>({
  type,
  data,
  options,
  height,
  minWidth = 0,
  onChartClick,
  pinnedIndex,
}: ChartBoxProps<T>) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isCompact } = useChartViewport();
  const [ready, setReady] = useState(false);
  const [clickTooltipActive, setClickTooltipActive] = useState<ActiveElement[] | null>(
    null
  );
  const clickTooltipActiveRef = useRef<ActiveElement[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (node.getBoundingClientRect().width > 0) setReady(true);
    });
    observer.observe(node);
    if (node.getBoundingClientRect().width > 0) setReady(true);
    return () => observer.disconnect();
  }, []);

  const handleClick = useCallback(
    (event: ChartEvent, elements: ActiveElement[], chart: ChartJS<keyof ChartTypeRegistry>) => {
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

      options?.onClick?.(event, elements, chart);
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

  const mergedOptions = mergeChartOptionsForTheme(baseOptions, isDark);

  return (
    <Box
      ref={containerRef}
      w='100%'
      style={{
        height,
        minHeight: height,
        minWidth: minWidth > 0 ? minWidth : undefined,
        position: 'relative',
      }}
    >
      {ready ? (
        <Chart
          type={type}
          data={data}
          options={mergedOptions as ChartOptions<T>}
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <Skeleton height={height} radius='md' />
      )}
    </Box>
  );
}
