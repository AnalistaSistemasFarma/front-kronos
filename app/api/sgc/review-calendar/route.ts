import { prisma } from '@/lib/prisma';
import { getAlertSchedulerStatus, listReviewCalendar } from '@/lib/sgc/db/reviewAlerts';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/review-calendar?company=3 — calendario de vencimientos: los
 * documentos vigentes que la persona puede consultar, con la próxima fecha de
 * vencimiento, su estado y responsables. Calidad recibe además el estado del
 * job del programador.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const calendar = await listReviewCalendar(prisma, access, ctx.subject);
    return jsonNoStore({ ...calendar, me: ctx.email.toLowerCase(), canQuality: access.canQuality, canManage: access.canManage || access.canQuality, scheduler: access.canQuality ? await getAlertSchedulerStatus(prisma) : null });
  } catch (error) {
    return errorResponse(error, 'vencimientos:calendario');
  }
}
