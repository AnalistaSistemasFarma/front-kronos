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
  // literal, etc.).
  //
  // CRITERIO "ratchet": TODAS las reglas quedan en modo "warn", NUNCA "error".
  // Así las advertencias son visibles en el log del CI y en el editor SIN
  // romper el build ni la compuerta por deuda de seguridad preexistente. El
  // plan es depurar los hallazgos y, cuando estén saneados, subir las reglas
  // relevantes a "error" para que sí bloqueen.
  {
    plugins: {
      security: securityPlugin,
    },
    rules: {
      'security/detect-unsafe-regex': 'warn',
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
      'security/detect-object-injection': 'warn',
      'security/detect-new-buffer': 'warn',
      'security/detect-bidi-characters': 'warn',
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
