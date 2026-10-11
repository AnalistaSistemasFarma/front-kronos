import { prisma } from '@/lib/prisma';
import { listEligibleUsers } from '@/lib/sgc/db/requests';
import { listApproverOptions } from '@/lib/sgc/db/approvers';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/users?company=3 — personas habilitadas como elaboradoras/firmantes (gestión o Calidad del SGC).
 * Sprint 12: con `role=aprobador` (y `process=<id>`), solo los APROBADORES AUTORIZADOS del proceso
 * cuando la empresa tiene la lista activa; `restricted` indica si se filtró.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const params = new URL(request.url).searchParams;
    if (params.get('role') === 'aprobador') {
      const proc = Number(params.get('process'));
      return jsonNoStore(await listApproverOptions(prisma, idCompany, Number.isInteger(proc) && proc > 0 ? proc : null, new Date()));
    }
    return jsonNoStore({ users: await listEligibleUsers(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'users');
  }
}
