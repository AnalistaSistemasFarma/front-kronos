import { prisma } from '@/lib/prisma';
import { listDraftRevisions, saveDraftRevision } from '@/lib/sgc/db/drafts';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/requests/<id>/draft — revisiones del borrador editado en la app.
 * POST — { html, note?, origin?, originRef? } guarda una REVISIÓN NUEVA (solo
 * el elaborador, durante la elaboración; nada se sobrescribe).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    return jsonNoStore(await listDraftRevisions(prisma, id, { email: ctx.email, access: ctx.access }));
  } catch (error) {
    return errorResponse(error, 'requests:borrador');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const saved = await saveDraftRevision(prisma, id, { html: body.html, note: body.note, origin: body.origin, originRef: body.originRef }, { email: ctx.email, access: ctx.access }, ctx.actor);
    return jsonNoStore(saved, saved.unchanged ? 200 : 201);
  } catch (error) {
    return errorResponse(error, 'requests:borrador:guardar');
  }
}
