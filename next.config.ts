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

/*
 * Fases del React Compiler (ver `experimental.reactCompiler`). Cada carpeta va
 * con `/` y con `\\`: el compilador compara por texto dentro de la ruta y el
 * servidor de pruebas compila en Windows.
 *   Fase 1 (2026-11-16): chat, proyectos, correo y el armazón común.
 *   Fase 2 (2026-11-16): pantallas operativas (solicitudes, tickets, mesa de
 *     ayuda, tableros, BI, formación, portal TH, administración…) y los
 *     componentes compartidos que usan.
 *   Fase 3 (pendiente, la última): SGC, firmas, Orión, Bitácora de Proceso,
 *     autorizaciones, tesorería, compras, ventas, artículos, socios, registros
 *     sanitarios, transferencias, flujos SAP y aprobaciones (workflow).
 *   Fuera a propósito: login, landing, portal de proveedores y formularios externos.
 */
const REACT_COMPILER_CARPETAS = [
  'components/chat/',
  'components/proyectos/',
  'components/correo/',
  'components/layout/',
  'components/Header.tsx',
  'components/NotificationBell.tsx',
  'components/providers.tsx',
  'app/(hub)/process/chat/',
  'app/(hub)/process/proyectos/',
  'app/(hub)/process/correo/',
  // Fase 2
  'components/attachments/',
  'components/avatar/',
  'components/charts/',
  'components/dashboard/',
  'components/email/',
  'components/entorno/',
  'components/errors/',
  'components/formacion/',
  'components/help-desk/',
  'components/microsoft-365/',
  'components/not-found/',
  'components/portal/',
  'components/process/',
  'components/profile/',
  'components/request-general/',
  'components/system-metrics/',
  'components/theme/',
  'components/ui/',
  'components/users/',
  'components/utils/',
  'components/valentine/',
  'components/vitrina/',
  'app/(hub)/process/page.tsx',
  'app/(hub)/process/layout.tsx',
  'app/(hub)/process/administration/',
  'app/(hub)/process/bi/',
  'app/(hub)/process/custom-views/',
  'app/(hub)/process/dashboards/',
  'app/(hub)/process/formacion/',
  'app/(hub)/process/help-desk/',
  'app/(hub)/process/organigrama/',
  'app/(hub)/process/portal-th/',
  'app/(hub)/process/predicciones/',
  'app/(hub)/process/request-general/',
  'app/(hub)/process/service-layer-metrics/',
  'app/(hub)/process/system-metrics/',
  'app/(hub)/process/tickets/',
  'app/(hub)/process/vitrina/',
  'app/home/',
  'app/dashboard/',
  'app/select-company/',
  'app/portal/',
];

function carpetasReactCompiler(carpetas: string[]): string[] {
  return carpetas.flatMap((c) => [`/${c}`, `\\${c.replaceAll('/', '\\')}`]);
}

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
    // REACT COMPILER POR FASES (2026-11-16, pedido de Nicolás). Optimiza solo
    // (memo automático) los componentes de las carpetas de REACT_COMPILER_CARPETAS;
    // lo demás compila igual que antes. Las pantallas críticas (SGC, firmas,
    // autorizaciones, tesorería, compras) entran en la última fase.
    reactCompiler: {
      compilationMode: 'infer',
      // `sources` es opción del compilador: Next 15.5 la pasa tal cual al
      // plugin pero no la declara en sus tipos (ni en su validación, que solo avisa).
      ...({ sources: carpetasReactCompiler(REACT_COMPILER_CARPETAS) } as object),
    },
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
      // Prisma se genera en app/generated/prisma (no en @prisma/client), así que Next no lo trata
      // como paquete externo y webpack lo copiaba DENTRO de cada ruta y página compilada: ~4,3 MB
      // de los ~5 MB de cada API (medido 2026-11-04). Con ~50 entradas compiladas el servidor de
      // dev llegaba a 5 GB, al límite de memoria de Node, y quedaba al 100% de CPU liberando
      // memoria (todo tardaba ~1 s de más). Aquí Node lo carga UNA vez desde su carpeta.
      // Solo en `next dev`: el build de producción (turbopack) no cambia.
      webpack: (webpackConfig, { isServer, nextRuntime }) => {
        if (!isServer || nextRuntime === 'edge') return webpackConfig;
        const generatedPrisma = path.join(projectRoot, 'app', 'generated', 'prisma');
        const externalizePrisma = (
          { context, request }: { context?: string; request?: string },
          callback: (err?: Error | null, result?: string) => void
        ) => {
          if (request && context && request.includes('generated/prisma')) {
            const resolved = path.resolve(context, request);
            if (resolved.toLowerCase().startsWith(generatedPrisma.toLowerCase())) {
              return callback(null, `commonjs ${resolved}`);
            }
          }
          return callback();
        };
        const current = webpackConfig.externals;
        webpackConfig.externals = [
          externalizePrisma,
          ...(Array.isArray(current) ? current : current ? [current] : []),
        ];
        return webpackConfig;
      },
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
