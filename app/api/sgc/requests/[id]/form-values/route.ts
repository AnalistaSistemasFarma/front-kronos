import { prisma } from '@/lib/prisma';
import { saveFormValues } from '@/lib/sgc/db/requests';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** PUT /api/sgc/requests/<id>/form-values — { values: { clave: valor } } (solicitante o elaborador). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await saveFormValues(prisma, id, body as never, { email: ctx.email, access: ctx.access }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:formulario');
  }
}
