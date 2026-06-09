import type { ChartData, ChartOptions, ChartType } from 'chart.js';

export type ChartScrollViewport = {
  isMobile: boolean;
  isCompact: boolean;
};

export function getChartCategoryCount<T extends ChartType>(
  type: T,
  data: ChartData<T>
): number {
  const labels = data.labels;
  if (Array.isArray(labels) && labels.length > 0) {
    const first = labels[0];
    if (typeof first === 'string' || typeof first === 'number') {
      return labels.length;
    }
    if (Array.isArray(first)) {
      return first.length;
    }
  }
  const series = data.datasets?.[0]?.data;
  return Array.isArray(series) ? series.length : 0;
}

export function isHorizontalBarChart(
  type: ChartType,
  options?: ChartOptions
): boolean {
  return type === 'bar' && (options as ChartOptions<'bar'> | undefined)?.indexAxis === 'y';
}

/** Líneas / tendencias: más puntos → más ancho para scroll horizontal */
export function getLineChartScrollMinWidth(
  pointCount: number,
  viewport: ChartScrollViewport
): number {
  const { isMobile, isCompact } = viewport;
  if (pointCount <= 0) return 0;

  if (!isCompact) {
    return pointCount > 6 ? pointCount * 44 + 72 : 0;
  }

  if (pointCount <= 1) return isMobile ? 280 : 320;

  const perPoint = isMobile ? 80 : 64;
  const padding = isMobile ? 100 : 120;
  return Math.max(pointCount * perPoint + padding, isMobile ? 280 : 360);
}

/** Barras: categorías en X o barras horizontales (eje Y) en pantallas compactas */
export function getBarChartScrollMinWidth(
  categoryCount: number,
  viewport: ChartScrollViewport,
  horizontal: boolean
): number {
  const { isMobile, isCompact } = viewport;
  if (categoryCount <= 0) return 0;

  const threshold = isCompact ? 4 : 6;
  if (categoryCount <= threshold) return 0;

  if (horizontal) {
    const per = isMobile ? 88 : 68;
    return Math.max(categoryCount * per + 120, 300);
  }

  const per = isCompact ? (isMobile ? 56 : 48) : 40;
  const padding = isCompact ? 48 : 64;
  const floor = isCompact ? 280 : 320;
  return Math.max(categoryCount * per + padding, floor);
}

const NON_SCROLL_TYPES: ChartType[] = ['pie', 'doughnut', 'polarArea', 'radar'];

/**
 * Ancho mínimo del canvas cuando hay muchas categorías.
 * `explicitMin`: si se define, sustituye el cálculo automático (0 = sin scroll forzado).
 */
export function getChartScrollMinWidth<T extends ChartType>(
  type: T,
  data: ChartData<T>,
  viewport: ChartScrollViewport,
  options?: ChartOptions<T>,
  explicitMin?: number
): number {
  if (explicitMin !== undefined) return Math.max(0, explicitMin);

  if (NON_SCROLL_TYPES.includes(type)) return 0;

  const count = getChartCategoryCount(type, data);
  if (count === 0) return 0;

  if (type === 'line') {
    return getLineChartScrollMinWidth(count, viewport);
  }

  if (type === 'bar') {
    return getBarChartScrollMinWidth(
      count,
      viewport,
      isHorizontalBarChart(type, options as ChartOptions<'bar'> | undefined)
    );
  }

  return getBarChartScrollMinWidth(count, viewport, false);
}
