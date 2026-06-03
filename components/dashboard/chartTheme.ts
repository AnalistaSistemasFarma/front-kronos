import type { CSSProperties } from 'react';

/**
 * Paleta azul SynerLink — alineada al dashboard (#113562 / #3db6e0)
 */
export const dashboardChartTheme = {
  primary: '#113562',
  secondary: '#3db6e0',
  blue900: '#0a2540',
  blue800: '#113562',
  blue700: '#1a4a7a',
  blue600: '#2569a8',
  blue500: '#2b7cb8',
  blue400: '#3db6e0',
  blue300: '#5eb3e8',
  blue200: '#7eb8e0',
  blue100: '#a8d4f0',
  blue50: '#e8f4fc',
  gridStroke: '#dce8f2',
  gridDash: '4 4',
  chartSurface:
    'linear-gradient(135deg, rgba(17, 53, 98, 0.06) 0%, rgba(61, 182, 224, 0.1) 100%)',
  /** Panel de gráficas: fondo blanco para máximo contraste */
  chartPanelBg: '#ffffff',
  chartPanelBorder: '#e2e8f0',
  gradient: { from: '#113562', to: '#3db6e0', deg: 135 as const },
  borderAccent: 'rgba(61, 182, 224, 0.4)',
  borderAccentStrong: 'rgba(61, 182, 224, 0.55)',
} as const;

/**
 * Estados con contraste alto (evitar azules muy claros en barras/números)
 */
export const statusChartColors = {
  completada: '#0f2d4a',
  pendiente: '#3d6ea8',
  enProceso: '#1eb8d4',
} as const;

/** Texto de ejes y valores — siempre oscuro, legible sobre fondo claro */
export const chartAxisTickStyle = {
  fontSize: 12,
  fontWeight: 600 as const,
  fill: '#1e293b',
};

export const chartGridProps = {
  stroke: '#cbd5e1',
  strokeDasharray: '4 4',
  vertical: false,
};

export const statusSeries = [
  { name: 'Completada', color: statusChartColors.completada, label: 'Completadas' },
  { name: 'Pendiente', color: statusChartColors.pendiente, label: 'Pendientes' },
  { name: 'En Proceso', color: statusChartColors.enProceso, label: 'En proceso' },
] as const;

/** Solo tonos con contraste suficiente en barras (sin azules muy claros) */
export const encargadoBarPalette = [
  dashboardChartTheme.blue800,
  dashboardChartTheme.blue700,
  dashboardChartTheme.blue600,
  dashboardChartTheme.blue500,
  '#2d6a9f',
  '#3d6ea8',
];

/** Colores Mantine para celdas del BarChart (entry.color) */
export const encargadoBarPaletteMantine = [
  'blue.9',
  'blue.8',
  'blue.7',
  'blue.6',
  'blue.5',
  'cyan.6',
] as const;

export const sharedGridProps = chartGridProps;

/**
 * Variables CSS de Mantine Charts (barLabelColor no se puede pasar como prop:
 * en esta versión se filtra al DOM y React avisa).
 */
export const mantineBarChartStyles = {
  root: {
    '--chart-bar-label-color': '#0f2d4a',
    '--chart-text-color': '#334155',
    '--chart-grid-color': '#cbd5e1',
  } as CSSProperties,
};

export const sharedBarChartProps = {
  barProps: { radius: 6, strokeWidth: 0 },
  fillOpacity: 1,
  gridAxis: 'y' as const,
  gridProps: chartGridProps,
  strokeDasharray: '4 4',
  tickLine: 'none' as const,
  textColor: 'dark.7',
  gridColor: 'gray.3',
  styles: mantineBarChartStyles,
};

/** Barras horizontales (encargados en eje Y) */
export const overviewBarChartProps = {
  ...sharedBarChartProps,
  gridAxis: 'x' as const,
  tickLine: 'xy' as const,
};

/** Sin banda oscura al hover — estilo ejecutivo */
export const executiveChartTooltipProps = {
  cursor: false,
} as const;

export const executiveBarChartStyles = {
  root: {
    ...mantineBarChartStyles.root,
    '--chart-cursor-fill': 'transparent',
  } as CSSProperties,
};

export const executiveBarChartProps = {
  ...overviewBarChartProps,
  tooltipProps: executiveChartTooltipProps,
  styles: executiveBarChartStyles,
};

/** Dominio del eje de valores ajustado al máximo real */
export function getChartValueDomain(max: number): [number, number] {
  if (max <= 0) return [0, 4];
  const padded = Math.ceil(max * 1.2);
  if (padded <= 6) return [0, Math.max(padded, max + 1)];
  const step = padded <= 20 ? 5 : 10;
  return [0, Math.ceil(padded / step) * step];
}

export function getEncargadoOverviewHeight(count: number): number {
  return getResponsiveChartHeight(count, false);
}

/** Altura del área del gráfico según cantidad de filas y viewport */
export function getResponsiveChartHeight(count: number, compact: boolean): number {
  const perRow = compact ? 42 : 56;
  const padding = compact ? 52 : 72;
  const min = compact ? 120 : 160;
  const max = compact ? 280 : 420;
  return Math.min(Math.max(min, count * perRow + padding), max);
}

export function getEncargadoYAxisWidth(names: string[]): number {
  return getResponsiveYAxisWidth(names, false);
}

export function getResponsiveYAxisWidth(names: string[], compact: boolean): number {
  const maxLen = Math.max(...names.map((n) => n.length), 8);
  if (compact) {
    return Math.min(Math.max(maxLen * 5.5, 72), 100);
  }
  return Math.min(Math.max(maxLen * 7.5, 110), 220);
}

export const compactAxisTickStyle = {
  fontSize: 10,
  fontWeight: 600 as const,
  fill: '#1e293b',
};

export function buildCategoryYAxisProps(width: number, compact: boolean) {
  return {
    width,
    tick: compact ? compactAxisTickStyle : chartAxisTickStyle,
    axisLine: false,
    tickLine: false,
    tickFormatter: compact
      ? (value: string) => (value.length > 14 ? `${value.slice(0, 12)}…` : value)
      : undefined,
  };
}

export function overviewValueAxisProps(maxValue: number) {
  const [, top] = getChartValueDomain(maxValue);
  return {
    domain: [0, top] as [number, number],
    allowDecimals: false,
    tick: chartAxisTickStyle,
    axisLine: { stroke: '#94a3b8' },
  };
}

export function buildValueXAxisProps(maxValue: number, compact: boolean) {
  return {
    ...overviewValueAxisProps(maxValue),
    tick: compact ? compactAxisTickStyle : chartAxisTickStyle,
  };
}

export function overviewCategoryAxisProps(width: number) {
  return buildCategoryYAxisProps(width, false);
}

export const detailChartMargins = {
  top: 12,
  right: 16,
  left: 4,
  bottom: 72,
};

/** Altura fija para barras verticales (evita scroll vertical excesivo) */
export const ENCARGADO_OVERVIEW_CHART_HEIGHT = 300;
export const ENCARGADO_DETAIL_CHART_HEIGHT = 320;

/** Etiquetas del eje X con nombres largos (barras verticales) */
export function verticalBarXAxisProps(maxLabelLen = 18) {
  return {
    angle: -35,
    textAnchor: 'end' as const,
    height: 80,
    interval: 0,
    tick: chartAxisTickStyle,
    tickFormatter: (value: string) =>
      value.length > maxLabelLen ? `${value.slice(0, maxLabelLen - 2)}…` : value,
  };
}

export const chartYAxisProps = {
  allowDecimals: false,
  tick: chartAxisTickStyle,
  axisLine: { stroke: '#94a3b8' },
};

export function getStatusColor(estado: string): string {
  switch (estado) {
    case 'Completada':
      return statusChartColors.completada;
    case 'En Proceso':
      return statusChartColors.enProceso;
    case 'Pendiente':
    default:
      return statusChartColors.pendiente;
  }
}

export function getStatusBadgeStyle(estado: string): {
  variant: 'light' | 'filled';
  styles: { root: CSSProperties };
} {
  const bg = getStatusColor(estado);
  const isLight = estado === 'Pendiente';
  return {
    variant: isLight ? 'light' : 'filled',
    styles: {
      root: {
        backgroundColor: isLight ? dashboardChartTheme.blue50 : bg,
        color: isLight ? dashboardChartTheme.blue800 : '#fff',
        border: isLight ? `1px solid ${dashboardChartTheme.blue200}` : undefined,
      },
    },
  };
}
