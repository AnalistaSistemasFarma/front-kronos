import { CORREO_MAX_TOTAL_RESPUESTA_BYTES } from '../../../../lib/correo/constants';
import { enviarNuevo } from '../../../../lib/correo/service';
import type { ArchivoAdjunto } from '../../../../lib/correo/types';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** Lista de destinatarios del formulario: JSON (arreglo de textos); cualquier otra cosa cuenta como vacía. */
function listaDe(v: FormDataEntryValue | null): string[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x.slice(0, 500).map((y) => String(y ?? '').slice(0, 320)) : [];
  } catch {
    return [];
  }
}

/**
 * POST /api/correo/redactar (multipart): para, cc, cco (JSON), asunto, texto (Markdown), files[]
 * Envía un correo NUEVO DESDE EL BUZÓN PROPIO (el de la sesión). La ruta no recibe remitente ni buzón: cualquier
 * campo así se ignora. Cuota «envio» (10 por minuto, compartida con Responder).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'envio');
    if (ctx instanceof Response) return ctx;
    const largo = Number(request.headers.get('content-length') || 0);
    if (largo > CORREO_MAX_TOTAL_RESPUESTA_BYTES + 1024 * 1024) return jsonNoStore({ error: 'Los adjuntos suman más de 10 MB.' }, 413);
    const form = await request.formData();
    const adjuntos: ArchivoAdjunto[] = [];
    for (const f of form.getAll('files')) {
      if (typeof Blob !== 'undefined' && f instanceof Blob) {
        const nombre = typeof (f as File).name === 'string' && (f as File).name ? (f as File).name : 'adjunto.bin';
        adjuntos.push({ nombre: nombre.slice(0, 200), tipo: f.type || 'application/octet-stream', bytes: Buffer.from(await f.arrayBuffer()) });
      }
    }
    const r = await enviarNuevo(ctx.deps, ctx.acceso, {
      para: listaDe(form.get('para')),
      cc: listaDe(form.get('cc')),
      cco: listaDe(form.get('cco')),
      asunto: String(form.get('asunto') ?? ''),
      texto: String(form.get('texto') ?? ''),
      adjuntos,
      ip: ctx.ip,
    });
    return jsonNoStore({ ok: true, ...r });
  } catch (error) {
    return errorResponse(error, 'redactar');
  }
}
