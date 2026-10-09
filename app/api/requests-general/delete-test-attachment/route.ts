import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';
import {
  deleteOneDriveItem,
  getOneDriveItemMeta,
  isOneDriveItemInFolder,
} from '@/lib/onedrive/graphFolderUpload';
import { isInSandboxFolder, isOneDriveSandbox, oneDriveRoot } from '@/lib/onedrive/root';

const STORAGE_PATHS = new Set(['SG', 'MA']);
const ENTITY_TYPES = new Set(['Request', 'Ticket']);

/**
 * Borra un adjunto SUBIDO EN PRUEBAS (testing / local).
 *
 * Solo existe en una "zona de pruebas" (ONEDRIVE_ROOT_FOLDER distinto de SAPSEND): en producción
 * responde 404. Además verifica en OneDrive que el archivo esté dentro de
 * <raíz de pruebas>/TEC/<SG|MA>/<Request|Ticket>-<id> antes de borrarlo, así nunca toca las
 * carpetas reales. Graph lo manda a la papelera de OneDrive (recuperable).
 *
 * POST JSON: { requestId, fileId, storagePath?: 'SG' | 'MA', entityType?: 'Request' | 'Ticket' }
 */
export async function POST(req: Request) {
  if (!isOneDriveSandbox()) {
    return NextResponse.json({ error: 'No disponible en este entorno' }, { status: 404 });
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      requestId?: unknown;
      fileId?: unknown;
      storagePath?: unknown;
      entityType?: unknown;
    };
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    const storagePath = String(body.storagePath || 'SG').trim();
    const entityType = String(body.entityType || 'Request').trim();

    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }
    if (!STORAGE_PATHS.has(storagePath) || !ENTITY_TYPES.has(entityType)) {
      return NextResponse.json({ error: 'Carpeta no válida' }, { status: 400 });
    }

    const token = await getMicrosoftToken();
    if (!token) {
      return NextResponse.json({ error: 'No se pudo obtener token de OneDrive' }, { status: 502 });
    }

    const root = oneDriveRoot();
    const segments = [root, 'TEC', storagePath, `${entityType}-${requestId}`];
    const meta = await getOneDriveItemMeta(token, fileId);
    if (!meta) {
      return NextResponse.json({ error: 'El archivo ya no existe en OneDrive' }, { status: 404 });
    }
    // El nombre de la carpeta (Request-<id>) existe igual en producción: se exige la RUTA
    // completa (Graph: "/drive/root:/<raíz>/TEC/SG/Request-<id>"), no solo el nombre.
    const inTestFolder =
      isOneDriveItemInFolder(meta, segments) && isInSandboxFolder(meta.parentPath, segments);
    if (!inTestFolder) {
      console.warn(
        `[delete-test-attachment] RECHAZADO fuera de la zona de pruebas: file=${fileId} parent=${meta.parentPath}`
      );
      return NextResponse.json(
        { error: 'Solo se pueden borrar archivos de la carpeta de pruebas' },
        { status: 403 }
      );
    }

    await deleteOneDriveItem(token, fileId);
    console.log(
      `[delete-test-attachment] ${session.user.email} borró "${meta.name}" (${fileId}) de ${segments.join('/')}`
    );
    return NextResponse.json({ ok: true, name: meta.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[delete-test-attachment]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
