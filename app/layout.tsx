import type { Metadata, Viewport } from 'next';
import './globals.css';
import '@mantine/core/styles.css';
import { Providers } from '../components/providers';
import { ThemeInitScript } from '../components/theme/ThemeInitScript';
import { FONT_FACE_VARIABLES } from '../lib/theme/fontFaces';
import AppToaster from '../components/ui/AppToaster';
import ServiceWorkerRegistrar from '../components/ServiceWorkerRegistrar';
import RecuperacionActualizacion from '../components/errors/RecuperacionActualizacion';

export const metadata: Metadata = {
  title: 'SynerLink',
  description: 'Sistema de gestión de solicitudes',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SynerLink',
  },
  icons: {
    apple: '/iconocel.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0078D4',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='es' className={FONT_FACE_VARIABLES} suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body
        className='antialiased min-h-screen'
        style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
      >
        <Providers>{children}</Providers>
        <AppToaster />
        <ServiceWorkerRegistrar />
        <RecuperacionActualizacion />
      </body>
    </html>
  );
}
