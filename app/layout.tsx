import type { Metadata, Viewport } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './api/auth/[...nextauth]/route';
import './globals.css';
import '@mantine/core/styles.css';
import { Providers } from '../components/providers';
import { ThemeInitScript } from '../components/theme/ThemeInitScript';
import { FONT_FACE_VARIABLES } from '../lib/theme/fontFaces';
import AppToaster from '../components/ui/AppToaster';
import ServiceWorkerRegistrar from '../components/ServiceWorkerRegistrar';
import RecuperacionActualizacion from '../components/errors/RecuperacionActualizacion';
import { ICONOS_PRUEBAS, esEntornoPruebas, tituloSegunEntorno } from '../lib/entorno';
import FranjaEntornoPruebas from '../components/entorno/FranjaEntornoPruebas';

const appleWebAppBase = {
  capable: true,
  statusBarStyle: 'default',
  title: 'SynerLink',
} as const;

const metadataBase: Metadata = {
  title: 'SynerLink',
  description: 'Sistema de gestión de solicitudes',
  manifest: '/manifest.webmanifest',
  appleWebApp: appleWebAppBase,
  icons: {
    apple: '/iconocel.png',
  },
};

// En producción devuelve `metadataBase` tal cual. Solo con SYNERLINK_ENTORNO=pruebas
// (servidor de la .230) cambia el título y los íconos para distinguir la pestaña.
export function generateMetadata(): Metadata {
  if (!esEntornoPruebas()) return metadataBase;
  return {
    ...metadataBase,
    title: tituloSegunEntorno('SynerLink', true),
    appleWebApp: { ...appleWebAppBase, title: tituloSegunEntorno('SynerLink', true) },
    icons: {
      icon: [
        { url: ICONOS_PRUEBAS.svg, type: 'image/svg+xml' },
        { url: ICONOS_PRUEBAS.png, type: 'image/png', sizes: '256x256' },
      ],
      shortcut: ICONOS_PRUEBAS.png,
      apple: ICONOS_PRUEBAS.apple,
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#0078D4',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // La sesión se lee aquí (cookie + fila del usuario en caché 60 s) y se entrega al cliente: antes cada página
  // esperaba a /api/auth/session antes de pedir permisos y datos.
  const session = await getServerSession(authOptions).catch(() => null);

  return (
    <html lang='es' className={FONT_FACE_VARIABLES} suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body
        className='antialiased min-h-screen'
        style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
      >
        {esEntornoPruebas() && <FranjaEntornoPruebas />}
        <Providers session={session}>{children}</Providers>
        <AppToaster />
        <ServiceWorkerRegistrar />
        <RecuperacionActualizacion />
      </body>
    </html>
  );
}
