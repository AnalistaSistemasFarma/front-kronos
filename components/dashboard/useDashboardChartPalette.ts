'use client';

import { useTheme } from '../providers';
import { darkChartSeriesColors, statusChartVibrantColors } from '../../lib/theme/tokens';
import {
  dashboardChartTheme,
  dashboardChartThemeDark,
  categoricalChartPalette,
  categoricalChartPaletteDark,
  encargadoBarPalette,
  encargadoBarPaletteDark,
  encargadoBarPaletteMantine,
  statusChartColors,
  statusChartColorsDark,
} from './chartTheme';

export function useDashboardChartPalette() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const statusColors = isDark ? statusChartColorsDark : statusChartColors;

  return {
    isDark,
    palette: isDark ? dashboardChartThemeDark : dashboardChartTheme,
    statusColors,
    /** Barras, donas y KPIs con color saturado */
    chartStatusColors: statusChartVibrantColors,
    statusSeries: [
      { name: 'Completada', label: 'Completadas', color: statusColors.completada },
      { name: 'Pendiente', label: 'Pendientes', color: statusColors.pendiente },
      { name: 'En Proceso', label: 'En proceso', color: statusColors.enProceso },
    ] as const,
    barPalette: isDark ? encargadoBarPaletteDark : encargadoBarPalette,
    barPaletteMantine: encargadoBarPaletteMantine,
    categoricalPalette: isDark ? categoricalChartPaletteDark : categoricalChartPalette,
    seriesColors: isDark ? darkChartSeriesColors : encargadoBarPalette,
    labelColor: isDark ? dashboardChartThemeDark.chartAxisColor : dashboardChartTheme.chartAxisColor,
  };
}
