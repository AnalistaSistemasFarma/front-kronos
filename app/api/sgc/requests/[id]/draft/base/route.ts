import { prisma } from '@/lib/prisma';
import { getCurrentDraftHtml, getVigenteBaseHtml } from '@/lib/sgc/db/drafts';
import { downloadSgcFile } from '@/lib/sgc/onedrive';
import { docxToHtml } from '@/lib/sgc/pdf/render';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/requests/<id>/draft/base — HTML de partida desde el Word
 * fuente de la versión VIGENTE (solo el elaborador, durante la elaboración).
 * El Word fuente de la carga inicial (S1) no tiene huella propia registrada;
 * lo que se firma después es la revisión guardada, con la suya.
 * Con ?actual=1 devuelve el borrador VIGENTE de la solicitud para la
 * REVISIÓN MENOR de Calidad durante la aprobación (2026-10-03).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    const viewer = { email: ctx.email, access: ctx.access };
    if (new URL(request.url).searchParams.get('actual') === '1') return jsonNoStore(await getCurrentDraftHtml(prisma, { download: downloadSgcFile, docxToHtml }, id, viewer));
    return jsonNoStore(await getVigenteBaseHtml(prisma, { download: downloadSgcFile, docxToHtml }, id, viewer, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:borrador:base');
  }
}
