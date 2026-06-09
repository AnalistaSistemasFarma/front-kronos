'use client';

import { MantineProvider } from '@mantine/core';
import { SessionProvider } from 'next-auth/react';
import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import {
  APP_THEME_STORAGE_KEY,
  applyAppThemeToDocument,
  readStoredAppTheme,
  type AppTheme,
} from '../lib/theme/constants';
import { UserProvider } from '../lib/user-context';
import { SapProvider } from '../lib/sap-context';
import {
  appCssVariablesResolver,
  darkMantineTheme,
  lightMantineTheme,
} from '../lib/theme/mantineTheme';

interface ThemeContextType {
  theme: AppTheme;
  toggleTheme: () => void;
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
  const [theme, setTheme] = useState<AppTheme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readStoredAppTheme() ?? 'light');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    applyAppThemeToDocument(theme);
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <MantineProvider
        theme={theme === 'dark' ? darkMantineTheme : lightMantineTheme}
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
