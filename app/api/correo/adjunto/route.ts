import { auditarLectura, proveedorDe } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** Tipos que se pueden VER en el navegador; todo lo demás se descarga. */
const VISIBLES: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'application/pdf': 'application/pdf',
};

function disposicion(tipo: 'inline' | 'attachment', nombre: string): string {
  const ascii = nombre.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 150) || 'adjunto';
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre.slice(0, 150))}`;
}

/** GET /api/correo/adjunto?mensaje=<id>&adjunto=<id>[&ver=1] — descarga (o vista previa) de un adjunto del buzón PROPIO. */
export async function GET(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'adjunto');
    if (ctx instanceof Response) return ctx;
    const q = new URL(request.url).searchParams;
    const prov = await proveedorDe(ctx.deps, ctx.acceso);
    const mensajeId = q.get('mensaje') ?? '';
    const adjuntoId = q.get('adjunto') ?? '';
    const a = await prov.adjunto(mensajeId, adjuntoId);
    await auditarLectura(ctx.deps, ctx.acceso, { accion: 'DESCARGAR_ADJUNTO', mensajeId, detalle: `Adjunto ${adjuntoId.slice(0, 200)}` }, ctx.ip);
    const visible = VISIBLES[a.tipo.toLowerCase()];
    const ver = q.get('ver') === '1' && Boolean(visible);
    if (!a.bytes.length) return jsonNoStore({ error: 'El adjunto está vacío.' }, 404);
    return new Response(new Uint8Array(a.bytes), {
      status: 200,
      headers: {
        'Content-Type': ver ? visible : 'application/octet-stream',
        'Content-Disposition': disposicion(ver ? 'inline' : 'attachment', a.nombre),
        'Content-Length': String(a.bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        // Una imagen o PDF abiertos aquí no pueden ejecutar nada ni cargar recursos.
        ...(ver && visible !== 'application/pdf' ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox" } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error, 'adjunto');
  }
}
