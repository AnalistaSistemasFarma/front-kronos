'use client';

import { useMediaQuery } from '@mantine/hooks';

/** Breakpoints alineados a Mantine sm (~576px) y md (~768px) */
export function useChartViewport() {
  const isMobile = useMediaQuery('(max-width: 36em)');
  const isTablet = useMediaQuery('(max-width: 48em)');
  const isCompact = Boolean(isMobile || isTablet);

  return {
    isMobile: Boolean(isMobile),
    isTablet: Boolean(isTablet),
    isCompact,
  };
}
