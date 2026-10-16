import { prisma } from '@/lib/prisma';
import { importWordToHtml } from '@/lib/sgc/db/drafts';
import { docxToHtml } from '@/lib/sgc/pdf/render';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, uploadGuard } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/requests/<id>/draft/word (multipart: file .docx) — lo convierte a HTML para el editor (no guarda). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const guard = uploadGuard(request, ctx);
    if (guard) return guard;
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!id || !(file instanceof File)) return jsonNoStore({ error: 'Se esperaba un archivo .docx' }, 400);
    return jsonNoStore(await importWordToHtml(prisma, { docxToHtml }, id, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, { email: ctx.email, access: ctx.access }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:borrador:word');
  }
}
