import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { fetchOrionSignedFileContent } from '@/lib/orion/client';
import { resolveOrionPdfUrl } from '@/lib/orion/documentVersions';
import { getOrionDocumentFromBag } from '@/lib/orion/formValue';
import { loadOrionFormBag } from '@/lib/orion/service';
import { isOrionProtectedFileUrl } from '@/lib/orion/signedFileAccess';

/**
 * Proxy de PDF firmado Orion con Bearer server-side.
 * GET /api/integrations/orion/signed-file?requestId=&fileId=&versionId=
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    const versionId = searchParams.get('versionId');
    const forceDownload = searchParams.get('download') === '1';

    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const loaded = await withMssqlPool((pool) => loadOrionFormBag(pool, requestId));
    if (!loaded) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const state = getOrionDocumentFromBag(loaded.bag, fileId);
    let targetUrl: string | null = null;

    if (versionId === 'original') {
      targetUrl =
        state.originalFileUrl ??
        state.versions?.find((v) => v.kind === 'original')?.url ??
        null;
    } else if (versionId) {
      targetUrl = state.versions?.find((v) => v.id === versionId)?.url ?? null;
    } else {
      targetUrl = resolveOrionPdfUrl(state, state.originalFileUrl ?? null);
    }

    if (!targetUrl) {
      return NextResponse.json({ error: 'No hay PDF firmado para este archivo' }, { status: 404 });
    }

    const fileName = state.fileName || 'documento.pdf';
    const disposition = forceDownload ? 'attachment' : 'inline';

    if (!isOrionProtectedFileUrl(targetUrl)) {
      const publicRes = await fetch(targetUrl, { cache: 'no-store' });
      if (!publicRes.ok) {
        return NextResponse.json(
          { error: 'No se pudo obtener el archivo' },
          { status: publicRes.status }
        );
      }
      const buffer = await publicRes.arrayBuffer();
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': publicRes.headers.get('content-type') || 'application/pdf',
          'Content-Disposition': `${disposition}; filename="${fileName}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const upstream = await fetchOrionSignedFileContent({
      orionDocumentId: state.orionDocumentId,
      signedFileUrl: targetUrl,
    });
    if (!upstream.ok || !upstream.buffer) {
      let errorMessage = upstream.error || 'No se pudo descargar el PDF firmado desde Orion';
      try {
        const parsed = JSON.parse(errorMessage) as { error?: string; message?: string };
        errorMessage = parsed.error || parsed.message || errorMessage;
      } catch {
        /* respuesta no JSON */
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: upstream.status >= 400 ? upstream.status : 502 }
      );
    }

    return new NextResponse(upstream.buffer, {
      status: 200,
      headers: {
        'Content-Type': upstream.contentType || 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
