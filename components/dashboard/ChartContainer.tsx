'use client';

import { Box } from '@mantine/core';
import type { ChartData, ChartOptions, ChartType } from 'chart.js';
import { useMemo } from 'react';
import { getChartScrollMinWidth } from '../../lib/charts/chartScroll';
import { ChartBox } from '../charts/ChartBox';
import { useChartViewport } from './useChartViewport';

interface ChartContainerProps<T extends ChartType = ChartType> {
  height: number;
  /** Tope visible; si height es mayor, el contenedor hace scroll vertical */
  maxHeight?: number;
  /** Ancho mínimo explícito; si no se pasa, se calcula según cantidad de datos */
  minWidth?: number;
  /** false desactiva scroll horizontal y cálculo automático */
  scrollable?: boolean;
  type: T;
  data: ChartData<T>;
  options?: ChartOptions<T>;
  onChartClick?: (index: number | null) => void;
  pinnedIndex?: number | null;
}

/**
 * Contenedor para Chart.js: ocupa el 100% del ancho del card y se redimensiona
 * al cambiar breakpoint. Scroll horizontal/vertical solo cuando hay muchos datos.
 */
export function ChartContainer<T extends ChartType = ChartType>({
  height,
  maxHeight,
  minWidth: minWidthProp,
  scrollable = true,
  type,
  data,
  options,
  onChartClick,
  pinnedIndex,
}: ChartContainerProps<T>) {
  const viewport = useChartViewport();

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

  const needsVerticalScroll =
    maxHeight != null && maxHeight > 0 && height > maxHeight + 1;

  const layoutRevision = useMemo(
    () =>
      [
        viewport.layoutEpoch,
        viewport.resizeTick,
        height,
        maxHeight ?? 0,
        scrollMinWidth,
        needsVerticalScroll ? 1 : 0,
      ].join('-'),
    [
      viewport.layoutEpoch,
      viewport.resizeTick,
      height,
      maxHeight,
      scrollMinWidth,
      needsVerticalScroll,
    ]
  );

  const chartNode = (
    <ChartBox
      type={type}
      data={data}
      options={options}
      height={height}
      minWidth={scrollMinWidth}
      onChartClick={onChartClick}
      pinnedIndex={pinnedIndex}
      layoutRevision={layoutRevision}
    />
  );

  const canvas = (
    <Box
      w='100%'
      style={{
        height,
        minHeight: height,
        width: scrollMinWidth > 0 ? scrollMinWidth : '100%',
        maxWidth: scrollMinWidth > 0 ? undefined : '100%',
        minWidth: scrollMinWidth > 0 ? scrollMinWidth : undefined,
        position: 'relative',
      }}
    >
      {chartNode}
    </Box>
  );

  const withHorizontalScroll =
    scrollMinWidth > 0 ? (
      <Box className='chart-scroll-x' w='100%' style={{ maxWidth: '100%' }}>
        {canvas}
      </Box>
    ) : (
      canvas
    );

  if (needsVerticalScroll) {
    return (
      <Box
        className='chart-scroll-y'
        w='100%'
        style={{
          maxHeight,
          minHeight: Math.min(height, maxHeight!),
          width: '100%',
          maxWidth: '100%',
        }}
      >
        {withHorizontalScroll}
      </Box>
    );
  }

  return (
    <Box
      w='100%'
      style={{
        height,
        minHeight: height,
        width: '100%',
        maxWidth: '100%',
        position: 'relative',
      }}
    >
      {withHorizontalScroll}
    </Box>
  );
}
