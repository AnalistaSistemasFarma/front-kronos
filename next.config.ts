import type { NextConfig } from 'next';
import withPWA from '@ducanh2912/next-pwa';
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

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
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

export default withPWA({
  dest: 'public',
  register: true,
  disable: true,
  customWorkerSrc: 'worker',
})(nextConfig);
