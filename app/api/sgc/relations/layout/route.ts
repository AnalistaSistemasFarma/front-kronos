import { prisma } from '@/lib/prisma';
import { saveGraphLayout } from '@/lib/sgc/db/relations';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** PUT /api/sgc/relations/layout { company, layout } — guarda las posiciones del mapa de la persona. */
export async function PUT(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await saveGraphLayout(prisma, access, ctx.email, body.layout));
  } catch (error) {
    return errorResponse(error, 'relaciones:diseno');
  }
}
