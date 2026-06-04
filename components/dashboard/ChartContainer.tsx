'use client';

import { Box, Skeleton } from '@mantine/core';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { useEffect, useRef, useState } from 'react';
import { ChartBox } from '../charts/ChartBox';

interface ChartContainerProps<T extends ChartType = ChartType> {
  height: number;
  minWidth?: number;
  type: T;
  data: ChartData<T>;
  options?: ChartOptions<T>;
  onChartClick?: (index: number | null) => void;
  pinnedIndex?: number | null;
}

/**
 * Contenedor con altura fija para gráficas Chart.js (responsive).
 */
export function ChartContainer<T extends ChartType = ChartType>({
  height,
  minWidth = 0,
  type,
  data,
  options,
  onChartClick,
  pinnedIndex,
}: ChartContainerProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      if (node.getBoundingClientRect().width > 0) setReady(true);
    });
    observer.observe(node);
    if (node.getBoundingClientRect().width > 0) setReady(true);
    return () => observer.disconnect();
  }, [height, minWidth]);

  return (
    <Box
      ref={ref}
      w='100%'
      style={{
        height,
        minHeight: height,
        minWidth: minWidth > 0 ? minWidth : 0,
        width: '100%',
        position: 'relative',
      }}
    >
      {ready ? (
        <ChartBox
          type={type}
          data={data}
          options={options}
          height={height}
          minWidth={minWidth}
          onChartClick={onChartClick}
          pinnedIndex={pinnedIndex}
        />
      ) : (
        <Skeleton height={height} radius='md' />
      )}
    </Box>
  );
}
