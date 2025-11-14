import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [
        'localhost:8080',
        'groupsharedservices.farmalogica.com',
      ],
    },
    viewTransition: true,
  },
  env: {
    API_EMAIL: process.env.API_EMAIL,
  },
};

export default nextConfig;
