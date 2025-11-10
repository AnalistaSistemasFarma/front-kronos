import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  env: {
    API_EMAIL: process.env.API_EMAIL,
  },
};

export default nextConfig;
