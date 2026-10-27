import { shareTargetManifest } from '../lib/chat/compartir-share-target';
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SynerLink',
    short_name: 'SynerLink',
    description: 'Sistema de gestión de solicitudes',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0078D4',
    orientation: 'portrait-primary',
    /*
     * MENÚ «COMPARTIR» DE ANDROID (2026-10-22): con la PWA instalada desde
     * Chrome/Edge, SynerLink aparece al compartir fotos, archivos o texto
     * desde otras apps. El POST lo intercepta public/sw.js y abre
     * /process/chat/compartir. iOS no soporta share_target (ver
     * docs/compartir-en-synerlink.md).
     */
    share_target: shareTargetManifest(),
    /*
     * UN ARCHIVO POR TAMAÑO. Antes los tres apuntaban al mismo
     * `/iconocel.png`, que es de 2500 × 2500 y pesa 916 KB: el navegador se lo
     * descargaba completo para pintarlo de 192 px, y en Android el `maskable`
     * salía MORDIDO porque el lanzador recorta a círculo y la "S" del arte
     * llega hasta el borde.
     *
     * El maskable se generó aparte, con la "S" metida al 76 % sobre el mismo
     * degradado, de modo que el recorte circular nunca la corta. Ver
     * public/icons/.
     */
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
