import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo (Playwright). Hoy cubren el SGC documental
 * (e2e/sgc); sus reportes son evidencia de validación del sistema.
 *
 * Contra qué corre:
 *   - E2E_BASE_URL definido  → ese servidor (p.ej. pruebas en la .230).
 *   - sin E2E_BASE_URL        → levanta `next start` local en el puerto 3100
 *                               (el build ya debe existir: `npm run build`).
 * Las pruebas con sesión necesitan E2E_USER_EMAIL / E2E_USER_PASSWORD de un
 * usuario de pruebas; sin ellas se omiten (no fallan).
 *
 * Reportes: reports/playwright/html (con capturas y trazas) y
 * reports/playwright/junit.xml. La CI los archiva como artefacto.
 */
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';

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
    trace: 'on',
    screenshot: 'on',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx next start -p 3100',
        url: 'http://127.0.0.1:3100/login',
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
