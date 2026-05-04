import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kronos',
    short_name: 'Kronos',
    description: 'Sistema de gestión de solicitudes',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0078D4',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/iconocel.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/iconocel.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/iconocel.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
