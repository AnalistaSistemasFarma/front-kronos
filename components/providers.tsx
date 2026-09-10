'use client';

import { MantineProvider } from '@mantine/core';
import { SessionProvider, useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
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
  applyLandingAppearanceToDocument,
  isPublicLandingPath,
  readStoredAppTheme,
  type AppTheme,
} from '../lib/theme/constants';
import {
  DEFAULT_PALETTE_KEY,
  PALETTE_STORAGE_KEY,
  applyPaletteAppearanceToDocument,
  applyPaletteToDocument,
  isValidPaletteKey,
  readStoredPalette,
  resolvePrimaryColor,
} from '../lib/theme/palettes';
import {
  mantineTupleFromHex,
  parseCustomPaletteHex,
} from '../lib/theme/customPalette';
import { UserProvider } from '../lib/user-context';
import { SapProvider } from '../lib/sap-context';
import {
  appCssVariablesResolver,
  buildDarkTheme,
  buildLightTheme,
} from '../lib/theme/mantineTheme';
import { runThemeTransition } from '../lib/theme/motion';
import {
  DEFAULT_FONT_KEY,
  FONT_STORAGE_KEY,
  applyFontToDocument,
  isValidFontKey,
  readStoredFont,
} from '../lib/theme/fonts';

interface ThemeContextType {
  theme: AppTheme;
  toggleTheme: () => void;
  /** Modo claro/oscuro explícito */
  setThemeMode: (mode: AppTheme) => void;
  /** Clave de la paleta de color activa */
  palette: string;
  /** Cambia la paleta de color activa */
  setPalette: (key: string) => void;
  /** Clave de la tipografía activa */
  font: string;
  /** Cambia la tipografía activa */
  setFont: (key: string) => void;
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
  const pathname = usePathname();
  const isLanding = isPublicLandingPath(pathname);
  const [theme, setTheme] = useState<AppTheme>('light');
  const [palette, setPaletteState] = useState<string>(DEFAULT_PALETTE_KEY);
  const [font, setFontState] = useState<string>(DEFAULT_FONT_KEY);
  const [mounted, setMounted] = useState(false);
  const visualTheme: AppTheme = isLanding ? 'light' : theme;
  const visualPalette = isLanding ? DEFAULT_PALETTE_KEY : palette;
  // La portada es pública y no debe heredar preferencias de nadie.
  const visualFont = isLanding ? DEFAULT_FONT_KEY : font;

  // Estado inicial desde localStorage (antes de que llegue la sesión)
  useEffect(() => {
    setTheme(readStoredAppTheme() ?? 'light');
    setPaletteState(readStoredPalette() ?? DEFAULT_PALETTE_KEY);
    // Desde localStorage primero: así la tipografía no pega un salto visible
    // mientras llega la sesión.
    setFontState(readStoredFont() ?? DEFAULT_FONT_KEY);
    setMounted(true);
  }, []);

  // Sincroniza con lo persistido en el perfil cuando llega la sesión
  const sessionPalette = session?.user?.themePalette;
  const sessionColorScheme = session?.user?.colorScheme;
  const sessionFont = session?.user?.uiFont;
  useEffect(() => {
    if (!mounted) return;
    if (isValidPaletteKey(sessionPalette)) {
      setPaletteState(sessionPalette);
    }
    if (sessionColorScheme === 'light' || sessionColorScheme === 'dark') {
      setTheme(sessionColorScheme);
    }
    if (isValidFontKey(sessionFont)) {
      setFontState(sessionFont);
    }
  }, [sessionPalette, sessionColorScheme, sessionFont, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    if (isLanding) {
      applyLandingAppearanceToDocument();
      return;
    }
    document.documentElement.removeAttribute('data-landing');
    applyAppThemeToDocument(theme);
  }, [theme, mounted, isLanding]);

  // Debe correr DESPUÉS del efecto de tema: el tinte/acento de la paleta
  // sobrescribe las variables base de superficie/acento por modo.
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    if (isLanding) {
      applyLandingAppearanceToDocument();
      return;
    }
    applyPaletteToDocument(palette);
    applyPaletteAppearanceToDocument(palette, theme);
  }, [palette, theme, mounted, isLanding]);

  // Independiente del tema y de la paleta: la tipografía solo redefine
  // --font-sans en :root, y de ahí la toman el CSS propio y Mantine.
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(FONT_STORAGE_KEY, font);
    applyFontToDocument(visualFont);
  }, [font, visualFont, mounted]);

  const setThemeMode = (mode: AppTheme) => {
    if (mode === theme) return;
    runThemeTransition(() => setTheme(mode));
  };
  const toggleTheme = () => {
    runThemeTransition(() => {
      setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
    });
  };
  const setPalette = (key: string) => {
    if (isValidPaletteKey(key)) setPaletteState(key);
  };
  const setFont = (key: string) => {
    if (isValidFontKey(key)) setFontState(key);
  };

  const primaryColor = resolvePrimaryColor(visualPalette);
  const mantineTheme = useMemo(() => {
    const hex = parseCustomPaletteHex(visualPalette);
    const customColors = hex ? mantineTupleFromHex(hex) : undefined;
    return visualTheme === 'dark'
      ? buildDarkTheme(primaryColor, customColors)
      : buildLightTheme(primaryColor, customColors);
  }, [visualTheme, primaryColor, visualPalette]);

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, setThemeMode, palette, setPalette, font, setFont }}
    >
      <MantineProvider
        theme={mantineTheme}
        forceColorScheme={visualTheme}
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
