import { defineConfig } from 'vitest/config';

// Integración del MCP contra un SQL Server real (CI: job «SGC — integración», con la base efímera
// ya migrada). Requiere SGC_IT_DATABASE_URL; sin ella se omite.
export default defineConfig({
  test: {
    include: ['test-integracion/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // La suite cubre las 39 herramientas: «Consultar a un agente» encendido (en producción va apagado
    // por defecto; test/correo-agente-bandera.test.ts prueba el apagado).
    env: { CORREO_AGENTE_HABILITADO: 'true' },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
