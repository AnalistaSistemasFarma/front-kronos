'use client';

import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useMemo, useState } from 'react';
import { getChartDevicePixelRatio } from '../../lib/charts/defaults';

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
  const [pixelRatio, setPixelRatio] = useState(() => getChartDevicePixelRatio());

  useEffect(() => {
    let frame = 0;
    const syncViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setPixelRatio(getChartDevicePixelRatio());
        setResizeTick((t) => t + 1);
      });
    };

    window.addEventListener('resize', syncViewport, { passive: true });
    // Zoom del navegador (Ctrl +/-) suele disparar visualViewport, no solo resize
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewport, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', syncViewport);
      vv?.removeEventListener('resize', syncViewport);
    };
  }, []);

  return {
    isMobile: Boolean(isMobile),
    isTablet: Boolean(isTablet),
    isCompact,
    layoutEpoch,
    resizeTick,
    /** DPR actual (incluye zoom); ChartBox lo usa para redibujar nítido */
    pixelRatio,
  };
}
