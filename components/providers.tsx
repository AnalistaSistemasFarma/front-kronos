'use client';

import { MantineProvider } from '@mantine/core';
import { SessionProvider, useSession } from 'next-auth/react';
import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  APP_THEME_STORAGE_KEY,
  applyAppThemeToDocument,
  readStoredAppTheme,
  type AppTheme,
} from '../lib/theme/constants';
import {
  DEFAULT_PALETTE_KEY,
  PALETTE_STORAGE_KEY,
  applyPaletteToDocument,
  isValidPaletteKey,
  readStoredPalette,
  resolvePrimaryColor,
} from '../lib/theme/palettes';
import { UserProvider } from '../lib/user-context';
import { SapProvider } from '../lib/sap-context';
import {
  appCssVariablesResolver,
  buildDarkTheme,
  buildLightTheme,
} from '../lib/theme/mantineTheme';

interface ThemeContextType {
  theme: AppTheme;
  toggleTheme: () => void;
  /** Modo claro/oscuro explícito */
  setThemeMode: (mode: AppTheme) => void;
  /** Clave de la paleta de color activa */
  palette: string;
  /** Cambia la paleta de color activa */
  setPalette: (key: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [theme, setTheme] = useState<AppTheme>('light');
  const [palette, setPaletteState] = useState<string>(DEFAULT_PALETTE_KEY);
  const [mounted, setMounted] = useState(false);

  // Estado inicial desde localStorage (antes de que llegue la sesión)
  useEffect(() => {
    setTheme(readStoredAppTheme() ?? 'light');
    setPaletteState(readStoredPalette() ?? DEFAULT_PALETTE_KEY);
    setMounted(true);
  }, []);

  // Sincroniza con lo persistido en el perfil cuando llega la sesión
  const sessionPalette = session?.user?.themePalette;
  const sessionColorScheme = session?.user?.colorScheme;
  useEffect(() => {
    if (!mounted) return;
    if (isValidPaletteKey(sessionPalette)) {
      setPaletteState(sessionPalette);
    }
    if (sessionColorScheme === 'light' || sessionColorScheme === 'dark') {
      setTheme(sessionColorScheme);
    }
  }, [sessionPalette, sessionColorScheme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    applyAppThemeToDocument(theme);
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    applyPaletteToDocument(palette);
  }, [palette, mounted]);

  const setThemeMode = (mode: AppTheme) => setTheme(mode);
  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };
  const setPalette = (key: string) => {
    if (isValidPaletteKey(key)) setPaletteState(key);
  };

  const primaryColor = resolvePrimaryColor(palette);
  const mantineTheme = useMemo(
    () => (theme === 'dark' ? buildDarkTheme(primaryColor) : buildLightTheme(primaryColor)),
    [theme, primaryColor],
  );

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, setThemeMode, palette, setPalette }}
    >
      <MantineProvider
        theme={mantineTheme}
        forceColorScheme={theme}
        cssVariablesResolver={appCssVariablesResolver}
        defaultColorScheme='light'
      >
        {children}
      </MantineProvider>
    </ThemeContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <ThemeProvider>
        <UserProvider>
          <SapProvider>{children}</SapProvider>
        </UserProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
