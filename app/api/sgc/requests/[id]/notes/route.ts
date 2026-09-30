import { prisma } from '@/lib/prisma';
import { addNote } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/requests/<id>/notes — nota al historial propio ({ body, notifyEmails? }). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await addNote(prisma, sgcNotifier, id, body as never, { email: ctx.email, access: ctx.access }, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'requests:nota');
  }
}
