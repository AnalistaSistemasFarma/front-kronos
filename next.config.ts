import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Origenes permitidos para Server Actions. A los fijos se suma, si esta
// definido, el host del tunel cloudflare del entorno de pruebas. La URL del
// tunel es EFIMERA (cambia en cada arranque), por eso NO se hardcodea: se lee
// de la variable de entorno TUNNEL_ALLOWED_ORIGIN (definida en .env local,
// gitignored). Acepta una o varias separadas por coma.
const baseAllowedOrigins = [
  'localhost:8080',
  'groupsharedservices.farmalogica.com:8445',
  'localhost:3003',
];

const tunnelOrigins = (process.env.TUNNEL_ALLOWED_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// SGC documental (sistema validado, Sprint 6): cabeceras de seguridad SOLO para sus rutas
// (páginas y APIs). No cambia nada del resto de SynerLink.
const sgcSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/process/sgc-documental/:path*', headers: sgcSecurityHeaders },
      { source: '/api/sgc/:path*', headers: sgcSecurityHeaders },
    ];
  },
  turbopack: {
    root: projectRoot,
  },
  serverExternalPackages: ['mssql', 'tedious', 'tarn'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    // No bloquear el build de producción por errores de ESLint.
    // El lint se valida en revisión de PR, no en el deploy.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: [...baseAllowedOrigins, ...tunnelOrigins],
    },
    viewTransition: true,
  },
  // Solo variables que el cliente necesita (sin prefijo NEXT_PUBLIC_).
  // Los secretos (p. ej. MICROSOFTCLIENTSECRET) deben quedar solo en .env y usarse en servidor.
  env: {
    API_EMAIL: process.env.API_EMAIL,
    MICROSOFTCLIENTID: process.env.MICROSOFTCLIENTID,
    MICROSOFTTENANTID: process.env.MICROSOFTTENANTID,
    MICROSOFTGRAPHUSERROUTE: process.env.MICROSOFTGRAPHUSERROUTE,
    MSCALLBACKURI: process.env.MSCALLBACKURI,
  },
};

// next-pwa está DESACTIVADO (`disable: true`): no genera ningún service worker
// y por lo tanto tampoco concatena el custom worker de `worker/index.js`.
// El service worker que realmente corre es `public/sw.js` (escrito a mano y
// registrado por `components/ServiceWorkerRegistrar.tsx`) — esa es la fuente de
// verdad. Si algún día se pone `disable: false`, next-pwa SOBRESCRIBIRÁ
// `public/sw.js` con el suyo y pasará a mandar `worker/index.js`: ambos
// archivos deben estar sincronizados antes de hacer ese cambio.
// Sentry: sin subida de source maps (no hay auth token en los servidores) ni telemetria.
// En `next dev` ambos quedan fuera: Sentry solo se habilita en producción (lib/sentry.ts)
// y next-pwa está desactivado, pero cargarlos encarece cada arranque y recompilación.
export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    // En local el servidor de desarrollo crecía a 3+ GB de RAM y con el equipo sin memoria libre
    // todo se volvía lento. Esta opción de Next reduce bastante ese consumo a cambio de
    // compilar un poco más despacio la primera vez cada página.
    return {
      ...nextConfig,
      experimental: { ...nextConfig.experimental, webpackMemoryOptimizations: true },
    };
  }

  const [{ default: withPWA }, { withSentryConfig }] = await Promise.all([
    import('@ducanh2912/next-pwa'),
    import('@sentry/nextjs/config'),
  ]);

  return withSentryConfig(
    withPWA({
      dest: 'public',
      register: true,
      disable: true,
      customWorkerSrc: 'worker',
    })(nextConfig),
    {
      org: 'farmalogica',
      project: 'kronos-synerlink',
      silent: true,
      telemetry: false,
      sourcemaps: { disable: true },
    },
  );
}
