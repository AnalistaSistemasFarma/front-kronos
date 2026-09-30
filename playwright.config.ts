import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo (Playwright). Hoy cubren el SGC documental
 * (e2e/sgc); sus reportes son evidencia de validación del sistema.
 *
 * Contra qué corre:
 *   - E2E_BASE_URL definido  → ese servidor (p.ej. pruebas en la .230).
 *   - sin E2E_BASE_URL        → levanta `next start` local en el puerto 3100
 *                               (el build ya debe existir: `npm run build`).
 *
 * Proyectos:
 *   - publico     → pruebas sin sesión (siempre).
 *   - setup       → inicia sesión UNA vez con el usuario de pruebas y guarda
 *                   la sesión (storageState). Corre con trace y capturas
 *                   APAGADAS: la traza de Playwright guarda en claro lo que se
 *                   escribe, incluida la contraseña, y la CI archiva los
 *                   reportes 90 días.
 *   - con-sesion  → pruebas *.session.spec.ts con esa sesión; nunca escriben
 *                   la contraseña, así que su traza no la contiene.
 *   (S2) Con E2E_USER_EMAIL2/3 y E2E_USER_PASSWORD2/3, `setup` también deja
 *   las sesiones 2 y 3 para el recorrido con varios revisores y aprobadores.
 * setup y con-sesion solo existen si hay E2E_USER_EMAIL y E2E_USER_PASSWORD.
 *
 * Reportes: reports/playwright/html (con capturas y trazas) y
 * reports/playwright/junit.xml. La CI los archiva como artefacto.
 */
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
const hasUser = !!process.env.E2E_USER_EMAIL && !!process.env.E2E_USER_PASSWORD;
export const STORAGE_STATE = 'reports/playwright/.auth/sesion.json';
// Sprint 2: segundo y tercer usuario de pruebas (revisores/aprobadores del recorrido documental).
export const STORAGE_STATE_2 = 'reports/playwright/.auth/sesion2.json';
export const STORAGE_STATE_3 = 'reports/playwright/.auth/sesion3.json';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright/html', open: 'never' }],
    ['junit', { outputFile: 'reports/playwright/junit.xml' }],
  ],
  outputDir: 'reports/playwright/artefactos',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'on',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  },
  projects: [
    {
      name: 'publico',
      testIgnore: [/\.setup\.ts$/, /\.session\.spec\.ts$/],
      use: { ...devices['Desktop Chrome'] },
    },
    ...(hasUser
      ? [
          {
            name: 'setup',
            testMatch: /\.setup\.ts$/,
            use: { ...devices['Desktop Chrome'], trace: 'off' as const, screenshot: 'off' as const, video: 'off' as const },
          },
          {
            name: 'con-sesion',
            testMatch: /\.session\.spec\.ts$/,
            dependencies: ['setup'],
            use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
          },
        ]
      : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx next start -p 3100',
        url: 'http://127.0.0.1:3100/login',
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
