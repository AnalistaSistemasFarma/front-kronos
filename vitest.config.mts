import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config mínima de Vitest para las pruebas unitarias del front (raíz).
// Solo cubrimos utilidades PURAS de `lib/` (sin dependencias de BD/red).
// El servidor MCP tiene su propia suite en `mcp/` (no se incluye aquí).
export default defineConfig({
  // El tsconfig de Next usa jsx «preserve»; para la prueba de paridad (render de
  // componentes .tsx en Node) Vitest debe transformar el JSX.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      // Replica el path alias "@/*" del tsconfig para que los imports funcionen.
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` lanza en runtime de cliente; en Vitest (Node) es un no-op.
      'server-only': fileURLToPath(new URL('./vitest.server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // `app/api/sgc/**`: pruebas de las rutas del SGC documental (con sesión y
    // base simuladas); son evidencia de validación del módulo.
    // `components/sgc/**`: prueba de PARIDAD de las pantallas copiadas de SynerLink (render del marcado).
    include: [
      'lib/**/*.test.ts',
      'app/api/sgc/**/*.test.ts',
      // `app/api/authorization/**`: rutas de Autorizaciones (sesión obligatoria, anti-IDOR).
      'app/api/authorization/**/*.test.ts',
      // `app/api/portal/politicas/**`: Políticas y reglamentos del Portal TH (sesión obligatoria, Graph simulado).
      'app/api/portal/**/*.test.ts',
      // `app/api/bitacora-proceso/**`: Órdenes de Trabajo (permisos en el servidor, sin edición ni borrado).
      'app/api/bitacora-proceso/**/*.test.ts',
      // `app/api/firma-gss/**`: «Mi firma» en GSS Firma (solo la propia, reautenticación, imagen saneada).
      'app/api/firma-gss/**/*.test.ts',
      // `app/api/correo/**`: módulo Correo (sesión y permiso, aislamiento por persona, límites; Graph simulado).
      'app/api/correo/**/*.test.ts',
      'components/sgc/**/*.test.ts',
    ],
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
        // SGC documental: reglas de negocio con umbral propio (ver abajo).
        'lib/sgc/**/*.ts',
        'app/api/sgc/**/route.ts',
        // Órdenes de Trabajo: reglas puras y rutas (la capa de datos se prueba en integración).
        'lib/bitacora-proceso/constants.ts',
        'lib/bitacora-proceso/rules.ts',
        'lib/bitacora-proceso/firmas.ts',
        'lib/bitacora-proceso/notificaciones.ts',
        'lib/bitacora-proceso/pin.ts',
        'app/api/bitacora-proceso/**/route.ts',
        // Firma GSS: saneamiento de la imagen y registro de la firma propia.
        'lib/firma-gss/png.ts',
        'lib/firma-gss/sniff.ts',
        'lib/firma-gss/miFirma.ts',
        'app/api/firma-gss/**/route.ts',
        // Módulo Correo: reglas, saneado, Graph, OAuth, cifrado, servicio y rutas (la capa de datos, en integración).
        'lib/correo/config.ts',
        'lib/correo/crypto.ts',
        'lib/correo/graph.ts',
        'lib/correo/oauth.ts',
        'lib/correo/rules.ts',
        'lib/correo/sanitize.ts',
        'lib/correo/service.ts',
        'lib/correo/mock.ts',
        // «Consultar a un agente» (2026-10-16): concesión, tarjetas y confirmación.
        'lib/correo/agente.ts',
        // Deslizar para eliminar (2026-10-18): mover a Elementos eliminados y «Deshacer» firmado.
        'lib/correo/eliminar.ts',
        'app/api/correo/**/route.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/*.tsx',
        'lib/charts/**',
        '**/index.ts',
        // SGC: la capa de base de datos (lib/sgc/db/**) se mide con las
        // pruebas de INTEGRACIÓN contra un SQL Server real (piso propio en
        // vitest.integration.config.mts), que es la evidencia que vale para
        // ella; simularla aquí con dobles no probaría nada.
        'lib/sgc/db/**',
        // Contexto de sesión de las rutas: se ejerce a través de las pruebas
        // de rutas (app/api/sgc/__tests__) y no es una ruta en sí.
        'app/api/sgc/_lib/**',
      ],
      // PISO (ratchet), fijado por debajo de la cobertura real medida.
      thresholds: {
        lines: 65,
        functions: 68,
        statements: 65,
        branches: 57,
        // SGC documental (sistema validado ante el INVIMA): piso propio de
        // 90 % en reglas de negocio. Mismo criterio "ratchet": solo sube.
        'lib/sgc/**/*.ts': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
      },
    },
  },
});
