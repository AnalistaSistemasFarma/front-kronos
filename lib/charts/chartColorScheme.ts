import type { ChartOptions, ChartType, PluginOptionsByType } from 'chart.js';
import { dashboardChartTheme, dashboardChartThemeDark } from '../../components/dashboard/chartTheme';
import { darkTokens, lightTokens } from '../theme/tokens';

export function getChartUiColors(isDark: boolean) {
  const t = isDark ? dashboardChartThemeDark : dashboardChartTheme;
  const app = isDark ? darkTokens : lightTokens;
  return {
    label: t.chartAxisColor,
    grid: t.gridStroke,
    tooltipBg: t.tooltipBg,
    tooltipTitle: t.tooltipTitleColor,
    tooltipBody: app.chartText,
    tooltipBorder: t.chartPanelBorder,
  };
}

/** Ajusta opciones de Chart.js según tema claro/oscuro */
export function mergeChartOptionsForTheme<T extends ChartType>(
  options: ChartOptions<T> | undefined,
  isDark: boolean
): ChartOptions<T> {
  const colors = getChartUiColors(isDark);
  const plugins = (options?.plugins ?? {}) as PluginOptionsByType<T>;
  const legend = plugins.legend ?? {};
  const tooltip = plugins.tooltip ?? {};

  const merged: ChartOptions<T> = {
    ...(options ?? ({} as ChartOptions<T>)),
    plugins: {
      ...plugins,
      legend: {
        ...legend,
        labels: {
          ...(legend.labels ?? {}),
          color: colors.label,
        },
      },
      tooltip: {
        ...tooltip,
        backgroundColor: colors.tooltipBg,
        titleColor: colors.tooltipTitle,
        bodyColor: colors.tooltipBody,
        borderColor: colors.tooltipBorder,
      },
    },
    scales: mergeScalesForTheme(options?.scales, colors.label, colors.grid),
  };

  return merged;
}

function mergeScalesForTheme(
  scales: ChartOptions['scales'],
  tickColor: string,
  gridColor: string
): ChartOptions['scales'] {
  if (!scales) return scales;
  const next: ChartOptions['scales'] = { ...scales };
  for (const key of Object.keys(next)) {
    const axis = next[key as keyof typeof next];
    if (!axis || typeof axis !== 'object') continue;
    next[key as keyof typeof next] = {
      ...axis,
      ticks: {
        ...(axis as { ticks?: object }).ticks,
        color: tickColor,
      },
      grid: {
        ...(axis as { grid?: object }).grid,
        color: gridColor,
      },
    };
  }
  return next;
}
