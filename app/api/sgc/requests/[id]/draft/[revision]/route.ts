import { prisma } from '@/lib/prisma';
import { getDraftRevision } from '@/lib/sgc/db/drafts';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/requests/<id>/draft/<revisión | ultima> — contenido de una revisión (verificado por su SHA-256). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; revision: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const p = await params;
    const id = parseId(p.id);
    const rev = p.revision === 'ultima' ? 'ultima' : parseId(p.revision);
    if (!id || !rev) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await getDraftRevision(prisma, id, rev, { email: ctx.email, access: ctx.access }));
  } catch (error) {
    return errorResponse(error, 'requests:borrador:revision');
  }
}
