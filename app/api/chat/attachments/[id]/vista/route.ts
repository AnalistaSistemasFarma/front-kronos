import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { buildContentDisposition, inlineImageContentType } from '../../../../../../lib/chat/attachments';
import { downloadChatAttachment } from '../../../../../../lib/chat/attachmentStorage';
import { NO_STORE, guardConversation, resolveSessionUser, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { MAX_TEXTO_VISOR_BYTES, tipoDeVisor, tipoMedioEnLinea } from '../../../../../../lib/chat/visor';
import { hojasDeAdjunto, pdfDeAdjunto } from '../../../../../../lib/chat/visor-servidor';

export const dynamic = 'force-dynamic';

/**
 * VISTA PREVIA DE UN ADJUNTO DEL CHAT (2026-10-22).
 *
 *   GET /api/chat/attachments/42/vista            (sesión de NextAuth)
 *   GET /api/chat/attachments/42/vista?como=pdf   (Excel: el PDF de Graph en vez de las hojas)
 *
 * Pedido de Nicolás Rivera: «evitemos la descarga de archivos y tengamos
 * previsualizadores». Lo que responde, según el visor que le toca
 * (lib/chat/visor.ts → tipoDeVisor):
 *
 *   - pdf          → el PDF tal cual (`inline`), para pdf.js en el navegador.
 *   - office       → Word / PowerPoint / Excel viejo convertidos a PDF por
 *                    Microsoft Graph (`content?format=pdf`), con caché.
 *   - hoja (.xlsx) → JSON { hojas: [{ nombre, html }], css }: las hojas como
 *                    tablas con el motor del visor de Excel del SGC (PR #717).
 *                    Con `?como=pdf`, el PDF de Graph.
 *   - markdown, csv, texto → `text/plain; charset=utf-8` (hasta 2 MB; si el
 *                    archivo es más grande se avisa con `X-Visor-Recortado: 1`).
 *                    Nunca el tipo original: un .html o un .svg se ven como
 *                    TEXTO, jamás se interpretan.
 *   - audio, video → el medio en línea con soporte de RANGOS (206): el video
 *                    grande se reproduce en streaming y se puede adelantar.
 *   - imagen       → la imagen en línea (lo mismo que `?inline=1` de la descarga).
 *   - ninguno      → 415: el visor ofrece solo Descargar.
 *
 * SEGURIDAD — la MISMA puerta del hilo y de la descarga:
 *   - Solo con SESIÓN (este visor es para personas; los agentes siguen bajando
 *     por /api/chat/attachments/<id> con su llave).
 *   - guardConversation() sobre la conversación del adjunto: dueño + permiso
 *     vigente sobre el agente en el hilo directo, assertGroupAccess en un
 *     grupo, assertPeopleAccess entre personas, membresía en un proyecto.
 *   - 404 sin pistas tanto si no existe como si es de otra persona.
 *   - El contenido PASA por la aplicación con el token de Graph del servidor:
 *     nunca sale una URL de OneDrive.
 *   - `nosniff` y una CSP que no deja ejecutar nada en todas las respuestas.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const attachmentId = Number.parseInt(id, 10);
    if (!/^\d+$/.test(id) || !Number.isInteger(attachmentId) || attachmentId <= 0) return notFound();

    // Primero la sesión: sin ella, 401 sin mirar si el adjunto existe.
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const adjunto = await prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        file_name: true,
        content_type: true,
        onedrive_item_id: true,
        message: { select: { id_conversation: true } },
      },
    });
    if (!adjunto) return notFound();

    const guard = await guardConversation(String(adjunto.message.id_conversation));
    if ('response' in guard) return notFound();
    if (!adjunto.onedrive_item_id) return notFound();

    const tipo = tipoDeVisor(adjunto.content_type, adjunto.file_name);
    const itemId = adjunto.onedrive_item_id;
    const nombre = adjunto.file_name;
    const comoPdf = request.nextUrl.searchParams.get('como') === 'pdf';

    if (tipo === 'ninguno') {
      return NextResponse.json(
        { error: 'Este tipo de archivo no tiene vista previa.' },
        { status: 415, headers: NO_STORE }
      );
    }

    if (tipo === 'office' || (tipo === 'hoja' && comoPdf)) {
      let pdf: Uint8Array;
      try {
        pdf = await pdfDeAdjunto(itemId);
      } catch (error) {
        console.error('[chat/visor] conversión a PDF fallida', error);
        if (esLimiteDePaginas(error)) {
          // No es una falla pasajera: reintentar no sirve (2026-10-26, prod).
          return NextResponse.json(
            { error: 'Este archivo es demasiado grande para verlo como PDF (supera el límite de páginas de Microsoft).' },
            { status: 422, headers: NO_STORE }
          );
        }
        return NextResponse.json(
          { error: 'No se pudo preparar la vista previa de este archivo.' },
          { status: 502, headers: NO_STORE }
        );
      }
      return new NextResponse(new Uint8Array(pdf), { status: 200, headers: cabeceras('application/pdf', nombre.replace(/\.[^.]+$/, '') + '.pdf', pdf.byteLength) });
    }

    if (tipo === 'hoja') {
      try {
        const hojas = await hojasDeAdjunto(itemId);
        return NextResponse.json(hojas, { status: 200, headers: { ...cabecerasBase(), 'Cache-Control': 'private, max-age=600' } });
      } catch (error) {
        // Libro dañado o con algo que exceljs no lee: el visor cae al PDF de Graph.
        console.error('[chat/visor] no se pudieron leer las hojas del Excel', error);
        return NextResponse.json(
          { error: 'No se pudieron leer las hojas de este Excel.', usarPdf: true },
          { status: 422, headers: NO_STORE }
        );
      }
    }

    const medio = tipo === 'audio' || tipo === 'video' ? tipoMedioEnLinea(adjunto.content_type, nombre) : null;
    const range = medio ? request.headers.get('range') : null;
    const contenido = await downloadChatAttachment(itemId, range && /^bytes=\d*-\d*$/.test(range) ? range : null);
    if (!contenido?.stream) {
      return NextResponse.json({ error: 'No se pudo recuperar el archivo.' }, { status: 502, headers: NO_STORE });
    }

    if (tipo === 'markdown' || tipo === 'csv' || tipo === 'texto') {
      const { bytes, recortado } = await leerHasta(contenido.stream, MAX_TEXTO_VISOR_BYTES);
      const h = cabeceras('text/plain; charset=utf-8', nombre, bytes.byteLength);
      if (recortado) h.set('X-Visor-Recortado', '1');
      return new NextResponse(new Uint8Array(bytes), { status: 200, headers: h });
    }

    const tipoContenido = tipo === 'pdf' ? 'application/pdf' : tipo === 'imagen' ? inlineImageContentType(adjunto.content_type, nombre) : medio;
    if (!tipoContenido) {
      return NextResponse.json({ error: 'Este tipo de archivo no tiene vista previa.' }, { status: 415, headers: NO_STORE });
    }
    const h = cabeceras(tipoContenido, nombre, null);
    if (contenido.contentLength) h.set('Content-Length', contenido.contentLength);
    if (medio) {
      h.set('Accept-Ranges', 'bytes');
      if (contenido.status === 206 && contenido.contentRange) h.set('Content-Range', contenido.contentRange);
    }
    return new NextResponse(contenido.stream, { status: medio && contenido.status === 206 ? 206 : 200, headers: h });
  } catch (error) {
    return serverError('GET /api/chat/attachments/[id]/vista', error);
  }
}

function cabecerasBase(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}

/** Cabeceras de una respuesta EN LÍNEA: caché privada de 10 min, sin ejecución. */
function cabeceras(tipo: string, nombre: string, largo: number | null): Headers {
  const h = new Headers(cabecerasBase());
  h.set('Content-Type', tipo);
  h.set('Content-Disposition', buildContentDisposition(nombre, 'inline'));
  h.set('Cache-Control', 'private, max-age=600');
  if (largo !== null) h.set('Content-Length', String(largo));
  return h;
}

/** Lee el stream hasta `max` bytes; si había más, lo corta y lo avisa. */
async function leerHasta(stream: ReadableStream<Uint8Array>, max: number): Promise<{ bytes: Uint8Array; recortado: boolean }> {
  const lector = stream.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  let recortado = false;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    if (total + value.byteLength > max) {
      partes.push(value.subarray(0, max - total));
      total = max;
      recortado = true;
      await lector.cancel().catch(() => undefined);
      break;
    }
    partes.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    bytes.set(p, o);
    o += p.byteLength;
  }
  return { bytes, recortado };
}

/**
 * Microsoft no convierte a PDF un Excel que daría demasiadas páginas
 * (`ErrorCode=XLSPageLimitExceeded`, HTTP 406): pasó con libros de 4 MB y con
 * hojas anchas de 450 KB. Se distingue para no decir «intente de nuevo».
 */
function esLimiteDePaginas(error: unknown): boolean {
  return error instanceof Error && /PageLimitExceeded/i.test(error.message);
}

/** 404 sin pistas: mismo cuerpo tanto si no existe como si es de otra persona. */
function notFound() {
  return NextResponse.json({ error: 'Adjunto no encontrado.' }, { status: 404, headers: NO_STORE });
}
