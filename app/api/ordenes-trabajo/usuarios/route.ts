import { prisma } from '../../../../lib/prisma';
import { listUsuariosEmpresa } from '../../../../lib/ordenes-trabajo/db';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/ordenes-trabajo/usuarios?company=1 — candidatos a operario (usuarios activos de la empresa; solo Gestión). */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const usuarios = await listUsuariosEmpresa(prisma, access.idCompany);
    return jsonNoStore({ usuarios });
  } catch (error) {
    return errorResponse(error, 'usuarios');
  }
}
