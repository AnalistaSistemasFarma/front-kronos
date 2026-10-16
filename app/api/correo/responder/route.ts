import { CORREO_MAX_TOTAL_RESPUESTA_BYTES } from '../../../../lib/correo/constants';
import { responder } from '../../../../lib/correo/service';
import type { ArchivoAdjunto } from '../../../../lib/correo/types';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/responder (multipart): mensajeId, texto, todos=1, files[]
 * Responde (o responde a todos) DESDE EL BUZÓN PROPIO (el de la sesión). Si el hilo
 * está vinculado a una solicitud, la respuesta queda como nota del caso.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'envio');
    if (ctx instanceof Response) return ctx;
    const largo = Number(request.headers.get('content-length') || 0);
    if (largo > CORREO_MAX_TOTAL_RESPUESTA_BYTES + 1024 * 1024) return jsonNoStore({ error: 'Los adjuntos de la respuesta suman más de 10 MB.' }, 413);
    const form = await request.formData();
    const adjuntos: ArchivoAdjunto[] = [];
    for (const f of form.getAll('files')) {
      if (typeof Blob !== 'undefined' && f instanceof Blob) {
        const nombre = typeof (f as File).name === 'string' && (f as File).name ? (f as File).name : 'adjunto.bin';
        adjuntos.push({ nombre: nombre.slice(0, 200), tipo: f.type || 'application/octet-stream', bytes: Buffer.from(await f.arrayBuffer()) });
      }
    }
    const r = await responder(ctx.deps, ctx.acceso, {
      mensajeId: String(form.get('mensajeId') ?? ''),
      texto: String(form.get('texto') ?? ''),
      todos: form.get('todos') === '1',
      adjuntos,
      ip: ctx.ip,
    });
    return jsonNoStore({ ok: true, ...r });
  } catch (error) {
    return errorResponse(error, 'responder');
  }
}
