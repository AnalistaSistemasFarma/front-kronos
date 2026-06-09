import { getAppTokens, tokensToCssVariables, type AppTheme } from './tokens';

export const APP_THEME_STORAGE_KEY = 'theme';

export type { AppTheme };

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
