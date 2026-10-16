import { prisma } from '../../../../../lib/prisma';
import { listPinsEmpresa } from '../../../../../lib/bitacora-proceso/db';
import { companyOtAccess } from '../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bitacora-proceso/pin/usuarios?company=1 — usuarios activos de la empresa con
 * el estado de su PIN (configurado, bloqueado). Solo supervisor (Gestión) o administrador.
 * Nunca devuelve hashes.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!ctx.isAdmin && !companyOtAccess(ctx.access, idCompany, 'canManage')) {
      return jsonNoStore({ error: 'Solo un supervisor (Bitácora de Proceso: Gestión) o un administrador puede ver esto.' }, 403);
    }
    return jsonNoStore({ usuarios: await listPinsEmpresa(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'pin-usuarios');
  }
}
