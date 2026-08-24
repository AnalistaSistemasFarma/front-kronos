import { getAppTokens, tokensToCssVariables, type AppTheme } from './tokens';

export const APP_THEME_STORAGE_KEY = 'theme';

/** La portada pública no hereda tema ni paleta del usuario. */
export function isPublicLandingPath(pathname: string | null | undefined): boolean {
  return pathname === '/';
}

export type { AppTheme };

/** Tokens fijos de la portada: blanco, sin paleta ni modo oscuro. */
export const LANDING_CSS_VARS: Record<string, string> = {
  '--app-bg': '#ffffff',
  '--background': '#ffffff',
  '--mantine-color-body': '#ffffff',
  '--app-surface': '#ffffff',
  '--surface': '#ffffff',
  '--app-surface-raised': '#f8f9fa',
  '--surface-muted': '#f8f9fa',
  '--app-header': '#ffffff',
  '--app-text': '#1a1d21',
  '--foreground': '#1a1d21',
  '--app-text-muted': '#4b5563',
  '--mantine-color-text': '#1a1d21',
  '--mantine-color-dimmed': '#6b7280',
  '--app-border': '#e5e7eb',
  '--app-border-subtle': '#e5e7eb',
  '--app-accent': '#113562',
  '--app-accent-hover': '#0d2a4d',
  '--mantine-color-anchor': '#113562',
};

export function applyLandingAppearanceToDocument() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-landing', 'true');
  root.setAttribute('data-theme', 'light');
  root.setAttribute('data-mantine-color-scheme', 'light');
  root.classList.remove('dark');
  root.style.colorScheme = 'light';
  for (const [key, value] of Object.entries(LANDING_CSS_VARS)) {
    root.style.setProperty(key, value);
  }
}

export function applyAppThemeToDocument(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const tokens = getAppTokens(theme);

  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mantine-color-scheme', theme);
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;

  const vars = tokensToCssVariables(tokens);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export function readStoredAppTheme(): AppTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}
