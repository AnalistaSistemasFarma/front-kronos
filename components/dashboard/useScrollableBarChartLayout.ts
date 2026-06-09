'use client';

import { useMemo } from 'react';
import {
  resolveScrollableBarChartLayout,
  type ScrollableBarChartLayout,
} from './chartTheme';
import { useChartViewport } from './useChartViewport';

/** Altura + scroll para barras horizontales extensas (encargados, procesos, equipo). */
export function useScrollableBarChartLayout(itemCount: number): ScrollableBarChartLayout {
  const { isCompact } = useChartViewport();

  return useMemo(
    () => resolveScrollableBarChartLayout(itemCount, isCompact),
    [itemCount, isCompact]
  );
}
