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
  },
});
