import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // La suite cubre las 49 herramientas: «Consultar a un agente» encendido (en producción va apagado
    // por defecto; test/correo-agente-bandera.test.ts prueba el apagado).
    env: { CORREO_AGENTE_HABILITADO: 'true' },
  },
});
