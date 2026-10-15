import 'server-only';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { fireAndForgetNotification, notifyNewRequest } from '../notificationEvents.js';
import { ensureOneDriveFolderPath, listOneDriveFolderFileNames, uniqueOneDriveFileName, uploadFileToOneDriveFolder } from '../onedrive/graphFolderUpload';
import { oneDriveRoot } from '../onedrive/root';
import { sanitizeOneDriveName } from '../onedriveName';
import { dominiosAutorizados } from '../portal/config';
import { prisma } from '../prisma';
import { createGeneralRequest } from '../requests-general/createGeneralRequest.js';
import { syncRequestToSapsend } from '../sapsend/treasury.js';
import { readCorreoConfig } from './config';
import { catalogoEmpresa, insertarNota, solicitudVisible } from './kronos';
import type { CorreoDeps } from './service';
import type { ArchivoAdjunto } from './types';

/**
 * Dependencias REALES del módulo Correo. Reutiliza la creación de solicitudes
 * (createGeneralRequest), los avisos de solicitud nueva y la carga de adjuntos a
 * OneDrive del módulo de Solicitudes (SAPSEND/TEC/SG/Request-<id>).
 */

/** Dominios internos: los del Portal TH más los que también tienen gente en SynerLink. */
export function dominiosGrupo(): string[] {
  return [...new Set([...dominiosAutorizados(), 'groupsharedservices.com', 'unidossis.com.co'])];
}

/** Base absoluta del ambiente para el enlace del acuse (la misma del inicio de sesión). */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return String(env.NEXTAUTH_URL || env.APP_URL || env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}

async function subirAdjuntos(idRequest: number, archivos: ArchivoAdjunto[]): Promise<{ subidos: number; fallidos: string[] }> {
  const token = await getMicrosoftToken();
  const segments = [oneDriveRoot(), 'TEC', 'SG', `Request-${idRequest}`];
  const folderId = await ensureOneDriveFolderPath(token, segments);
  const existentes = await listOneDriveFolderFileNames(token, segments);
  let subidos = 0;
  const fallidos: string[] = [];
  for (const a of archivos) {
    const nombre = uniqueOneDriveFileName(sanitizeOneDriveName(a.nombre) || `adjunto-${Date.now()}.bin`, existentes);
    existentes.add(nombre.toLowerCase());
    try {
      if (a.bytes.length === 0) throw new Error('vacío');
      await uploadFileToOneDriveFolder(token, folderId, nombre, new Uint8Array(a.bytes), a.tipo || 'application/octet-stream', 'rename');
      subidos++;
    } catch (e) {
      fallidos.push(`${a.nombre}: ${e instanceof Error ? e.message : 'no se pudo subir'}`);
    }
  }
  return { subidos, fallidos };
}

export function correoDeps(): CorreoDeps {
  return {
    db: prisma,
    cfg: readCorreoConfig(),
    kronos: { catalogoEmpresa, solicitudVisible, insertarNota },
    crearSolicitud: (p) => createGeneralRequest({ ...p, url: undefined }),
    notificarNueva: (p) => {
      // notificationEvents.js es JS: su tipo inferido (never[]) no admite listas; se pasa tal cual.
      fireAndForgetNotification(notifyNewRequest({ ...p, requestUrl: null } as never));
      fireAndForgetNotification(syncRequestToSapsend(p.requestId));
    },
    subirAdjuntos,
    dominiosGrupo: dominiosGrupo(),
    appBaseUrl: appBaseUrl(),
  };
}
