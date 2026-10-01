import { prisma } from '@/lib/prisma';
import { listAlertLog } from '@/lib/sgc/db/reviewAlerts';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/review-alerts/log?company=3[&document=<id>] — registro de avisos enviados y omitidos (Calidad). */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany, 'canQuality');
    if (!access) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad consulta el registro de avisos' }, 403);
    const idDocument = parseId(new URL(request.url).searchParams.get('document') ?? undefined);
    return jsonNoStore({ alerts: await listAlertLog(prisma, access, { idDocument }) });
  } catch (error) {
    return errorResponse(error, 'vencimientos:registro');
  }
}
