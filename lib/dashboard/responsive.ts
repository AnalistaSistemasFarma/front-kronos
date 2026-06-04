import type { CardProps } from '@mantine/core';

export type ChartHeightPreset = 'kpi' | 'standard' | 'medium' | 'large' | 'hero';

const HEIGHTS: Record<
  ChartHeightPreset,
  { mobile: number; tablet: number; desktop: number }
> = {
  kpi: { mobile: 132, tablet: 152, desktop: 168 },
  standard: { mobile: 220, tablet: 260, desktop: 300 },
  medium: { mobile: 200, tablet: 240, desktop: 280 },
  large: { mobile: 260, tablet: 320, desktop: 400 },
  hero: { mobile: 280, tablet: 340, desktop: 360 },
};

export type ChartViewport = {
  isMobile: boolean;
  isTablet: boolean;
  isCompact: boolean;
};

export function resolveChartHeight(
  preset: ChartHeightPreset,
  viewport: Pick<ChartViewport, 'isMobile' | 'isTablet'>
): number {
  const h = HEIGHTS[preset];
  if (viewport.isMobile) return h.mobile;
  if (viewport.isTablet) return h.tablet;
  return h.desktop;
}

/** Padding de tarjetas del dashboard (responsive; válido en runtime para Card/Paper) */
export function getDashboardCardPadding(): CardProps['padding'] {
  return { base: 'sm', sm: 'md', lg: 'lg' } as unknown as CardProps['padding'];
}

/** Estilos para pestañas con scroll horizontal en móvil */
export const dashboardTabsStyles = {
  root: { minWidth: 0 },
  list: {
    flexWrap: 'nowrap' as const,
    overflowX: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
    scrollbarWidth: 'thin' as const,
    gap: 4,
    paddingBottom: 4,
  },
  tab: {
    flex: '0 0 auto' as const,
    whiteSpace: 'nowrap' as const,
    fontSize: 'clamp(0.75rem, 2.5vw, 0.875rem)',
    paddingLeft: 12,
    paddingRight: 12,
  },
};
