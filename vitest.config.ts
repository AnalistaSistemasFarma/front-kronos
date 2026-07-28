import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config mínima de Vitest para las pruebas unitarias del front (raíz).
// Solo cubrimos utilidades PURAS de `lib/` (sin dependencias de BD/red).
// El servidor MCP tiene su propia suite en `mcp/` (no se incluye aquí).
export default defineConfig({
  resolve: {
    alias: {
      // Replica el path alias "@/*" del tsconfig para que los imports funcionen.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'mcp', 'dist'],

    // -----------------------------------------------------------------------
    // Cobertura (Fase 2 del plan de control de calidad).
    //
    // Medimos SOLO los archivos de `lib/**` que la suite actual ejercita de
    // verdad (utilidades y transformaciones puras). Acotar el `include` a esos
    // archivos hace que el % reportado sea SIGNIFICATIVO (cobertura del código
    // bajo prueba) en lugar de quedar diluido a ~14% por decenas de módulos
    // que aún no tienen ninguna prueba y por archivos acoplados a React/DOM
    // (`*.tsx`, `charts/**`, contextos) que hoy no se pueden cubrir sin jsdom.
    //
    // Cobertura real medida (2026-07-28, 102 pruebas):
    //   Statements 67.03% · Branches 60.15% · Functions 71% · Lines 67.52%
    //
    // Los umbrales de abajo son un "ratchet": un PISO ligeramente por debajo de
    // esos valores. La compuerta solo puede exigir MÁS con el tiempo, nunca
    // menos. Cuando agregue archivos con pruebas, súmelos a `include` y suba el
    // piso; NUNCA baje los umbrales para "apagar" una falla de cobertura.
    // -----------------------------------------------------------------------
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      include: [
        'lib/onedriveName.ts',
        'lib/dashboard/dateRange.ts',
        'lib/dashboard/requestResolution.ts',
        'lib/dashboard/requestStatus.ts',
        'lib/dashboard/resolutionTimeSeries.ts',
        'lib/dashboard/viewTasksQuery.ts',
        'lib/help-desk/contactEmail.ts',
        'lib/help-desk/ticketDisplay.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/*.tsx',
        'lib/charts/**',
        '**/index.ts',
      ],
      // PISO (ratchet), fijado por debajo de la cobertura real medida.
      thresholds: {
        lines: 65,
        functions: 68,
        statements: 65,
        branches: 57,
      },
    },
  },
});
