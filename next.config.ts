import type { NextConfig } from 'next';
import withPWA from '@ducanh2912/next-pwa';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:8080',
        'groupsharedservices.farmalogica.com:8445',
        'localhost:3003',
      ],
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
