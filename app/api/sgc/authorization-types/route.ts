import { prisma } from '@/lib/prisma';
import { listAuthorizationTypes, saveAuthorizationType } from '@/lib/sgc/db/authorizations';
import { configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/authorization-types?company=3 — tipos de Autorización SGC con su grupo.
 * POST — crea (sin `id`) o edita un tipo, con `reason`. Administración de flujos o Calidad.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin permiso para configurar autorizaciones' }, 403);
    return jsonNoStore({ types: await listAuthorizationTypes(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'authorization-types');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const idCompany = Number(body.company);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin permiso para configurar autorizaciones' }, 403);
    return jsonNoStore(await saveAuthorizationType(prisma, idCompany, body as never, ctx.actor), body.id ? 200 : 201);
  } catch (error) {
    return errorResponse(error, 'authorization-types:guardar');
  }
}
