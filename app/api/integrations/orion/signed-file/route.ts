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
  resolveOrionActorUserId,
  userIsOrionFlowSignatureResponsible,
} from '@/lib/orion/service';
import { isOrionProtectedFileUrl, isAllowedServerPdfFetchUrl, orionDocumentHasSignedCopy } from '@/lib/orion/signedFileAccess';
import { stampSynerlinkWatermark } from '@/lib/orion/stampSynerlinkWatermark';
import { applyValidatorMarks } from '@/lib/orion/validatorMarks';
import { applyDocumentAnnotations, loadAnnotatedCopyPdf } from '@/lib/orion/annotationService';
import { latestAnnotatedCopy } from '@/lib/orion/annotations';
import type { OrionAnnotatedCopy } from '@/lib/orion/types';
import { buildValidatorMarks } from '@/lib/orion/validatorStamp';
import { buildSynerLinkAttachmentFileUrl } from '@/lib/attachments/fileUrl';
import {
  getCachedPdf,
  pdfCacheKey,
  PDF_CACHE_TTL_ACTIVE_MS,
  PDF_CACHE_TTL_SEALED_MS,
  setCachedPdf,
} from '@/lib/orion/pdfResponseCache';

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** Solo ASCII en Content-Disposition (tildes rompen ByteString de headers). */
function asciiFileName(fileName: string, fallback = 'documento.pdf'): string {
  const ascii = String(fileName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\\r\n]/g, '_')
    .trim();
  return ascii || fallback;
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
    // annotations=0: sin los datos/sellos posteriores a la firma (el editor los dibuja aparte).
    const withAnnotations = searchParams.get('annotations') !== '0';
    // watermark=0: el firmado limpio, sin "SYNERLINK VALIDADO" (pantalla de texto y sellos).
    const withWatermark = searchParams.get('watermark') !== '0';

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
        const actorId =
          (await resolveOrionActorUserId(pool, {
            userId,
            email: me,
          })) || userId;
        const isFlowResponsible = actorId
          ? await userIsOrionFlowSignatureResponsible(pool, requestId, actorId)
          : false;
        canViewVersions = canViewOrionDocumentVersions({
          isAdmin,
          currentUserId: userId,
          requesterId: ctx?.id_requester ?? null,
          currentUserEmail: me,
          requesterEmail: ctx?.requester_email ?? null,
          isSigner,
          isFlowResponsible,
        });
      } catch {
        canViewVersions = false;
      }

      return { state, canViewVersions };
    });

    /** Llave del PDF ya armado en memoria (se fija después de revisar permisos). */
    let responseCacheKey: string | null = null;
    const rememberPdf = (body: Buffer, contentType: string) => {
      if (!responseCacheKey || !/pdf/i.test(contentType)) return;
      const sealed = String(auth?.state.status || '').toUpperCase() === 'FIRMADO';
      setCachedPdf(responseCacheKey, body, contentType, sealed ? PDF_CACHE_TTL_SEALED_MS : PDF_CACHE_TTL_ACTIVE_MS);
    };

    const servePdfFromOneDrive = async (
      stateLike: {
        fileName?: string | null;
        originalFileUrl?: string | null;
        versions?: import('@/lib/orion/types').OrionSignatureState['versions'];
      } | null
    ) => {
      const resolved = await resolveOriginalPdfBase64({
        fileId,
        originalFileUrl: stateLike?.originalFileUrl ?? null,
        versions: stateLike?.versions,
      });
      if (!resolved.base64) return null;
      const fileName = stateLike?.fileName || 'documento.pdf';
      const disposition = forceDownload ? 'attachment' : 'inline';
      let pdf: Uint8Array = Buffer.from(resolved.base64, 'base64');
      if (validatorMode !== 'none') {
        pdf = await applyValidatorMarks(pdf, state, { final: validatorMode === 'final' });
        if (withAnnotations) pdf = await applyDocumentAnnotations(pdf, state);
      }
      const out = Buffer.from(pdf);
      rememberPdf(out, 'application/pdf');
      return new NextResponse(out, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${disposition}; filename="${asciiFileName(fileName)}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    };

    // Redirección RELATIVA: detrás del proxy, req.url trae el origen interno del
    // proceso (p. ej. https://localhost:3030) y el navegador no puede llegar a él.
    // Con Location relativo el navegador usa el mismo dominio público por el que entró.
    const redirectToSynerLinkAttachment = () =>
      new NextResponse(null, {
        status: 307,
        headers: {
          Location: buildSynerLinkAttachmentFileUrl({ requestId, fileId, download: forceDownload }),
          'Cache-Control': 'private, no-store',
        },
      });

    if (!auth) {
      // Sin bag Orion: el adjunto vive en OneDrive SynerLink, no en este proxy.
      return redirectToSynerLinkAttachment();
    }

    const { state, canViewVersions } = auth;
    /** Visto bueno de validadores: none (original), check (en firma) o final (firmas guardadas). */
    let validatorMode: 'none' | 'check' | 'final' = 'check';

    // Borrador / sin firmas: no usar este endpoint (es de Orion).
    if (!versionId && !orionDocumentHasSignedCopy(state)) {
      return redirectToSynerLinkAttachment();
    }

    const orderedVersions = listOrionDocumentVersions(state);

    let targetUrl: string | null = null;
    let maxSignerOrder: number | null = null;
    let wantValidated = false;
    /** Copia congelada "Datos N" a servir (ya trae visto bueno, datos y sellos). */
    let annotatedCopy: OrionAnnotatedCopy | null = null;
    const selectedVersion = versionId
      ? orderedVersions.find((v) => v.id === versionId) ?? null
      : null;

    // Historial / original: solicitante, preparador documento o admin.
    if (versionId && versionId.startsWith('datos-')) {
      if (!canViewVersions) {
        return NextResponse.json(
          { error: 'Solo el solicitante o un preparador documento del flujo puede descargar versiones' },
          { status: 403 }
        );
      }
      annotatedCopy = (state.annotatedCopies ?? []).find((c) => c.id === versionId) ?? null;
      if (!annotatedCopy) {
        return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 });
      }
      validatorMode = 'none';
    } else if (versionId === 'original') {
      validatorMode = 'none';
      if (!canViewVersions) {
        return NextResponse.json(
          { error: 'Solo el solicitante o un preparador documento del flujo puede descargar el original' },
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
          {
            error:
              'Solo el solicitante o un preparador documento del flujo puede descargar versiones',
          },
          { status: 403 }
        );
      }

      const signedOrdered = orderedVersions.filter((v) => v.kind !== 'original');
      targetUrl = selectedVersion.url;

      if (selectedVersion.kind === 'final' || selectedVersion.kind === 'validated') {
        validatorMode = 'final';
      } else if (selectedVersion.kind === 'original') {
        validatorMode = 'none';
      }

      if (selectedVersion.kind === 'validated') {
        // Versión SYNERLINK-VALIDO (marca de agua) — aparte del historial de firmas.
        wantValidated = true;
        maxSignerOrder = null;
      } else if (selectedVersion.kind === 'partial' || selectedVersion.kind === 'final') {
        // Igual que firma interna: acumulado hasta ese firmante, SIN watermark.
        const email = normalizeEmail(selectedVersion.signerEmail);
        const signer = (state.signers ?? []).find((s) => normalizeEmail(s.email) === email);
        const order = Number(signer?.order);
        if (Number.isFinite(order) && order > 0) {
          maxSignerOrder = order;
        } else {
          const signedIdx = signedOrdered
            .filter((v) => v.kind === 'partial' || v.kind === 'final')
            .findIndex((v) => v.id === selectedVersion!.id);
          if (signedIdx >= 0) maxSignerOrder = signedIdx + 1;
        }
      }
    } else if (versionId) {
      return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 });
    } else {
      targetUrl = resolveOrionPdfUrl(state, state.originalFileUrl ?? null);
      // Vista vigente sellada: preferir SYNERLINK-VALIDO (watermark).
      const statusUpperLive = String(state.status || '').toUpperCase();
      if (
        statusUpperLive === 'FIRMADO' ||
        statusUpperLive === 'SIGNED' ||
        statusUpperLive === 'COMPLETED'
      ) {
        wantValidated = withWatermark;
        validatorMode = 'final';
        // Con datos guardados después de firmar, lo vigente es su última copia congelada.
        if (withAnnotations) annotatedCopy = latestAnnotatedCopy(state);
      }
    }

    // Ya armado hace poco con este mismo estado de firma: se entrega sin ir a Orion/OneDrive.
    responseCacheKey = pdfCacheKey({
      route: 'signed-file',
      requestId,
      fileId,
      versionId: versionId ?? '',
      withAnnotations,
      withWatermark,
      state,
    });
    const cachedPdf = getCachedPdf(responseCacheKey);
    if (cachedPdf) {
      return new NextResponse(cachedPdf.body as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': cachedPdf.contentType,
          'Content-Disposition': `${forceDownload ? 'attachment' : 'inline'}; filename="${asciiFileName(state.fileName || 'documento.pdf')}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    // Sin URL Orion (p. ej. Solo ver / aún sin firmas): PDF original desde OneDrive.
    if (!targetUrl && !annotatedCopy) {
      const fromDrive = await servePdfFromOneDrive(state);
      if (fromDrive) return fromDrive;
      return NextResponse.json(
        { error: 'No hay PDF disponible para este archivo' },
        { status: 404 }
      );
    }

    const fileName = state.fileName || 'documento.pdf';
    const disposition = forceDownload ? 'attachment' : 'inline';
    const statusUpper = String(state.status || '').toUpperCase();
    const isSealed = statusUpper === 'FIRMADO';
    // Cache corta cuando el PDF ya está firmado (keyed por doc/versión vía URL).
    // La copia "Datos N" vigente cambia en cada guardado: sin caché.
    const cacheControl = isSealed && !annotatedCopy
      ? 'private, max-age=60'
      : 'private, no-store';

    const serveBuffer = async (
      buffer: ArrayBuffer | Uint8Array,
      contentType?: string | null,
      applySynerlinkStamp = false
    ) => {
      let body: Buffer =
        buffer instanceof ArrayBuffer
          ? Buffer.from(buffer)
          : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      if (applySynerlinkStamp) {
        try {
          const avoid = [
            ...buildValidatorMarks(state).map((m) => m.field),
            ...(state.signatureFields ?? []),
            ...(state.validatorFields ?? []),
            ...(state.annotations ?? []),
          ];
          const stamped = await stampSynerlinkWatermark(body, avoid);
          body = Buffer.from(stamped);
        } catch (err) {
          console.warn('[orion/signed-file] stamp Synerlink watermark failed:', err);
        }
      }

      // Después del sello, para que el visto bueno de los validadores quede encima.
      const isPdf = !contentType || /pdf/i.test(contentType);
      if (isPdf && validatorMode !== 'none') {
        body = Buffer.from(
          await applyValidatorMarks(body, state, { final: validatorMode === 'final' })
        );
        // Datos y sellos posteriores a la firma: encima de todo, nunca en el original.
        if (withAnnotations) body = Buffer.from(await applyDocumentAnnotations(body, state));
      }

      const safeType = String(contentType || 'application/pdf').split(';')[0].trim() || 'application/pdf';
      const responseType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(safeType) ? safeType : 'application/pdf';
      rememberPdf(body, responseType);
      return new NextResponse(body as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': responseType,
          'Content-Disposition': `${disposition}; filename="${asciiFileName(fileName)}"`,
          'Cache-Control': cacheControl,
        },
      });
    };

    const tryServePublicUrl = async (url: string | null | undefined) => {
      const value = String(url || '').trim();
      if (!value || isOrionProtectedFileUrl(value)) return null;
      // SSRF: allowlist estricta (no confiar en URLs solo porque estén en el bag).
      if (!isAllowedServerPdfFetchUrl(value)) {
        return null;
      }
      const publicRes = await fetch(value, { cache: 'no-store', redirect: 'manual' });
      if (!publicRes.ok && !(publicRes.status >= 300 && publicRes.status < 400)) return null;
      if (publicRes.status >= 300 && publicRes.status < 400) {
        const loc = publicRes.headers.get('location');
        if (!loc || !isAllowedServerPdfFetchUrl(loc)) return null;
        const follow = await fetch(loc, { cache: 'no-store', redirect: 'error' });
        if (!follow.ok) return null;
        return serveBuffer(
          await follow.arrayBuffer(),
          follow.headers.get('content-type'),
          wantValidated
        );
      }
      return serveBuffer(
        await publicRes.arrayBuffer(),
        publicRes.headers.get('content-type'),
        wantValidated
      );
    };

    if (annotatedCopy) {
      const copyPdf = await loadAnnotatedCopyPdf(annotatedCopy);
      if (copyPdf) {
        // Ya trae visto bueno, datos y sellos: solo falta la marca de agua (vista vigente).
        validatorMode = 'none';
        return await serveBuffer(copyPdf, 'application/pdf', wantValidated);
      }
      if (versionId) {
        return NextResponse.json(
          { error: 'La copia con los datos ya no está disponible en OneDrive' },
          { status: 404 }
        );
      }
      // Vigente sin la copia en OneDrive: se sigue con el PDF firmado y la capa en vivo.
    }
    if (!targetUrl) {
      return NextResponse.json({ error: 'No hay PDF disponible para este archivo' }, { status: 404 });
    }

    if (!isOrionProtectedFileUrl(targetUrl)) {
      if (!isAllowedServerPdfFetchUrl(targetUrl)) {
        return NextResponse.json(
          { error: 'URL de archivo no permitida' },
          { status: 400 }
        );
      }
      const publicRes = await fetch(targetUrl, { cache: 'no-store', redirect: 'manual' });
      if (publicRes.status >= 300 && publicRes.status < 400) {
        const loc = publicRes.headers.get('location');
        if (loc && isAllowedServerPdfFetchUrl(loc)) {
          const follow = await fetch(loc, { cache: 'no-store', redirect: 'error' });
          if (follow.ok) {
            return await serveBuffer(
              await follow.arrayBuffer(),
              follow.headers.get('content-type'),
              wantValidated
            );
          }
        }
      } else if (publicRes.ok) {
        return await serveBuffer(
          await publicRes.arrayBuffer(),
          publicRes.headers.get('content-type'),
          wantValidated
        );
      }

      // URL pública caída (p. ej. OneDrive liberado tras prepare antiguo).
      if (versionId === 'original') {
        validatorMode = 'none';
        const resolved = await resolveOriginalPdfBase64({
          fileId,
          originalFileUrl: state.originalFileUrl ?? null,
          versions: state.versions,
        });
        if (resolved.base64) {
          return await serveBuffer(
            Buffer.from(resolved.base64, 'base64'),
            'application/pdf',
            false
          );
        }
      }
      const fromDrive = await servePdfFromOneDrive(state);
      if (fromDrive) return fromDrive;
      if (!state.orionDocumentId) {
        return NextResponse.json(
          { error: 'No se pudo obtener el archivo' },
          { status: publicRes.status >= 400 ? publicRes.status : 502 }
        );
      }
      // Hay doc Orion: intentar signed-file / PDF acumulado más abajo.
    }

    const upstream = await fetchOrionSignedFileContent({
      orionDocumentId: state.orionDocumentId,
      signedFileUrl: targetUrl,
      maxSignerOrder,
      // Nunca pedir watermark a Orion: Kronos estampa una sola vez en serveBuffer.
      // Si validated=true aquí + stampSynerlinkWatermark → sello/patrón duplicados.
      validated: false,
    });
    if (!upstream.ok || !upstream.buffer) {
      // 409: Orion aún no tiene PDF acumulado (borrador / sin firmas) → original OneDrive
      if (upstream.status === 409) {
        const fallback = await tryServePublicUrl(state.originalFileUrl);
        if (fallback) return fallback;
        const fromDrive = await servePdfFromOneDrive(state);
        if (fromDrive) return fromDrive;
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

    return await serveBuffer(upstream.buffer, upstream.contentType, wantValidated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
