import { NextRequest, NextResponse } from 'next/server';
import { buildContentDisposition, inlineImageContentType } from './attachments';
import { downloadChatAttachment } from './attachmentStorage';
import { NO_STORE } from './http';
import { MAX_TEXTO_VISOR_BYTES, tipoDeVisor, tipoMedioEnLinea } from './visor';
import { hojasDeAdjunto, pdfDeAdjunto } from './visor-servidor';

/**
 * RESPUESTA DEL VISOR para un archivo guardado en OneDrive, YA AUTORIZADO por quien
 * llama. La comparten la vista de los adjuntos del chat
 * (app/api/chat/attachments/[id]/vista) y la de los archivos de un proyecto
 * (app/api/proyectos/[id]/archivos/[fileId]/vista, 2026-11-05: «que se pueda
 * previsualizar y compartir idéntico como lo tenemos en el chat»).
 * Lo que responde según el tipo está documentado en la ruta del chat.
 */
export async function responderVista(
  request: NextRequest,
  a: { itemId: string; nombre: string; contentType: string | null; etiqueta: string }
): Promise<NextResponse> {
  const tipo = tipoDeVisor(a.contentType, a.nombre);
  const itemId = a.itemId;
  const nombre = a.nombre;
  const comoPdf = request.nextUrl.searchParams.get('como') === 'pdf';

  if (tipo === 'ninguno') {
    return NextResponse.json({ error: 'Este tipo de archivo no tiene vista previa.' }, { status: 415, headers: NO_STORE });
  }

  if (tipo === 'office' || (tipo === 'hoja' && comoPdf)) {
    let pdf: Uint8Array;
    try {
      pdf = await pdfDeAdjunto(itemId);
    } catch (error) {
      console.error(`[${a.etiqueta}] conversión a PDF fallida`, error);
      if (esLimiteDePaginas(error)) {
        // No es una falla pasajera: reintentar no sirve (2026-10-26, prod).
        return NextResponse.json(
          { error: 'Este archivo es demasiado grande para verlo como PDF (supera el límite de páginas de Microsoft).' },
          { status: 422, headers: NO_STORE }
        );
      }
      return NextResponse.json({ error: 'No se pudo preparar la vista previa de este archivo.' }, { status: 502, headers: NO_STORE });
    }
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: cabeceras('application/pdf', nombre.replace(/\.[^.]+$/, '') + '.pdf', pdf.byteLength),
    });
  }

  if (tipo === 'hoja') {
    try {
      const hojas = await hojasDeAdjunto(itemId);
      return NextResponse.json(hojas, { status: 200, headers: { ...cabecerasBase(), 'Cache-Control': 'private, max-age=600' } });
    } catch (error) {
      // Libro dañado o con algo que exceljs no lee: el visor cae al PDF de Graph.
      console.error(`[${a.etiqueta}] no se pudieron leer las hojas del Excel`, error);
      return NextResponse.json(
        { error: 'No se pudieron leer las hojas de este Excel.', usarPdf: true },
        { status: 422, headers: NO_STORE }
      );
    }
  }

  const medio = tipo === 'audio' || tipo === 'video' ? tipoMedioEnLinea(a.contentType, nombre) : null;
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

  const tipoContenido = tipo === 'pdf' ? 'application/pdf' : tipo === 'imagen' ? inlineImageContentType(a.contentType, nombre) : medio;
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
