import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getDocumentManagementCompanyAccess } from '@/lib/document-management/access';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';

/**
 * Abre el archivo real de una versión de documento: resuelve el `webUrl` de
 * Microsoft Graph a partir del `onedrive_item_id` guardado en
 * `document_version` (ver lib/onedrive/graphFolderUpload.ts, que es quien lo
 * guarda al subir) y redirige ahí (Graph ya sirve un visor de OneDrive/Office
 * Online usable directo en una pestaña nueva — no hace falta construir un
 * visor propio).
 *
 * No se persiste el `webUrl` en base (solo se guarda `onedrive_item_id` /
 * `onedrive_path`): se resuelve en caliente en cada clic para no arrastrar un
 * link que Graph pueda haber rotado, y para no tener que migrar el esquema.
 *
 * GET en vez de POST a propósito: así un <a href=...> plano (sin JS) sirve
 * como botón "Ver archivo" en la tabla y en la página de detalle.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, versionId } = await params;
    const idDocument = Number(id);
    const idDocumentVersion = Number(versionId);
    if (!idDocument || !idDocumentVersion) {
      return NextResponse.json({ error: 'Id inválido' }, { status: 400 });
    }

    const version = await prisma.documentVersion.findUnique({
      where: { id_document_version: idDocumentVersion },
      include: { document: true },
    });
    if (!version || version.id_document !== idDocument) {
      return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 });
    }

    const access = await getDocumentManagementCompanyAccess(
      session.user.email,
      version.document.id_company,
      'read'
    );
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    if (!version.onedrive_item_id) {
      return NextResponse.json(
        { error: 'Esta versión no tiene un archivo asociado en OneDrive' },
        { status: 404 }
      );
    }

    const graphBase = (process.env.MICROSOFTGRAPHUSERROUTE || '').toString();
    if (!graphBase) {
      return NextResponse.json(
        { error: 'MICROSOFTGRAPHUSERROUTE no está configurado' },
        { status: 500 }
      );
    }

    const token = await getMicrosoftToken();
    if (!token) {
      return NextResponse.json(
        { error: 'No se pudo obtener el token de Microsoft Graph' },
        { status: 502 }
      );
    }

    const itemResponse = await fetch(
      `${graphBase}items/${version.onedrive_item_id}?$select=webUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!itemResponse.ok) {
      console.error(
        `Error resolviendo webUrl para onedrive_item_id=${version.onedrive_item_id} (HTTP ${itemResponse.status})`
      );
      return NextResponse.json(
        { error: 'No se pudo obtener el archivo desde OneDrive' },
        { status: 502 }
      );
    }

    const item = (await itemResponse.json()) as { webUrl?: string };
    if (!item.webUrl) {
      return NextResponse.json(
        { error: 'OneDrive no devolvió una URL para este archivo' },
        { status: 502 }
      );
    }

    return NextResponse.redirect(item.webUrl, { status: 307 });
  } catch (error) {
    console.error('Error abriendo el archivo de la versión del documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
