import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import '@mantine/core/styles.css';
import { Providers } from '../components/providers';
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
    <html lang='en'>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
        <Toaster />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
