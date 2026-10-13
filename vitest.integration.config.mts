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
    // Las pruebas de integración del SGC se escribieron con la política más estricta de asignación
    // de firmantes (quien crea el documento Y Calidad). Desde el 2026-10-10 el código usa por defecto
    // `tarea_o_calidad` (RN 2026-10-05); aquí se fija la estricta para que sigan ejerciendo esos bloqueos.
    env: { SGC_ASIGNACION_PERMISO: 'tarea_y_calidad' },
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
