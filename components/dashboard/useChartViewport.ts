'use client';

import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useMemo, useState } from 'react';

/** Breakpoints alineados a Mantine sm (~576px) y md (~768px) */
export function useChartViewport() {
  const isMobile = useMediaQuery('(max-width: 36em)');
  const isTablet = useMediaQuery('(max-width: 48em)');
  const isCompact = Boolean(isMobile || isTablet);

  /** Cambia al cruzar breakpoints; fuerza recálculo de layout en gráficas */
  const layoutEpoch = useMemo(
    () => `${isMobile ? 1 : 0}-${isTablet ? 1 : 0}`,
    [isMobile, isTablet]
  );

  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setResizeTick((t) => t + 1));
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return {
    isMobile: Boolean(isMobile),
    isTablet: Boolean(isTablet),
    isCompact,
    layoutEpoch,
    resizeTick,
  };
}
