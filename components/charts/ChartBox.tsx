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
import { useEffect, useRef, useState } from 'react';
import { Chart } from 'react-chartjs-2';
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
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const mergedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    ...options,
    onClick: (
      _event: ChartEvent,
      elements: ActiveElement[],
      chart: ChartJS<keyof ChartTypeRegistry>
    ) => {
      if (onChartClick) {
        const index = elements[0]?.index;
        onChartClick(typeof index === 'number' ? index : null);
      }
      options?.onClick?.(_event, elements, chart);
    },
    plugins: {
      ...options?.plugins,
      tooltip: {
        ...options?.plugins?.tooltip,
        ...(pinnedIndex !== undefined
          ? {
              enabled: pinnedIndex !== null,
            }
          : {}),
      },
    },
  };

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

