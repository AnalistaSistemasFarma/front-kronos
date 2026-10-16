import { prisma } from '../../prisma';
import type { SgcSignatureDeps } from '../db/signatures';
import { sgcNotifier } from '../notifications';
import { downloadSgcFile, uploadToSgcStorage } from '../onedrive';
import { docxToHtml, htmlToPdf } from '../pdf/render';
import { synerlinkPasswordVerifier } from './reauth';

/**
 * Dependencias REALES de la firma del SGC (las rutas las usan; las pruebas
 * inyectan dobles). Nada de esto habla con Orión: contraseña contra
 * dbo.[user], evidencias y PDF en el OneDrive de la empresa (carpeta propia),
 * conversión con mammoth + Chrome headless local.
 */
export function sgcSignatureDeps(): SgcSignatureDeps {
  return {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload: uploadToSgcStorage,
    download: downloadSgcFile,
    htmlToPdf,
    docxToHtml,
    notifier: sgcNotifier,
    appUrl: process.env.NEXTAUTH_URL || 'https://synerlink',
  };
}
