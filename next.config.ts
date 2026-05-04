import type { NextConfig } from 'next';
import withPWA from '@ducanh2912/next-pwa';

const nextConfig: NextConfig = {
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
  env: {
    API_EMAIL: process.env.API_EMAIL,
    MICROSOFTCLIENTID: process.env.MICROSOFTCLIENTID,
    MICROSOFTCLIENTSECRET: process.env.MICROSOFTCLIENTSECRET,
    MICROSOFTTENANTID: process.env.MICROSOFTTENANTID,
    MICROSOFTGRAPHUSERROUTE: process.env.MICROSOFTGRAPHUSERROUTE,
    MSCALLBACKURI: process.env.MSCALLBACKURI,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
};

export default withPWA({
  dest: 'public',
  register: true,
  disable: true,
  customWorkerSrc: 'worker',
})(nextConfig);
