import type { ChartData, ChartOptions } from 'chart.js';
import { dashboardChartTheme, statusChartColors } from '../../components/dashboard/chartTheme';
import {
  baseChartOptions,
  categoryAxis,
  chartLabelColor,
  countTooltip,
  trendDownColor,
  trendUpColor,
  valueAxis,
} from './defaults';

export interface PieSlice {
  name: string;
  value: number;
  color: string;
}

export interface NamedValue {
  name: string;
  value: number;
}

export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface TrendPoint {
  period: string;
  tiempo: number;
  tareas: number;
  changePct: number | null;
}

const STATUS_KEYS = ['Completada', 'Pendiente', 'En Proceso'] as const;

export function buildPieChart(
  slices: PieSlice[],
  options?: { showLegend?: boolean; cutout?: string }
): { data: ChartData<'pie'>; options: ChartOptions<'pie'> } {
  return {
    data: {
      labels: slices.map((s) => s.name),
      datasets: [
        {
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => s.color),
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    },
    options: baseChartOptions<'pie'>({
      cutout: options?.cutout,
      plugins: {
        legend: {
          display: options?.showLegend ?? true,
          position: 'bottom',
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
              const value = ctx.parsed ?? 0;
              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return `${ctx.label}: ${value} (${pct}%)`;
            },
          },
        },
      },
    }),
  };
}

export function buildVerticalBarChart(
  items: NamedValue[],
  color: string,
  opts?: {
    labelSuffix?: string;
    datasetLabel?: string;
    rotateLabels?: boolean;
    formatValue?: (value: number) => string;
    showLegend?: boolean;
  }
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
  const labelSuffix = opts?.labelSuffix ?? 'tareas';
  const formatValue = opts?.formatValue;

  return {
    data: {
      labels: items.map((i) => i.name),
      datasets: [
        {
          label: opts?.datasetLabel ?? labelSuffix,
          data: items.map((i) => i.value),
          backgroundColor: color,
          borderRadius: 6,
          maxBarThickness: 36,
        },
      ],
    },
    options: baseChartOptions<'bar'>({
      scales: {
        x: {
          ...categoryAxis(),
          ticks: {
            ...categoryAxis().ticks,
            maxRotation: opts?.rotateLabels ? 45 : 0,
            minRotation: opts?.rotateLabels ? 45 : 0,
          },
        },
        y: valueAxis(),
      },
      plugins: {
        legend: { display: opts?.showLegend ?? false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const value = ctx.parsed.y ?? 0;
              if (formatValue) return formatValue(value);
              return `${value} ${labelSuffix}`;
            },
          },
        },
      },
    }),
  };
}

export function buildHorizontalMultiColorBarChart(
  items: { label: string; value: number; color: string }[],
  isMobile: boolean
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
  return {
    data: {
      labels: items.map((i) => i.label),
      datasets: [
        {
          label: 'Tareas',
          data: items.map((i) => i.value),
          backgroundColor: items.map((i) => i.color),
          borderRadius: 6,
          maxBarThickness: isMobile ? 24 : 32,
        },
      ],
    },
    options: baseChartOptions<'bar'>({
      indexAxis: 'y',
      scales: {
        x: valueAxis(),
        y: categoryAxis(),
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x ?? 0} tareas`,
          },
        },
      },
    }),
  };
}

export function buildSimpleLineChart(
  points: TimeSeriesPoint[],
  lineColor: string,
  valueLabel = 'Casos nuevos'
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
  return {
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: valueLabel,
          data: points.map((p) => p.value),
          borderColor: lineColor,
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          fill: false,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: lineColor,
          pointBorderWidth: 2,
        },
      ],
    },
    options: baseChartOptions<'line'>({
      scales: {
        x: {
          ...categoryAxis(),
          ticks: {
            ...categoryAxis().ticks,
            maxRotation: 45,
            minRotation: 45,
          },
        },
        y: valueAxis(chartLabelColor, false),
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${valueLabel}: ${ctx.parsed.y ?? 0}`,
          },
        },
      },
    }),
  };
}

export function buildAreaLineChart(
  points: TimeSeriesPoint[],
  lineColor: string
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
  return {
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: 'Tareas',
          data: points.map((p) => p.value),
          borderColor: lineColor,
          backgroundColor: 'rgba(61, 182, 224, 0.22)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: lineColor,
          pointBorderWidth: 2,
        },
      ],
    },
    options: baseChartOptions<'line'>({
      scales: {
        x: categoryAxis(),
        y: valueAxis(),
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y ?? 0} tareas`,
          },
        },
      },
    }),
  };
}

export type StackedAssigneeRow = {
  asignado: string;
  Completada: number;
  Pendiente: number;
  'En Proceso': number;
};

export function buildHorizontalStackedBarChart(
  people: StackedAssigneeRow[],
  horizontal = true
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
  const indexAxis = horizontal ? ('y' as const) : ('x' as const);

  return {
    data: {
      labels: people.map((p) => p.asignado),
      datasets: [
        {
          label: 'Completadas',
          data: people.map((p) => p.Completada),
          backgroundColor: statusChartColors.completada,
          borderRadius: 0,
        },
        {
          label: 'Pendientes',
          data: people.map((p) => p.Pendiente),
          backgroundColor: statusChartColors.pendiente,
          borderRadius: 0,
        },
        {
          label: 'En proceso',
          data: people.map((p) => p['En Proceso']),
          backgroundColor: statusChartColors.enProceso,
          borderRadius: 0,
        },
      ],
    },
    options: baseChartOptions<'bar'>({
      indexAxis,
      scales: {
        x: { ...valueAxis(), stacked: true },
        y: { ...categoryAxis(), stacked: true },
      },
      plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            footer: (items) => {
              const total = items.reduce((sum, item) => sum + (item.parsed.x ?? item.parsed.y ?? 0), 0);
              const completed = items.find((i) => i.dataset.label === 'Completadas');
              const compl = completed?.parsed.x ?? completed?.parsed.y ?? 0;
              const pct = total > 0 ? Math.round((Number(compl) / total) * 100) : 0;
              return `Total: ${total} · Cumplimiento: ${pct}%`;
            },
          },
        },
      },
    }),
  };
}

export function buildSinglePersonBarChart(
  person: StackedAssigneeRow
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
  return buildHorizontalStackedBarChart(
    [
      {
        asignado: person.asignado,
        Completada: person.Completada,
        Pendiente: person.Pendiente,
        'En Proceso': person['En Proceso'],
      },
    ],
    false
  );
}

function buildSegmentArrays(points: TrendPoint[]) {
  const values = points.map((p) => p.tiempo);
  const segUp = values.map((v, i) => {
    if (i === 0) return null;
    return v >= values[i - 1] ? v : null;
  });
  const segDown = values.map((v, i) => {
    if (i === 0) return null;
    return v < values[i - 1] ? v : null;
  });
  return { values, segUp, segDown };
}

export function buildTrendTimeChart(
  points: TrendPoint[],
  yMax: number,
  isMobile: boolean
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
  const { values, segUp, segDown } = buildSegmentArrays(points);

  return {
    data: {
      labels: points.map((p) => p.period),
      datasets: [
        {
          label: 'Tiempo',
          data: values,
          borderColor: 'transparent',
          backgroundColor: 'rgba(61, 182, 224, 0.25)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          order: 3,
        },
        {
          label: 'Sube',
          data: segUp,
          borderColor: trendUpColor,
          backgroundColor: 'transparent',
          spanGaps: false,
          tension: 0.35,
          pointRadius: isMobile ? 5 : 6,
          pointHoverRadius: isMobile ? 7 : 8,
          pointBackgroundColor: '#fff',
          pointBorderColor: trendUpColor,
          pointBorderWidth: 2,
          order: 1,
        },
        {
          label: 'Baja',
          data: segDown,
          borderColor: trendDownColor,
          backgroundColor: 'transparent',
          spanGaps: false,
          tension: 0.35,
          pointRadius: isMobile ? 5 : 6,
          pointHoverRadius: isMobile ? 7 : 8,
          pointBackgroundColor: '#fff',
          pointBorderColor: trendDownColor,
          pointBorderWidth: 2,
          order: 2,
        },
        {
          label: 'Referencia',
          data: values,
          borderColor: dashboardChartTheme.secondary,
          backgroundColor: 'transparent',
          tension: 0.35,
          pointRadius: isMobile ? 5 : 6,
          pointHoverRadius: isMobile ? 7 : 8,
          pointBackgroundColor: '#fff',
          pointBorderColor: dashboardChartTheme.secondary,
          pointBorderWidth: 2,
          order: 0,
        },
      ],
    },
    options: baseChartOptions<'line'>({
      interaction: {
        mode: isMobile ? 'nearest' : 'index',
        intersect: isMobile,
      },
      scales: {
        x: categoryAxis(),
        y: {
          beginAtZero: true,
          max: yMax,
          ticks: {
            color: chartLabelColor,
            callback: (v) => formatDurationTick(Number(v)),
          },
          grid: { color: '#dce8f2' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 3 || item.dataset.label === 'Referencia',
          callbacks: {
            label: (ctx) => `Tiempo promedio: ${formatDurationTick(ctx.parsed.y ?? 0)}`,
            afterLabel: (ctx) => {
              const row = points[ctx.dataIndex];
              if (!row) return '';
              const lines = [`Tareas finalizadas: ${row.tareas}`];
              if (row.changePct != null) {
                const sign = row.changePct > 0 ? '+' : '';
                lines.push(`vs anterior: ${sign}${row.changePct.toFixed(1)}%`);
              }
              return lines;
            },
          },
        },
      },
    }),
  };
}

function formatDurationTick(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${hours.toFixed(1).replace(/\.0$/, '')} h`;
  return `${(hours / 24).toFixed(1)} días`;
}

export { STATUS_KEYS };
