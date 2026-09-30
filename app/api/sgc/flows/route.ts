import { prisma } from '@/lib/prisma';
import { createFlowProcess, listFlowProcesses } from '@/lib/sgc/db/flows';
import { companyAccess, configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/flows?company=3 — procesos validados de la empresa con sus
 * versiones (administración de flujos o Calidad).
 * POST /api/sgc/flows — crea un proceso validado con su versión 1 en
 * borrador (solo administración de flujos). Exige `reason`.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin permiso de administración de flujos' }, 403);
    return jsonNoStore({ flows: await listFlowProcesses(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'flows');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const idCompany = Number(body.company);
    if (!companyAccess(ctx, idCompany, 'canAdminFlows')) return jsonNoStore({ error: 'Solo la administración de flujos validados crea flujos' }, 403);
    const created = await createFlowProcess(prisma, idCompany, body as never, ctx.actor);
    return jsonNoStore(created, 201);
  } catch (error) {
    return errorResponse(error, 'flows:crear');
  }
}
