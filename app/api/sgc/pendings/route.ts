import { prisma } from '../../../../lib/prisma';
import { getMyPendings } from '../../../../lib/sgc/db/pendings';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/pendings?company=<id> — «Mis pendientes del SGC» (Sprint 9):
 * lo que le toca a la persona de la sesión en la empresa (tareas en su turno,
 * lecturas obligatorias, autorizaciones y capacitaciones).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    return jsonNoStore(await getMyPendings(prisma, ctx.email, access));
  } catch (error) {
    return errorResponse(error, 'pendientes');
  }
}
