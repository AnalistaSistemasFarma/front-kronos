import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { fetchOrionSignedFileContent } from '@/lib/orion/client';
import {
  listOrionDocumentVersions,
  resolveOrionPdfUrl,
  canViewOrionDocumentVersions,
  isOrionDocumentSigner,
} from '@/lib/orion/documentVersions';
import { getOrionDocumentFromBag } from '@/lib/orion/formValue';
import {
  getRequestOrionContext,
  loadOrionFormBag,
  resolveOriginalPdfBase64,
} from '@/lib/orion/service';
import { isOrionProtectedFileUrl, isAllowedServerPdfFetchUrl } from '@/lib/orion/signedFileAccess';

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

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

    const me = normalizeEmail(session.user.email);
    const isAdmin =
      session.user.role === 'admin' || session.user.role === 'superadmin';
    const userId = session.user.id != null ? String(session.user.id) : '';

    // Un solo pool: bag + permisos (evita N conexiones SQL).
    const auth = await withMssqlPool(async (pool) => {
      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) return null;

      const state = getOrionDocumentFromBag(loaded.bag, fileId);

      let canViewVersions = false;
      try {
        const ctx = await getRequestOrionContext(pool, requestId);
        const isSigner = isOrionDocumentSigner(state, me);
        canViewVersions = canViewOrionDocumentVersions({
          isAdmin,
          currentUserId: userId,
          requesterId: ctx?.id_requester ?? null,
          currentUserEmail: me,
          requesterEmail: ctx?.requester_email ?? null,
          isSigner,
        });
      } catch {
        canViewVersions = false;
      }

      return { state, canViewVersions };
    });

    if (!auth) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const { state, canViewVersions } = auth;
    const orderedVersions = listOrionDocumentVersions(state);

    let targetUrl: string | null = null;
    let maxSignerOrder: number | null = null;
    let selectedVersion = versionId
      ? orderedVersions.find((v) => v.id === versionId) ?? null
      : null;

    // Historial / original: solo quien creó el flujo (solicitante) o admin.
    if (versionId === 'original') {
      if (!canViewVersions) {
        return NextResponse.json(
          { error: 'Solo quien creó el flujo puede descargar el original' },
          { status: 403 }
        );
      }
      targetUrl =
        state.originalFileUrl ??
        orderedVersions.find((v) => v.kind === 'original')?.url ??
        null;
    } else if (versionId && selectedVersion) {
      if (!canViewVersions) {
        return NextResponse.json(
          { error: 'Solo quien creó el flujo puede descargar versiones' },
          { status: 403 }
        );
      }

      const signedOrdered = orderedVersions.filter((v) => v.kind !== 'original');
      targetUrl = selectedVersion.url;
      if (selectedVersion.kind === 'partial' || selectedVersion.kind === 'final') {
        const email = normalizeEmail(selectedVersion.signerEmail);
        const signer = (state.signers ?? []).find((s) => normalizeEmail(s.email) === email);
        const order = Number(signer?.order);
        if (Number.isFinite(order) && order > 0) {
          maxSignerOrder = order;
        } else if (selectedVersion.kind === 'partial') {
          const partialIdx = signedOrdered
            .filter((v) => v.kind === 'partial')
            .findIndex((v) => v.id === selectedVersion!.id);
          if (partialIdx >= 0) maxSignerOrder = partialIdx + 1;
        }
        if (selectedVersion.kind === 'final') maxSignerOrder = null;
      }
    } else if (versionId) {
      return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 });
    } else {
      targetUrl = resolveOrionPdfUrl(state, state.originalFileUrl ?? null);
      // Vista vigente: PDF acumulado — firmantes pueden ver al firmar (sin versionId)
    }

    if (!targetUrl) {
      return NextResponse.json({ error: 'No hay PDF firmado para este archivo' }, { status: 404 });
    }

    const fileName = state.fileName || 'documento.pdf';
    const disposition = forceDownload ? 'attachment' : 'inline';
    const statusUpper = String(state.status || '').toUpperCase();
    const isSealed = statusUpper === 'FIRMADO';
    // Cache corta cuando el PDF ya está firmado (keyed por doc/versión vía URL).
    const cacheControl = isSealed
      ? 'private, max-age=60'
      : 'private, no-store';

    const serveBuffer = (buffer: ArrayBuffer | Uint8Array, contentType?: string | null) => {
      const body =
        buffer instanceof ArrayBuffer
          ? Buffer.from(buffer)
          : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      return new NextResponse(body as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': contentType || 'application/pdf',
          'Content-Disposition': `${disposition}; filename="${fileName}"`,
          'Cache-Control': cacheControl,
        },
      });
    };

    const tryServePublicUrl = async (url: string | null | undefined) => {
      const value = String(url || '').trim();
      if (!value || isOrionProtectedFileUrl(value)) return null;
      // SSRF: solo OneDrive/SharePoint/Graph allowlisted, o URL ya confiable en el bag.
      const trustedInBag =
        value === String(state.originalFileUrl || '').trim() ||
        (state.versions ?? []).some((v) => String(v.url || '').trim() === value);
      if (!isAllowedServerPdfFetchUrl(value) && !trustedInBag) {
        return null;
      }
      const publicRes = await fetch(value, { cache: 'no-store', redirect: 'manual' });
      if (!publicRes.ok) return null;
      // No seguir redirects a hosts internos.
      if (publicRes.status >= 300 && publicRes.status < 400) {
        const loc = publicRes.headers.get('location');
        if (!loc || (!isAllowedServerPdfFetchUrl(loc) && !trustedInBag)) return null;
        const follow = await fetch(loc, { cache: 'no-store', redirect: 'error' });
        if (!follow.ok) return null;
        return serveBuffer(await follow.arrayBuffer(), follow.headers.get('content-type'));
      }
      return serveBuffer(await publicRes.arrayBuffer(), publicRes.headers.get('content-type'));
    };

    if (!isOrionProtectedFileUrl(targetUrl)) {
      const trustedInBag =
        targetUrl === String(state.originalFileUrl || '').trim() ||
        (state.versions ?? []).some((v) => String(v.url || '').trim() === targetUrl);
      if (!isAllowedServerPdfFetchUrl(targetUrl) && !trustedInBag) {
        return NextResponse.json(
          { error: 'URL de archivo no permitida' },
          { status: 400 }
        );
      }
      const publicRes = await fetch(targetUrl, { cache: 'no-store', redirect: 'manual' });
      if (!publicRes.ok) {
        if (versionId === 'original') {
          const resolved = await resolveOriginalPdfBase64({
            fileId,
            originalFileUrl: state.originalFileUrl ?? null,
            versions: state.versions,
          });
          if (resolved.base64) {
            return serveBuffer(Buffer.from(resolved.base64, 'base64'), 'application/pdf');
          }
        }
        return NextResponse.json(
          { error: 'No se pudo obtener el archivo' },
          { status: publicRes.status >= 400 ? publicRes.status : 502 }
        );
      }
      if (publicRes.status >= 300 && publicRes.status < 400) {
        const loc = publicRes.headers.get('location');
        if (!loc || (!isAllowedServerPdfFetchUrl(loc) && loc !== targetUrl)) {
          return NextResponse.json({ error: 'Redirect no permitido' }, { status: 400 });
        }
        const follow = await fetch(loc, { cache: 'no-store', redirect: 'error' });
        if (!follow.ok) {
          return NextResponse.json(
            { error: 'No se pudo obtener el archivo' },
            { status: follow.status }
          );
        }
        return serveBuffer(await follow.arrayBuffer(), follow.headers.get('content-type'));
      }
      return serveBuffer(await publicRes.arrayBuffer(), publicRes.headers.get('content-type'));
    }

    const upstream = await fetchOrionSignedFileContent({
      orionDocumentId: state.orionDocumentId,
      signedFileUrl: targetUrl,
      maxSignerOrder,
    });
    if (!upstream.ok || !upstream.buffer) {
      // 409: Orion aún no tiene PDF acumulado (borrador / sin firmas) → original OneDrive
      if (upstream.status === 409) {
        const fallback = await tryServePublicUrl(state.originalFileUrl);
        if (fallback) return fallback;
        return NextResponse.json(
          {
            error:
              'El PDF firmado aún no está disponible (nadie ha firmado). Use el documento original.',
          },
          { status: 409 }
        );
      }
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

    return serveBuffer(upstream.buffer, upstream.contentType);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
