import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import '@mantine/core/styles.css';
import { Providers } from '../components/providers';
import { ThemeInitScript } from '../components/theme/ThemeInitScript';
import { Toaster } from 'react-hot-toast';
import ServiceWorkerRegistrar from '../components/ServiceWorkerRegistrar';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

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
    <html lang='es' suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
        style={{ background: 'var(--background)', color: 'var(--foreground)' }}
      >
        <Providers>{children}</Providers>
        <Toaster />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
