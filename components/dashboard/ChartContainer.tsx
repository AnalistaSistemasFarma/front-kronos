'use client';

import { Box, Skeleton } from '@mantine/core';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getChartScrollMinWidth } from '../../lib/charts/chartScroll';
import { ChartBox } from '../charts/ChartBox';
import { useChartViewport } from './useChartViewport';

interface ChartContainerProps<T extends ChartType = ChartType> {
  height: number;
  /** Ancho mínimo explícito; si no se pasa, se calcula según cantidad de datos */
  minWidth?: number;
  /** false desactiva scroll y cálculo automático */
  scrollable?: boolean;
  type: T;
  data: ChartData<T>;
  options?: ChartOptions<T>;
  onChartClick?: (index: number | null) => void;
  pinnedIndex?: number | null;
}

/**
 * Contenedor con altura fija para Chart.js.
 * Con muchas categorías aplica scroll horizontal (móvil y escritorio).
 */
export function ChartContainer<T extends ChartType = ChartType>({
  height,
  minWidth: minWidthProp,
  scrollable = true,
  type,
  data,
  options,
  onChartClick,
  pinnedIndex,
}: ChartContainerProps<T>) {
  const viewport = useChartViewport();
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const scrollMinWidth = useMemo(() => {
    if (!scrollable) return 0;
    return getChartScrollMinWidth(
      type,
      data,
      viewport,
      options,
      minWidthProp
    );
  }, [scrollable, type, data, options, minWidthProp, viewport]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      if (node.getBoundingClientRect().width > 0) setReady(true);
    });
    observer.observe(node);
    if (node.getBoundingClientRect().width > 0) setReady(true);
    return () => observer.disconnect();
  }, [height, scrollMinWidth]);

  const chartContent = ready ? (
    <ChartBox
      type={type}
      data={data}
      options={options}
      height={height}
      minWidth={scrollMinWidth}
      onChartClick={onChartClick}
      pinnedIndex={pinnedIndex}
    />
  ) : (
    <Skeleton height={height} radius='md' />
  );

  const inner = (
    <Box
      ref={ref}
      style={{
        height,
        minHeight: height,
        minWidth: scrollMinWidth > 0 ? scrollMinWidth : undefined,
        width: scrollMinWidth > 0 ? scrollMinWidth : '100%',
        position: 'relative',
      }}
    >
      {chartContent}
    </Box>
  );

  if (scrollMinWidth > 0) {
    return (
      <Box className='chart-scroll-x' w='100%'>
        {inner}
      </Box>
    );
  }

  return (
    <Box ref={ref} w='100%' style={{ height, minHeight: height, position: 'relative' }}>
      {chartContent}
    </Box>
  );
}
