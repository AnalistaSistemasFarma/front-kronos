import { prisma } from '@/lib/prisma';
import { getRequestForm } from '@/lib/sgc/db/requests';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/requests/form?company=3 — tipos de solicitud, campos y pasos de la versión vigente del flujo documental. */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await getRequestForm(prisma, idCompany));
  } catch (error) {
    return errorResponse(error, 'requests:formulario-nuevo');
  }
}
