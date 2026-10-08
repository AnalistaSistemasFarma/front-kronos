import { prisma } from '@/lib/prisma';
import { getDocumentLayout, saveDocumentLayout } from '@/lib/sgc/db/layout';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/requests/<id>/layout — composición del documento: firmantes
 * cuya firma va en el documento, cajas de firma ubicadas, sugerencias
 * (recuadros «Firma» del encabezado institucional) y si la persona puede
 * editarla.
 * PUT — { institutionalHeader?, fields?, pageCount?, reason? } guarda la
 * composición (solo el elaborador, durante la elaboración; fila nueva).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    return jsonNoStore(await getDocumentLayout(prisma, id, { email: ctx.email, access: ctx.access }));
  } catch (error) {
    return errorResponse(error, 'requests:composicion');
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await saveDocumentLayout(prisma, id, body, { email: ctx.email, access: ctx.access }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:composicion:guardar');
  }
}
