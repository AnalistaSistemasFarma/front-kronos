import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';
import { listOneDriveFolderFiles } from '@/lib/onedrive/graphFolderUpload';

/**
 * Lista adjuntos de una solicitud en OneDrive (mismo token/ruta que upload).
 *
 * GET ?requestId=&storagePath=SG&entityType=Request
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId') || searchParams.get('id'));
    const storagePath = String(searchParams.get('storagePath') || 'SG').trim() || 'SG';
    const entityType = String(searchParams.get('entityType') || 'Request').trim() || 'Request';

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    const token = await getMicrosoftToken();
    if (!token) {
      return NextResponse.json({ error: 'No se pudo obtener token de OneDrive' }, { status: 502 });
    }

    const folderName = `${entityType}-${requestId}`;
    const files = await listOneDriveFolderFiles(token, [
      'SAPSEND',
      'TEC',
      storagePath,
      folderName,
    ]);

    console.log(
      `[list-attachments] request=${requestId} folder=${folderName} count=${files.length} names=${files.map((f) => f.name).join(' | ') || '(vacío)'}`
    );

    return NextResponse.json(
      {
        ok: true,
        folder: `SAPSEND/TEC/${storagePath}/${folderName}`,
        files,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[list-attachments]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
