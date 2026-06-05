import type { ChartData, ChartOptions } from 'chart.js';
import { dashboardChartTheme, statusChartColors } from '../../components/dashboard/chartTheme';
import {
  baseChartOptions,
  categoryAxis,
  CHART_TICK_MAX_ROTATION,
  chartAxisFont,
  chartLabelColor,
  chartLegendFont,
  countTooltip,
  trendDownColor,
  trendUpColor,
  valueAxis,
} from './defaults';

function truncateAxisLabel(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

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

/** Dona: participación de un estado frente al resto del total. */
export function buildShareDoughnut(
  value: number,
  total: number,
  activeColor: string,
  activeLabel: string,
  options?: { showLegend?: boolean; restColor?: string; emptyHint?: string }
): { data: ChartData<'pie'>; options: ChartOptions<'pie'> } {
  const restColor = options?.restColor ?? '#e2e8f0';
  const other = Math.max(0, total - value);

  let slices: PieSlice[];
  if (total === 0) {
    slices = [{ name: 'Sin datos', value: 1, color: restColor }];
  } else if (value <= 0) {
    slices = [
      {
        name: options?.emptyHint ?? `Sin ${activeLabel.toLowerCase()}`,
        value: 1,
        color: `${activeColor}55`,
      },
    ];
  } else {
    slices = [
      { name: activeLabel, value, color: activeColor },
      ...(other > 0 ? [{ name: 'Resto del periodo', value: other, color: restColor }] : []),
    ].filter((s) => s.value > 0);
  }

  return buildPieChart(slices, {
    showLegend: options?.showLegend ?? true,
    cutout: '62%',
    borderColor: 'rgba(255,255,255,0.35)',
  });
}

export function buildPieChart(
  slices: PieSlice[],
  options?: { showLegend?: boolean; cutout?: string; borderColor?: string }
): { data: ChartData<'pie'>; options: ChartOptions<'pie'> } {
  const sliceBorder = options?.borderColor ?? '#ffffff';
  return {
    data: {
      labels: slices.map((s) => s.name),
      datasets: [
        {
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => s.color),
          borderColor: sliceBorder,
          borderWidth: 2,
          hoverOffset: 6,
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
            maxRotation: opts?.rotateLabels ? CHART_TICK_MAX_ROTATION : 0,
            minRotation: opts?.rotateLabels ? CHART_TICK_MAX_ROTATION : 0,
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
  isMobile: boolean,
  opts?: {
    valueLabel?: string;
    datasetLabel?: string;
    truncateLabels?: boolean;
    compact?: boolean;
  }
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
  const valueLabel = opts?.valueLabel ?? 'tareas';
  const datasetLabel = opts?.datasetLabel ?? 'Tareas';
  const compact = opts?.compact ?? isMobile;
  const fullLabels = items.map((i) => i.label.trim());
  const maxLabelLen = compact ? 24 : 36;
  const displayLabels = opts?.truncateLabels
    ? fullLabels.map((l) => truncateAxisLabel(l, maxLabelLen))
    : fullLabels;
  const maxVal = Math.max(...items.map((i) => i.value), 1);

  return {
    data: {
      labels: displayLabels,
      datasets: [
        {
          label: datasetLabel,
          data: items.map((i) => i.value),
          backgroundColor: items.map((i) => i.color),
          hoverBackgroundColor: items.map((i) => i.color),
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: compact ? 30 : 38,
        },
      ],
    },
    options: baseChartOptions<'bar'>({
      indexAxis: 'y',
      layout: {
        padding: { top: 4, right: compact ? 8 : 12, bottom: 4, left: compact ? 0 : 4 },
      },
      scales: {
        x: {
          ...valueAxis(),
          suggestedMax: maxVal + Math.max(1, Math.ceil(maxVal * 0.12)),
          ticks: { precision: 0, stepSize: maxVal <= 10 ? 1 : undefined },
          grid: { color: '#e2e8f0' },
        },
        y: {
          ...categoryAxis(),
          grid: { display: false },
          ticks: {
            ...categoryAxis(undefined, compact).ticks,
            autoSkip: false,
            padding: compact ? 6 : 10,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (tooltipItems) =>
              fullLabels[tooltipItems[0]?.dataIndex ?? 0] ?? tooltipItems[0]?.label ?? '',
            label: (ctx) => `${ctx.parsed.x ?? 0} ${valueLabel}`,
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
            maxRotation: CHART_TICK_MAX_ROTATION,
            minRotation: CHART_TICK_MAX_ROTATION,
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

export function buildHoursLineChart(
  points: TimeSeriesPoint[],
  lineColor: string,
  formatHours: (hours: number) => string
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
  return {
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: 'Tiempo promedio',
          data: points.map((p) => p.value),
          borderColor: lineColor,
          backgroundColor: 'rgba(17, 53, 98, 0.12)',
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
        y: {
          ...valueAxis(),
          ticks: {
            callback: (value) => formatHours(Number(value)),
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => formatHours(ctx.parsed.y ?? 0),
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

export type TicketStackedRow = {
  tecnico: string;
  Abierto: number;
  'En progreso': number;
  Resuelto: number;
  Cerrado: number;
};

export const ticketStatusChartColors = {
  abierto: '#3b82f6',
  enProgreso: '#f59e0b',
  resuelto: '#22c55e',
  cerrado: '#64748b',
} as const;

export type TicketStatusLinePoint = {
  label: string;
  abierto: number;
  enProgreso: number;
  resuelto: number;
  cerrado: number;
};

function ticketStatusLineDataset(
  label: string,
  data: number[],
  color: string
): ChartData<'line'>['datasets'][number] {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: `${color}22`,
    fill: false,
    tension: 0.4,
    pointRadius: 4,
    pointHoverRadius: 7,
    pointBackgroundColor: color,
    pointBorderColor: '#ffffff',
    pointBorderWidth: 2,
    borderWidth: 2.5,
  };
}

function buildTicketStatusMultiLineChartOptions(
  mode: 'time' | 'technician',
  labelCount: number
): ChartOptions<'line'> {
  const truncateTechnician = (value: string) =>
    value.length > 14 ? `${value.slice(0, 12)}…` : value;

  return baseChartOptions<'line'>({
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        ...categoryAxis(),
          ticks: {
            ...categoryAxis().ticks,
            maxRotation: mode === 'technician' ? CHART_TICK_MAX_ROTATION : CHART_TICK_MAX_ROTATION,
            minRotation: mode === 'technician' ? 20 : 0,
          autoSkip: labelCount > 8,
          maxTicksLimit: mode === 'technician' ? 12 : 12,
          callback:
            mode === 'technician'
              ? (value) => truncateTechnician(String(value))
              : undefined,
        },
      },
      y: {
        ...valueAxis(chartLabelColor, false),
        beginAtZero: true,
        ticks: { precision: 0 },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { usePointStyle: true, padding: 16, boxWidth: 8 },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          title: (items) => {
            const idx = items[0]?.dataIndex;
            if (mode === 'technician' && typeof idx === 'number') {
              const full = items[0]?.chart?.data?.labels?.[idx];
              return full != null ? String(full) : items[0]?.label ?? '';
            }
            return items[0]?.label ?? '';
          },
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y ?? 0} casos`,
          footer: (items) => {
            const total = items.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0);
            return mode === 'technician'
              ? `Total del técnico: ${total}`
              : `Total en periodo: ${total}`;
          },
        },
      },
    },
  });
}

/** Líneas por estado a lo largo del tiempo. */
export function buildTicketStatusMultiLineChart(
  points: TicketStatusLinePoint[]
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
  const c = ticketStatusChartColors;

  return {
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        ticketStatusLineDataset('Abierto', points.map((p) => p.abierto), c.abierto),
        ticketStatusLineDataset(
          'En progreso',
          points.map((p) => p.enProgreso),
          c.enProgreso
        ),
        ticketStatusLineDataset('Resuelto', points.map((p) => p.resuelto), c.resuelto),
        ticketStatusLineDataset('Cerrado', points.map((p) => p.cerrado), c.cerrado),
      ],
    },
    options: buildTicketStatusMultiLineChartOptions('time', points.length),
  };
}

const technicianPerformanceLineColors = [
  '#8b5cf6',
  '#ec4899',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#06b6d4',
  '#e879f9',
  '#3dd6c8',
  '#ff7b8a',
  '#c084fc',
  '#fbbf24',
  '#6366f1',
] as const;

export type TechnicianPerformanceSeriesInput = {
  periodLabels: string[];
  technicians: { name: string; values: number[] }[];
};

function truncateLegendLabel(name: string, maxLen: number): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

/** Rendimiento por persona: eje X = periodo del filtro, cada línea = un técnico. */
export function buildTechnicianPerformanceLineChart(
  series: TechnicianPerformanceSeriesInput,
  options?: { compact?: boolean }
): { data: ChartData<'line'>; options: ChartOptions<'line'> } {
  const compact = options?.compact ?? false;
  const techCount = series.technicians.length;
  const maxY = Math.max(
    4,
    ...series.technicians.flatMap((t) => t.values),
    0
  );
  const legendCols = compact ? 2 : Math.min(4, Math.max(2, Math.ceil(techCount / 2)));

  return {
    data: {
      labels: series.periodLabels,
      datasets: series.technicians.map((tech, index) => {
        const color =
          technicianPerformanceLineColors[index % technicianPerformanceLineColors.length];
        const fullName = tech.name.trim();
        return {
          label: truncateLegendLabel(fullName, compact ? 16 : 22),
          fullName,
          data: tech.values,
          borderColor: color,
          backgroundColor: `${color}22`,
          fill: false,
          tension: 0.35,
          pointRadius: series.periodLabels.length <= 8 ? 5 : 3,
          pointHoverRadius: 7,
          pointBackgroundColor: color,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          borderWidth: 2.5,
        };
      }),
    },
    options: baseChartOptions<'line'>({
      interaction: { mode: 'index', intersect: false },
      layout: {
        padding: { top: 8, right: compact ? 8 : 16, bottom: 4, left: compact ? 4 : 8 },
      },
      scales: {
        x: {
          ...categoryAxis(),
          offset: series.periodLabels.length <= 12,
          ticks: {
            ...categoryAxis(undefined, compact).ticks,
            maxRotation: compact ? CHART_TICK_MAX_ROTATION : 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: compact ? 8 : 14,
          },
          grid: { display: false },
        },
        y: {
          ...valueAxis(chartLabelColor, true),
          suggestedMax: maxY + 1,
          ticks: {
            precision: 0,
            stepSize: maxY <= 10 ? 1 : undefined,
          },
          title: {
            display: !compact,
            text: 'Casos en el periodo',
            color: chartLabelColor,
            font: chartAxisFont(false),
          },
        },
      },
      plugins: {
        legend: {
          display: techCount > 0,
          position: 'bottom',
          align: 'start',
          fullSize: true,
          labels: {
            usePointStyle: true,
            pointStyle: 'circle',
            padding: compact ? 10 : 14,
            boxWidth: 8,
            boxHeight: 8,
            font: chartLegendFont(compact),
            color: chartLabelColor,
          },
          maxHeight: Math.ceil(techCount / legendCols) * (compact ? 28 : 32),
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: (items) => items[0]?.label ?? '',
            label: (ctx) => {
              const full =
                (ctx.dataset as { fullName?: string }).fullName ?? ctx.dataset.label ?? '';
              return `${full}: ${ctx.parsed.y ?? 0} casos`;
            },
          },
        },
      },
    }),
  };
}

const ticketStatusColors = ticketStatusChartColors;

export function buildTicketStatusStackedBar(
  rows: TicketStackedRow[],
  horizontal = true
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
  const indexAxis = horizontal ? ('y' as const) : ('x' as const);

  return {
    data: {
      labels: rows.map((r) => r.tecnico),
      datasets: [
        {
          label: 'Abierto',
          data: rows.map((r) => r.Abierto),
          backgroundColor: ticketStatusColors.abierto,
          borderRadius: 0,
        },
        {
          label: 'En progreso',
          data: rows.map((r) => r['En progreso']),
          backgroundColor: ticketStatusColors.enProgreso,
          borderRadius: 0,
        },
        {
          label: 'Resuelto',
          data: rows.map((r) => r.Resuelto),
          backgroundColor: ticketStatusColors.resuelto,
          borderRadius: 0,
        },
        {
          label: 'Cerrado',
          data: rows.map((r) => r.Cerrado),
          backgroundColor: ticketStatusColors.cerrado,
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
        },
      },
    }),
  };
}

export type RequestDashboardStatusStackedRow = {
  label: string;
  Abierto: number;
  'En proceso': number;
  Cerrada: number;
  Pendiente: number;
};

export const requestDashboardStatusColors = {
  abierto: '#3b82f6',
  enProceso: '#8b5cf6',
  cerrada: '#10b981',
  pendiente: '#f59e0b',
} as const;

export function buildRequestStatusStackedBar(
  rows: RequestDashboardStatusStackedRow[],
  horizontal = true,
  options?: { compact?: boolean }
): { data: ChartData<'bar'>; options: ChartOptions<'bar'> } {
  const compact = options?.compact ?? false;
  const indexAxis = horizontal ? ('y' as const) : ('x' as const);
  const fullLabels = rows.map((r) => r.label.trim());
  const displayLabels = fullLabels.map((l) => truncateAxisLabel(l, compact ? 24 : 36));
  const maxTotal = Math.max(
    4,
    ...rows.map((r) => r.Abierto + r['En proceso'] + r.Cerrada + r.Pendiente)
  );

  const datasets = [
    {
      label: 'Abiertas',
      data: rows.map((r) => r.Abierto),
      backgroundColor: requestDashboardStatusColors.abierto,
      borderRadius: 0,
      maxBarThickness: compact ? 32 : 40,
    },
    {
      label: 'En proceso',
      data: rows.map((r) => r['En proceso']),
      backgroundColor: requestDashboardStatusColors.enProceso,
      borderRadius: 0,
      maxBarThickness: compact ? 32 : 40,
    },
    {
      label: 'Cerradas',
      data: rows.map((r) => r.Cerrada),
      backgroundColor: requestDashboardStatusColors.cerrada,
      borderRadius: 0,
      maxBarThickness: compact ? 32 : 40,
    },
    {
      label: 'Pendientes',
      data: rows.map((r) => r.Pendiente),
      backgroundColor: requestDashboardStatusColors.pendiente,
      borderRadius: 0,
      maxBarThickness: compact ? 32 : 40,
    },
  ].filter((ds) => ds.data.some((v) => v > 0));

  return {
    data: {
      labels: displayLabels,
      datasets,
    },
    options: baseChartOptions<'bar'>({
      indexAxis,
      layout: {
        padding: { top: 4, right: compact ? 8 : 16, bottom: 4, left: compact ? 0 : 4 },
      },
      scales: {
        x: {
          ...valueAxis(),
          stacked: true,
          suggestedMax: maxTotal + 1,
          ticks: { precision: 0, stepSize: maxTotal <= 10 ? 1 : undefined },
          grid: { color: '#e2e8f0' },
        },
        y: {
          ...categoryAxis(),
          stacked: true,
          ticks: {
            ...categoryAxis(undefined, compact).ticks,
            autoSkip: false,
            padding: compact ? 6 : 10,
          },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          display: datasets.length > 0,
          position: 'bottom',
          align: 'center',
          labels: {
            usePointStyle: true,
            pointStyle: 'rectRounded',
            padding: compact ? 12 : 16,
            boxWidth: 10,
            boxHeight: 10,
            font: chartLegendFont(compact),
            color: chartLabelColor,
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: (items) => fullLabels[items[0]?.dataIndex ?? 0] ?? items[0]?.label ?? '',
            label: (ctx) => {
              const value = ctx.parsed.x ?? ctx.parsed.y ?? 0;
              if (value <= 0) return '';
              return `${ctx.dataset.label}: ${value}`;
            },
            footer: (items) => {
              const total = items.reduce(
                (sum, item) => sum + (item.parsed.x ?? item.parsed.y ?? 0),
                0
              );
              return total > 0 ? `Total: ${total} solicitudes` : '';
            },
          },
          filter: (item) => (item.parsed.x ?? item.parsed.y ?? 0) > 0,
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
    true
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
