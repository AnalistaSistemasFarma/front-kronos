import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Pruebas de INTEGRACIÓN contra un SQL Server real (efímero en CI: contenedor
// oficial de Microsoft; ver el job "SGC — integración" de .github/workflows/ci.yml).
// Requieren SGC_IT_DATABASE_URL; sin ella se omiten.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'server-only': fileURLToPath(new URL('./vitest.server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    // Cobertura de la capa de base de datos del SGC (solo se ejerce contra un
    // SQL Server real). Mismo criterio "ratchet" que la unitaria: solo sube.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'reports/integracion/coverage',
      include: ['lib/sgc/db/**/*.ts', 'lib/sgc/access.ts'],
      // Medido en CI el 2026-09-30 (S1): líneas 98,48 %, sentencias 98,18 %,
      // funciones 96,36 %, ramas 88,67 %. Piso un poco por debajo.
      thresholds: {
        lines: 95,
        functions: 92,
        statements: 95,
        branches: 85,
      },
    },
  },
});
