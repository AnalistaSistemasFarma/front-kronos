import {
  createTheme,
  defaultCssVariablesResolver,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';
import { darkTokens, lightTokens } from './tokens';

/** Escala dark navy (alineada a --app-bg / --app-surface) */
const appDark: MantineColorsTuple = [
  '#f0f4ff',
  '#e2e8f8',
  '#c5d0e6',
  '#9ca8c7',
  '#6b7a9e',
  '#4a5672',
  '#354060',
  '#283352',
  '#1f2840',
  '#151c2e',
];

const shared = {
  primaryColor: 'blue' as const,
  defaultRadius: 'md' as const,
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: '700',
  },
  autoContrast: true,
  luminanceThreshold: 0.35,
};

export const lightMantineTheme = createTheme({
  ...shared,
  white: '#ffffff',
  black: '#1a1d21',
  colors: {
    dark: appDark,
  },
});

export const darkMantineTheme = createTheme({
  ...shared,
  white: '#f0f4ff',
  black: '#121824',
  colors: {
    dark: appDark,
  },
});

export const appCssVariablesResolver: CSSVariablesResolver = (theme) => {
  const base = defaultCssVariablesResolver(theme);

  return {
    variables: {
      ...base.variables,
    },
    light: {
      ...base.light,
      '--mantine-color-body': lightTokens.bg,
      '--mantine-color-text': lightTokens.text,
      '--mantine-color-dimmed': lightTokens.textMuted,
      '--mantine-color-default': lightTokens.surface,
      '--mantine-color-default-hover': '#f4f6f8',
      '--mantine-color-default-color': lightTokens.text,
      '--mantine-color-default-border': lightTokens.border,
      '--mantine-color-bright': lightTokens.text,
      '--app-bg': lightTokens.bg,
      '--app-surface': lightTokens.surface,
      '--app-surface-raised': lightTokens.surfaceRaised,
      '--app-header': lightTokens.header,
      '--app-text': lightTokens.text,
      '--app-text-muted': lightTokens.textMuted,
      '--app-border': lightTokens.border,
      '--app-border-subtle': lightTokens.borderSubtle,
      '--chart-text': lightTokens.chartText,
      '--chart-grid': lightTokens.chartGrid,
      '--chart-panel': lightTokens.chartPanel,
      '--background': lightTokens.bg,
      '--foreground': lightTokens.text,
      '--surface': lightTokens.surface,
    },
    dark: {
      ...base.dark,
      '--mantine-color-body': darkTokens.bg,
      '--mantine-color-text': darkTokens.text,
      '--mantine-color-dimmed': darkTokens.textMuted,
      '--mantine-color-default': darkTokens.surface,
      '--mantine-color-default-hover': darkTokens.surfaceRaised,
      '--mantine-color-default-color': darkTokens.text,
      '--mantine-color-default-border': darkTokens.border,
      '--mantine-color-bright': darkTokens.text,
      '--mantine-color-anchor': darkTokens.accent,
      '--app-bg': darkTokens.bg,
      '--app-surface': darkTokens.surface,
      '--app-surface-raised': darkTokens.surfaceRaised,
      '--app-header': darkTokens.header,
      '--app-text': darkTokens.text,
      '--app-text-muted': darkTokens.textMuted,
      '--app-border': darkTokens.border,
      '--app-border-subtle': darkTokens.borderSubtle,
      '--chart-text': darkTokens.chartText,
      '--chart-grid': darkTokens.chartGrid,
      '--chart-panel': darkTokens.chartPanel,
      '--chart-tooltip-bg': darkTokens.chartTooltipBg,
      '--app-accent': darkTokens.accent,
      '--app-accent-hover': darkTokens.accentHover,
      '--app-card-shadow': darkTokens.cardShadow,
      '--background': darkTokens.bg,
      '--foreground': darkTokens.text,
      '--surface': darkTokens.surface,
    },
  };
};
