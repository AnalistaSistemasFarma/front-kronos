import { prisma } from '@/lib/prisma';
import { createAccessRequest, listAccessRequests, listRequestableDocuments } from '@/lib/sgc/db/accessRequests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/access-requests?company=3 — mis solicitudes de acceso, los
 * documentos «por departamento» de otras áreas que puedo pedir y, para
 * Calidad, todas las de la empresa.
 * POST { company, idDocument | code, justification } — pide acceso de consulta.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const [lists, requestable] = await Promise.all([listAccessRequests(prisma, access, ctx.email), listRequestableDocuments(prisma, access, ctx.subject)]);
    return jsonNoStore({ ...lists, requestable, canQuality: access.canQuality });
  } catch (error) {
    return errorResponse(error, 'accesos');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await createAccessRequest(prisma, sgcNotifier, access, ctx.subject, { idDocument: body.idDocument, code: body.code, justification: body.justification }, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'accesos');
  }
}
