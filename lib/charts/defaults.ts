import type { ChartOptions, TooltipItem } from 'chart.js';
import { dashboardChartTheme } from '../../components/dashboard/chartTheme';

export const chartLabelColor = '#334155';
export const chartFontFamily =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export const trendUpColor = '#16a34a';
export const trendDownColor = '#dc2626';
export const trendFlatColor = '#64748b';

export function baseChartOptions<T extends 'bar' | 'line' | 'pie' | 'doughnut'>(
  overrides?: ChartOptions<T>
): ChartOptions<T> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: {
        labels: {
          color: chartLabelColor,
          font: { family: chartFontFamily, size: 12, weight: 'bold' },
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
        titleFont: { family: chartFontFamily, size: 12, weight: 'bold' },
        bodyFont: { family: chartFontFamily, size: 12, weight: 'bold' },
      },
    },
    ...overrides,
  } as ChartOptions<T>;
}

export function categoryAxis(color = chartLabelColor) {
  return {
    ticks: {
      color,
      font: { family: chartFontFamily, size: 11, weight: 'bold' as const },
      maxRotation: 45,
      minRotation: 0,
    },
    grid: { color: '#dce8f2' },
  };
}

export function valueAxis(color = chartLabelColor, beginAtZero = true) {
  return {
    beginAtZero,
    ticks: {
      color,
      font: { family: chartFontFamily, size: 11, weight: 'bold' as const },
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
