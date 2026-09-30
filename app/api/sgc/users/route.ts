import { prisma } from '@/lib/prisma';
import { listEligibleUsers } from '@/lib/sgc/db/requests';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/users?company=3 — personas habilitadas como elaboradoras/firmantes (gestión o Calidad del SGC). */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore({ users: await listEligibleUsers(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'users');
  }
}
