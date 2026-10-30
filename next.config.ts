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

// Id único por build: lo comparten el HTML/JS del cliente y el servidor
// (/api/health/version) para detectar que hay una versión nueva desplegada.
const appBuildId = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 12)}-${Date.now().toString(36)}`;

// Entorno de pruebas (.230): SYNERLINK_ENTORNO=pruebas en su .env (ver lib/entorno).
// Los navegadores piden /favicon.ico por su cuenta (y app/favicon.ico se declara
// siempre), así que en pruebas se reescribe al ícono ámbar «TEST». En producción la
// variable no existe y la config queda idéntica (no se define `rewrites`).
const esEntornoPruebas = (process.env.SYNERLINK_ENTORNO ?? '').trim().toLowerCase() === 'pruebas';
const rewritesPruebas: Pick<NextConfig, 'rewrites'> = esEntornoPruebas
  ? {
      async rewrites() {
        return {
          beforeFiles: [{ source: '/favicon.ico', destination: '/icons/pruebas/favicon-pruebas.png' }],
          afterFiles: [],
          fallback: [],
        };
      },
    }
  : {};

const nextConfig: NextConfig = {
  ...rewritesPruebas,
  generateBuildId: async () => appBuildId,
  async headers() {
    return [
      { source: '/process/sgc-documental/:path*', headers: sgcSecurityHeaders },
      { source: '/api/sgc/:path*', headers: sgcSecurityHeaders },
    ];
  },
  turbopack: {
    root: projectRoot,
  },
  // Paquetes de servidor que Node carga tal cual (no se empaquetan): cada API que los usa
  // dejaba de recompilarlos en dev y el bundle del servidor queda más liviano.
  serverExternalPackages: ['mssql', 'tedious', 'tarn', 'exceljs', 'pdf-lib', 'mammoth', 'node-cron'],
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
    // Tope del cuerpo de las peticiones que pasan por middleware.ts (su matcher
    // incluye /api/:path*). Por defecto son 10 MB y Next TRUNCA en silencio lo que
    // pase de ahí: los adjuntos de más de ~10 MB del chat fallaban con un 400
    // genérico (medido en pruebas el 2026-10-30). Debe coincidir con
    // MAX_CHAT_REQUEST_BODY_BYTES (lib/chat/attachments.ts) y quedar por debajo de
    // maxAllowedContentLength de IIS (deploy/iis/web.config).
    middlewareClientMaxBodySize: 30 * 1024 * 1024,
    // Importar solo los componentes de Mantine que se usan, no el paquete entero
    // (miles de módulos por página en dev). @tabler/icons-react ya viene en la lista de Next.
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
  // Solo variables que el cliente necesita (sin prefijo NEXT_PUBLIC_).
  // Los secretos (p. ej. MICROSOFTCLIENTSECRET) deben quedar solo en .env y usarse en servidor.
  env: {
    APP_BUILD_ID: appBuildId,
    API_EMAIL: process.env.API_EMAIL,
    MICROSOFTCLIENTID: process.env.MICROSOFTCLIENTID,
    MICROSOFTTENANTID: process.env.MICROSOFTTENANTID,
    MICROSOFTGRAPHUSERROUTE: process.env.MICROSOFTGRAPHUSERROUTE,
    MSCALLBACKURI: process.env.MSCALLBACKURI,
    // Carpeta raíz de adjuntos en OneDrive (lib/onedrive/root.ts). Vacía = SAPSEND (producción).
    ONEDRIVE_ROOT_FOLDER: process.env.ONEDRIVE_ROOT_FOLDER ?? '',
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
    // (webpackMemoryOptimizations se quitó: Next solo la aplica en `next build`, en dev no hacía nada.)
    return {
      ...nextConfig,
      // Cuánto se conservan las páginas/APIs ya compiladas. Antes 25 s y 2 páginas (2026-10-15,
      // para frenar la RAM): cada vuelta a una pantalla la recompilaba y al entrar al hub se veía
      // "[Fast Refresh] rebuilding" una y otra vez. Con Sentry fuera de dev y Mantine optimizado
      // (2026-10-22) el servidor pesa menos: se conservan 10 min y 12 páginas.
      onDemandEntries: { maxInactiveAge: 10 * 60 * 1000, pagesBufferLength: 12 },
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
