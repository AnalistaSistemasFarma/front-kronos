import { prisma } from '@/lib/prisma';
import { getParentOptions, setDocumentParent } from '@/lib/sgc/db/relations';
import { errorResponse, getSgcRequestContext, jsonNoStore, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * DOCUMENTOS PADRE E HIJOS (2026-10-19). Solo Aseguramiento de Calidad.
 * GET  /api/sgc/relations/parent?document=<id> — si el documento es de un tipo
 *      padre, su padre actual y los documentos padre a los que se puede relacionar.
 * POST { idChild, idParent, reason, via: 'arrastre' | 'boton' } — relaciona el
 *      hijo con su padre (arrastre en el mapa o botón «Relacionar con padre»),
 *      con las reglas: el padre no tiene padre y un hijo tiene un solo padre.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idDocument = Number(new URL(request.url).searchParams.get('document'));
    if (!Number.isInteger(idDocument) || idDocument <= 0) return jsonNoStore({ error: 'Falta el documento' }, 400);
    return jsonNoStore(await getParentOptions(prisma, ctx.access, idDocument));
  } catch (error) {
    return errorResponse(error, 'relaciones-padre');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const saved = await setDocumentParent(prisma, ctx.access, { idChild: body.idChild, idParent: body.idParent, reason: body.reason, via: body.via }, ctx.actor);
    return jsonNoStore({ saved }, 201);
  } catch (error) {
    return errorResponse(error, 'relaciones-padre');
  }
}
