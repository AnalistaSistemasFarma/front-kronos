import { prisma } from '@/lib/prisma';
import { addDocumentRelation, getRelationGraph } from '@/lib/sgc/db/relations';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/relations?company=3[&obsoletos=1] — mapa de relaciones de la
 * empresa: solo los documentos que la persona puede consultar y las
 * relaciones entre ellos (con sus posiciones guardadas).
 * POST { idSource, idTarget | targetCode, type, note?, reason } — Calidad
 * registra una relación tipada.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const obsoletos = new URL(request.url).searchParams.get('obsoletos') === '1';
    return jsonNoStore(await getRelationGraph(prisma, access, ctx.subject, { statuses: obsoletos ? ['vigente', 'obsoleto'] : ['vigente'] }));
  } catch (error) {
    return errorResponse(error, 'relaciones');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const saved = await addDocumentRelation(prisma, ctx.access, { idSource: body.idSource, idTarget: body.idTarget, targetCode: body.targetCode, type: body.type, note: body.note, reason: body.reason }, ctx.actor);
    return jsonNoStore({ saved }, 201);
  } catch (error) {
    return errorResponse(error, 'relaciones');
  }
}
