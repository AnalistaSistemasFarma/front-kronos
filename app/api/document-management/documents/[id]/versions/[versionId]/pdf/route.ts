import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';

/**
 * Subproceso PROPIO del Generador de Documentos (fix pedido por Nicolás,
 * 2026-09-02) -- ver el mismo comentario en
 * app/api/document-management/generator/route.ts. Resuelto en línea (no en
 * lib/document-management/access.ts) por la misma razón: permiso propio de
 * este módulo, no una variante del acceso general de Gestión Documental.
 */
const DOCUMENT_GENERATOR_URL = '/process/document-management/generador';

async function hasDocumentGeneratorCompanyAccess(userEmail: string, companyId: number): Promise<boolean> {
  const count = await prisma.subprocessUserCompany.count({
    where: {
      companyUser: { user: { email: userEmail }, id_company: companyId },
      subprocess: { subprocess_url: DOCUMENT_GENERATOR_URL },
    },
  });
  return count > 0;
}

/**
 * Sprint 7 — "Generador de Documentos": descarga/envío de un documento SIN
 * proceso (`document.id_process IS NULL`, ver
 * app/api/document-management/generator/route.ts) siempre como PDF no
 * editable, pedido explícito de Nicolás.
 *
 * Mismo mecanismo de resolución que .../[versionId]/open/route.ts (Graph,
 * a partir de `onedrive_item_id`), pero en vez de redirigir al `webUrl` del
 * visor de Office Online, resuelve directo al contenido descargable:
 *
 *   - Si el archivo YA es PDF (por `file.fileExtension`): redirige a
 *     `@microsoft.graph.downloadUrl` del driveItem (bytes del archivo tal
 *     cual, ya es no-editable).
 *   - Si NO es PDF (.docx/.doc/.xlsx/.pptx, etc.): usa la conversión
 *     nativa de Microsoft Graph — `GET .../content?format=pdf` — que
 *     redirige (302) a una URL firmada y temporal que sirve el archivo YA
 *     convertido a PDF por el motor de Office online. NO se instala
 *     ninguna librería de conversión: es 100% mecanismo de Graph.
 *     Verificado a mano (2026-09-02): subiendo un .docx de prueba a
 *     OneDrive y pidiendo su content?format=pdf se obtiene un PDF real
 *     (content-type application/pdf, firma %PDF-). La URL firmada del
 *     Location NO necesita reenviar el header Authorization: es autónoma.
 *
 * En ambos casos se hace un 307 al recurso real de Microsoft (no se
 * proxea/bufferea el archivo por este servidor), igual patrón que el
 * endpoint `open` ya existente.
 *
 * Guardarraíl de negocio (servidor, no solo UI): esta acción solo aplica a
 * documentos SIN proceso. Si el documento tiene `id_process`, se responde
 * 403 — la descarga/envío de documentos CON proceso queda para un sprint
 * futuro (Sprint 9, vista por categoría de proceso).
 *
 * Control de acceso (fix pedido por Nicolás, 2026-09-02): valida el permiso
 * PROPIO del Generador de Documentos (hasDocumentGeneratorCompanyAccess,
 * subproceso '/process/document-management/generador') y no el de lectura
 * general de Gestión Documental — descargar/enviar el PDF es una acción de
 * este módulo independiente, ver lib/document-management/access.ts.
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

    const access = await hasDocumentGeneratorCompanyAccess(
      session.user.email,
      version.document.id_company
    );
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    if (version.document.id_process != null) {
      return NextResponse.json(
        {
          error:
            'Este documento pertenece a un proceso. La descarga/envío directo solo aplica a ' +
            'documentos sin proceso (Sprint 7); la vista por categoría de proceso llega en un sprint futuro.',
        },
        { status: 403 }
      );
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

    const itemResponse = await fetch(`${graphBase}items/${version.onedrive_item_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!itemResponse.ok) {
      console.error(
        `Error resolviendo metadata para onedrive_item_id=${version.onedrive_item_id} (HTTP ${itemResponse.status})`
      );
      return NextResponse.json(
        { error: 'No se pudo obtener el archivo desde OneDrive' },
        { status: 502 }
      );
    }

    const item = (await itemResponse.json()) as {
      name?: string;
      file?: { fileExtension?: string; mimeType?: string };
      ['@microsoft.graph.downloadUrl']?: string;
    };

    const extension = (item.file?.fileExtension || '').toLowerCase();
    const isAlreadyPdf = extension === '.pdf' || item.file?.mimeType === 'application/pdf';

    if (isAlreadyPdf) {
      const downloadUrl = item['@microsoft.graph.downloadUrl'];
      if (!downloadUrl) {
        return NextResponse.json(
          { error: 'OneDrive no devolvió una URL de descarga para este archivo' },
          { status: 502 }
        );
      }
      return NextResponse.redirect(downloadUrl, { status: 307 });
    }

    // No es PDF: conversión nativa de Graph. `redirect: 'manual'` porque el
    // segundo salto (servicio de transformación de Office) no debe recibir
    // el header Authorization de Graph -- ver nota arriba, se verificó a mano
    // que la URL firmada del Location funciona sin él.
    const convertResponse = await fetch(
      `${graphBase}items/${version.onedrive_item_id}/content?format=pdf`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'manual',
      }
    );

    const convertedLocation = convertResponse.headers.get('location');
    if (!convertedLocation) {
      let detail = '';
      try {
        detail = await convertResponse.text();
      } catch {
        /* ignore */
      }
      console.error(
        `Graph no devolvió Location al convertir a PDF onedrive_item_id=${version.onedrive_item_id} ` +
          `(HTTP ${convertResponse.status}): ${detail}`
      );
      return NextResponse.json(
        { error: 'No se pudo convertir el archivo a PDF' },
        { status: 502 }
      );
    }

    return NextResponse.redirect(convertedLocation, { status: 307 });
  } catch (error) {
    console.error('Error resolviendo el PDF de la versión del documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

