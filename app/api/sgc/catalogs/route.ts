import { prisma } from '../../../../lib/prisma';
import { getCatalogs } from '../../../../lib/sgc/db/catalogs';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/catalogs?company=3[&all=1] — maestros de la empresa (guía de
 * codificación, tipos de proceso, procesos, tipos documentales y
 * departamentos). `all=1` (solo Calidad) incluye los inactivos.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const includeInactive = access.canQuality && new URL(request.url).searchParams.get('all') === '1';
    return jsonNoStore(await getCatalogs(prisma, idCompany, includeInactive));
  } catch (error) {
    return errorResponse(error, 'catalogs');
  }
}
