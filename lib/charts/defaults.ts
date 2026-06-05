import type { ChartOptions, TooltipItem } from 'chart.js';
import { dashboardChartTheme } from '../../components/dashboard/chartTheme';

export const chartLabelColor = '#334155';
export const chartFontFamily =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** Tamaños legibles en canvas (evitar 10–11px en negrita, se ven borrosos) */
export const CHART_AXIS_FONT_SIZE = 12;
export const CHART_AXIS_FONT_SIZE_COMPACT = 11;
export const CHART_LEGEND_FONT_SIZE = 13;
export const CHART_LEGEND_FONT_SIZE_COMPACT = 12;
export const CHART_TOOLTIP_FONT_SIZE = 14;

/** Rotación máxima que mantiene etiquetas legibles en canvas */
export const CHART_TICK_MAX_ROTATION = 30;

export const trendUpColor = '#16a34a';
export const trendDownColor = '#dc2626';
export const trendFlatColor = '#64748b';

export function chartAxisFont(compact = false) {
  return {
    family: chartFontFamily,
    size: compact ? CHART_AXIS_FONT_SIZE_COMPACT : CHART_AXIS_FONT_SIZE,
    weight: 600 as const,
    lineHeight: 1.3,
  };
}

export function chartLegendFont(compact = false) {
  return {
    family: chartFontFamily,
    size: compact ? CHART_LEGEND_FONT_SIZE_COMPACT : CHART_LEGEND_FONT_SIZE,
    weight: 600 as const,
    lineHeight: 1.3,
  };
}

export function getChartDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
}

export function baseChartOptions<T extends 'bar' | 'line' | 'pie' | 'doughnut'>(
  overrides?: ChartOptions<T>
): ChartOptions<T> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: getChartDevicePixelRatio(),
    animation: { duration: 500 },
    plugins: {
      legend: {
        labels: {
          color: chartLabelColor,
          font: chartLegendFont(),
          boxWidth: 12,
          padding: 14,
        },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: dashboardChartTheme.primary,
        bodyColor: chartLabelColor,
        borderColor: '#e2e8f0',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        titleFont: {
          family: chartFontFamily,
          size: CHART_TOOLTIP_FONT_SIZE,
          weight: 600,
          lineHeight: 1.3,
        },
        bodyFont: {
          family: chartFontFamily,
          size: CHART_TOOLTIP_FONT_SIZE,
          weight: 600,
          lineHeight: 1.3,
        },
      },
    },
    ...overrides,
  } as ChartOptions<T>;
}

export function categoryAxis(color = chartLabelColor, compact = false) {
  return {
    ticks: {
      color,
      font: chartAxisFont(compact),
      maxRotation: CHART_TICK_MAX_ROTATION,
      minRotation: 0,
      autoSkip: true,
      autoSkipPadding: 12,
    },
    grid: { color: '#dce8f2' },
  };
}

export function valueAxis(color = chartLabelColor, beginAtZero = true, compact = false) {
  return {
    beginAtZero,
    ticks: {
      color,
      font: chartAxisFont(compact),
      precision: 0,
    },
    grid: { color: '#dce8f2' },
  };
}

export function countTooltip(labelSuffix = 'tareas'): Partial<ChartOptions<'bar'>> {
  return {
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<'bar'>) => {
            const value = ctx.parsed.y ?? ctx.parsed.x ?? 0;
            return `${value} ${labelSuffix}`;
          },
        },
      },
    },
  };
}
