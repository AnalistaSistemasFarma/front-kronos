import { prisma } from '@/lib/prisma';
import { getVigenteBaseHtml } from '@/lib/sgc/db/drafts';
import { downloadSgcFile } from '@/lib/sgc/onedrive';
import { docxToHtml } from '@/lib/sgc/pdf/render';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/requests/<id>/draft/base — HTML de partida desde el Word
 * fuente de la versión VIGENTE (solo el elaborador, durante la elaboración).
 * El Word fuente de la carga inicial (S1) no tiene huella propia registrada;
 * lo que se firma después es la revisión guardada, con la suya.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    return jsonNoStore(await getVigenteBaseHtml(prisma, { download: downloadSgcFile, docxToHtml }, id, { email: ctx.email, access: ctx.access }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:borrador:base');
  }
}
