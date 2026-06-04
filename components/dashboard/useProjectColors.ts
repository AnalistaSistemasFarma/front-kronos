'use client';

import { useMemo } from 'react';
import { useDashboardChartPalette } from './useDashboardChartPalette';

/** Colores de UI del dashboard según tema claro/oscuro */
export function useProjectColors() {
  const { palette, statusColors, chartStatusColors, seriesColors, isDark } =
    useDashboardChartPalette();

  return useMemo(
    () => ({
      primary: palette.primary,
      secondary: palette.secondary,
      success: statusColors.completada,
      warning: statusColors.pendiente,
      abierto: isDark ? '#4ade80' : '#22c55e',
      enProceso: statusColors.enProceso,
      error: palette.blue600,
      purple: palette.blue500,
      teal: palette.blue300,
      muted: palette.blue100,
      palette,
      statusColors,
      chartStatusColors,
      seriesColors,
      isDark,
    }),
    [palette, statusColors, chartStatusColors, seriesColors, isDark]
  );
}
