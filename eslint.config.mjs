import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import securityPlugin from 'eslint-plugin-security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'app/generated/**',
      'mcp/**',
      'coverage/**',
    ],
  },
  // ---------------------------------------------------------------------------
  // Análisis de seguridad estático (eslint-plugin-security) — "opción 2".
  //
  // Refuerza gratis las compuertas 2 (lint) y 5 (npm audit) del prod-gate:
  // SURFACEA hallazgos de patrones peligrosos (inyección de objetos, eval con
  // expresión, regex vulnerables a ReDoS, uso de child_process, Buffer sin
  // aserción, posibles ataques de temporización, require/fs con ruta no
  // literal, etc.). Fase 3: depurada la deuda inicial; ver niveles por regla.
  //
  // CRITERIO "ratchet": las reglas arrancaron TODAS en modo "warn" (Fase 2)
  // para surfacear la deuda sin romper la compuerta. La Fase 3 depura esa
  // deuda y ajusta el nivel de cada regla según su señal real:
  //
  //  - detect-unsafe-regex        → "error": los 4 hallazgos se analizaron y
  //    quedaron saneados (mismo regex de fecha ISO, input de SAP acotado, sin
  //    ReDoS real; ver los `eslint-disable-next-line` justificados en cada
  //    sitio). Ya bloquea para impedir NUEVOS regex peligrosos.
  //
  //  - detect-object-injection    → "off": marca CUALQUIER acceso por corchetes
  //    con índice variable (`obj[x]`), patrón omnipresente y legítimo en TS/JS;
  //    en la Fase 2 generó 286 de los 326 warnings, casi todos falsos positivos.
  //    Es un patrón bien conocido de alto ruido que la mayoría de equipos
  //    desactiva. El riesgo real de inyección de prototipo se cubre mejor con
  //    validación de esquemas en los bordes y con las demás reglas activas. Se
  //    apaga por completo en vez de sembrar 286 supresiones inline.
  //
  //  - el resto de reglas         → se mantienen en "warn" por ahora.
  {
    plugins: {
      security: securityPlugin,
    },
    rules: {
      'security/detect-unsafe-regex': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-eval-with-expression': 'warn',
      'security/detect-pseudoRandomBytes': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-no-csrf-before-method-override': 'warn',
      'security/detect-buffer-noassert': 'warn',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'warn',
      // Alto ruido / falsos positivos (ver nota arriba). Desactivada.
      'security/detect-object-injection': 'off',
      'security/detect-new-buffer': 'warn',
      'security/detect-bidi-characters': 'warn',
    },
  },
  // Scripts de desarrollo / CI (no forman parte del runtime de la app ni del
  // request path de Next.js). Los 36 hallazgos de detect-non-literal-fs-filename
  // viven todos aquí y son falsos positivos: usan rutas CONSTANTES resueltas
  // contra `__dirname`, allowlists fijas (p. ej. ['.env.local', '.env']) o
  // rutas provistas por el propio CI (GITHUB_STEP_SUMMARY). No hay input de
  // usuario ni de red en la construcción de la ruta, por lo que no hay path
  // traversal explotable. Se apaga la regla SOLO para este glob de tooling
  // confiable, en lugar de sembrar supresiones inline en 18 archivos.
  {
    files: ['scripts/**'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default eslintConfig;
