import { prisma } from '../../../../lib/prisma';
import { listSupervisoresEmpresa } from '../../../../lib/bitacora-proceso/db';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bitacora-proceso/supervisores?company=1 — supervisores ASIGNADOS de la empresa (Catálogo → Responsables, con Gestión):
 * la lista de la que quien cierra elige SU nombre en la tablet (A4). Solo nombres e ids.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const supervisores = await listSupervisoresEmpresa(prisma, access.idCompany);
    return jsonNoStore({ supervisores });
  } catch (error) {
    return errorResponse(error, 'supervisores');
  }
}
