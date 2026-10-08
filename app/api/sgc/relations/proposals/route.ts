import { prisma } from '../../../../../lib/prisma';
import { decideRelationProposals, listRelationProposals, proposeDocumentRelations } from '../../../../../lib/sgc/db/relations';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * «RELACIONAR DOCUMENTOS» (Sprint 9), solo Calidad.
 * GET  ?company=<id>                                         relaciones propuestas pendientes
 * POST { company, action: 'proponer' }                       propone por el código y el listado maestro
 * POST { company, action: 'confirmar', ids }                 confirma (una o en bloque)
 * POST { company, action: 'descartar', ids, reason }         descarta con motivo
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany, 'canQuality');
    if (!access) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad relaciona documentos' }, 403);
    return jsonNoStore({ proposals: await listRelationProposals(prisma, access) });
  } catch (error) {
    return errorResponse(error, 'relaciones:propuestas');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany, 'canQuality');
    if (!access) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad relaciona documentos' }, 403);
    if (body.action === 'proponer') return jsonNoStore(await proposeDocumentRelations(prisma, access, ctx.actor), 201);
    return jsonNoStore(await decideRelationProposals(prisma, access, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'relaciones:propuestas');
  }
}
