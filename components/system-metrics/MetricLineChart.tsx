'use client';

import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '../../lib/charts/register';
import { mergeChartOptionsForTheme } from '../../lib/charts/chartColorScheme';
import { useTheme } from '../providers';
import { seriesColor } from './colors';
import { formatValue } from './format';

export type LineSeries = {
  label: string;
  /** Índice fijo de color (identidad de la serie). */
  colorIndex: number;
  values: Array<number | null>;
};

type MetricLineChartProps = {
  labels: string[];
  series: LineSeries[];
  unit: string;
  height?: number;
  /** Límite visible del eje Y (p. ej. 100 para porcentajes). */
  suggestedMax?: number;
};

/** Línea de tiempo de un solo eje, con tooltip de todas las series al pasar el mouse. */
export function MetricLineChart({ labels, series, unit, height = 240, suggestedMax }: MetricLineChartProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.values,
        borderColor: seriesColor(s.colorIndex, isDark),
        backgroundColor: seriesColor(s.colorIndex, isDark),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 12,
        tension: 0.2,
        spanGaps: false,
      })),
    }),
    [labels, series, isDark]
  );

  const options = useMemo(
    () =>
      mergeChartOptionsForTheme<'line'>(
        {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: series.length > 1,
              position: 'bottom',
              labels: { boxWidth: 12, boxHeight: 2, usePointStyle: false },
            },
            tooltip: {
              callbacks: {
                label: (ctx) =>
                  ctx.parsed.y == null
                    ? `${ctx.dataset.label}: sin dato`
                    : `${ctx.dataset.label}: ${formatValue(ctx.parsed.y)} ${unit}`,
              },
            },
          },
          scales: {
            x: { ticks: { maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
            y: {
              beginAtZero: true,
              suggestedMax,
              ticks: { maxTicksLimit: 5, callback: (v) => `${formatValue(Number(v))} ${unit}` },
            },
          },
        } satisfies ChartOptions<'line'>,
        isDark
      ),
    [series.length, unit, suggestedMax, isDark]
  );

  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
}

