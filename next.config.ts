import type { NextConfig } from 'next';

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
  },
};

export default nextConfig;
