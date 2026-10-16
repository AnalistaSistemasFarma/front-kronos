import { prisma } from '@/lib/prisma';
import { grantApproverAuthorization, listApproverAuthorizations } from '@/lib/sgc/db/approvers';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/approvers?company=3 — lista de APROBADORES AUTORIZADOS (Sprint 12; solo Calidad). */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    return jsonNoStore(await listApproverAuthorizations(prisma, companyAccess(ctx, idCompany) ?? null));
  } catch (error) {
    return errorResponse(error, 'aprobadores:listar');
  }
}

/** POST /api/sgc/approvers { company, email, idProcessMap?, validFrom?, validTo?, reason } — autoriza a un aprobador (solo Calidad). */
export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await grantApproverAuthorization(prisma, companyAccess(ctx, idCompany) ?? null, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'aprobadores:autorizar');
  }
}
