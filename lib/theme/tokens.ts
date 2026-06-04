/** Tokens de diseño SynerLink — claro y oscuro */

export type AppTheme = 'light' | 'dark';

export type AppThemeTokens = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  header: string;
  text: string;
  textMuted: string;
  border: string;
  borderSubtle: string;
  chartText: string;
  chartGrid: string;
  chartPanel: string;
  chartTooltipBg: string;
  icon: string;
  accent: string;
  accentHover: string;
  /** Sombra de tarjetas */
  cardShadow: string;
};

export const lightTokens: AppThemeTokens = {
  bg: '#eef1f5',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  header: '#ffffff',
  text: '#1a1d21',
  textMuted: '#5c6370',
  border: '#d8dee6',
  borderSubtle: '#e8ecf1',
  chartText: '#334155',
  chartGrid: '#cbd5e1',
  chartPanel: '#ffffff',
  chartTooltipBg: '#ffffff',
  icon: '#4b5563',
  accent: '#2563eb',
  accentHover: '#1d4ed8',
  cardShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
};

/**
 * Oscuro estilo dashboard analítico: fondo navy profundo, tarjetas en capas,
 * acentos vibrantes (azul, coral, teal, violeta) — legible y corporativo.
 */
export const darkTokens: AppThemeTokens = {
  bg: '#151c2e',
  surface: '#1f2840',
  surfaceRaised: '#283352',
  header: '#121824',
  text: '#f0f4ff',
  textMuted: '#9ca8c7',
  border: 'rgba(255, 255, 255, 0.12)',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  chartText: '#e2e8f8',
  chartGrid: 'rgba(255, 255, 255, 0.1)',
  chartPanel: '#1f2840',
  chartTooltipBg: '#283352',
  icon: '#c5d0e6',
  accent: '#5eb3e8',
  accentHover: '#7ec8ef',
  cardShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
};

/** Gradientes para KPIs en modo oscuro (como tarjetas de métricas del referente) */
export const darkKpiGradients = [
  'linear-gradient(135deg, #1d4ed8 0%, #22d3ee 100%)',
  'linear-gradient(135deg, #ea580c 0%, #fb7185 100%)',
  'linear-gradient(135deg, #0d9488 0%, #2dd4bf 100%)',
  'linear-gradient(135deg, #6d28d9 0%, #e879f9 100%)',
] as const;

/** Gradientes por estado (Completadas, Pendientes, En proceso) */
export const statusKpiGradients = {
  completada: 'linear-gradient(135deg, #0d9488 0%, #2dd4bf 100%)',
  pendiente: 'linear-gradient(135deg, #ea580c 0%, #fb7185 100%)',
  enProceso: 'linear-gradient(135deg, #2563eb 0%, #22d3ee 100%)',
} as const;

export type StatusKpiGradientKey = keyof typeof statusKpiGradients;

/** Colores sólidos vivos para barras y donas (alto contraste en oscuro) */
export const statusChartVibrantColors = {
  completada: '#2dd4bf',
  pendiente: '#fb7185',
  enProceso: '#38bdf8',
} as const;

/** Paleta de series para gráficas en oscuro */
export const darkChartSeriesColors = [
  '#5b9cff',
  '#ff7b8a',
  '#3dd6c8',
  '#c084fc',
  '#fbbf24',
  '#f472b6',
] as const;

export function getAppTokens(theme: AppTheme): AppThemeTokens {
  return theme === 'dark' ? darkTokens : lightTokens;
}

export function kpiGradientIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i)) % darkKpiGradients.length;
  }
  return hash;
}

export function tokensToCssVariables(tokens: AppThemeTokens): Record<string, string> {
  return {
    '--app-bg': tokens.bg,
    '--app-surface': tokens.surface,
    '--app-surface-raised': tokens.surfaceRaised,
    '--app-header': tokens.header,
    '--app-text': tokens.text,
    '--app-text-muted': tokens.textMuted,
    '--app-border': tokens.border,
    '--app-border-subtle': tokens.borderSubtle,
    '--chart-text': tokens.chartText,
    '--chart-grid': tokens.chartGrid,
    '--chart-panel': tokens.chartPanel,
    '--chart-tooltip-bg': tokens.chartTooltipBg,
    '--app-icon': tokens.icon,
    '--app-accent': tokens.accent,
    '--app-accent-hover': tokens.accentHover,
    '--app-card-shadow': tokens.cardShadow,
    '--background': tokens.bg,
    '--foreground': tokens.text,
    '--surface': tokens.surface,
    '--surface-muted': tokens.surfaceRaised,
    '--border-subtle': tokens.border,
  };
}
