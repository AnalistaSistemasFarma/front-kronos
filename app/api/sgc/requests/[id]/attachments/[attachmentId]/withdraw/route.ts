import { prisma } from '@/lib/prisma';
import { withdrawAttachment } from '@/lib/sgc/db/requests';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/requests/<id>/attachments/<attachmentId>/withdraw — retira un adjunto (no se borra), con `reason`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const p = await params;
    const id = parseId(p.id);
    const attachmentId = parseId(p.attachmentId);
    const body = await readJson(request);
    if (!id || !attachmentId || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await withdrawAttachment(prisma, id, attachmentId, body as never, { email: ctx.email, access: ctx.access }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:retirar');
  }
}
