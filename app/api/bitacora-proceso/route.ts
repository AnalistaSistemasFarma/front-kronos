import { prisma } from '../../../lib/prisma';
import { crearOrden, listOrdenes } from '../../../lib/bitacora-proceso/db';
import { parseNuevaOrden } from '../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany } from './_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bitacora-proceso[?company=1] (con ?solo=acceso, solo las empresas y permisos)
 * Empresas en las que la persona tiene el módulo (con sus permisos) y el
 * listado de la empresa pedida (o la primera): abiertas + cerradas de 30 días.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    if (new URL(request.url).searchParams.get('solo') === 'acceso') return jsonNoStore({ companies: ctx.access });
    const pedida = parseCompanyParam(request.url) ?? ctx.access[0].idCompany;
    const access = requireCompany(ctx, pedida);
    if (access instanceof Response) return access;
    const ordenes = await listOrdenes(prisma, access.idCompany, ctx.actor.idUser);
    return jsonNoStore({ companies: ctx.access, company: access, ordenes });
  } catch (error) {
    return errorResponse(error, 'list');
  }
}

/** POST /api/bitacora-proceso — abre una bitácora (solo Gestión). */
export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseNuevaOrden(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const orden = await crearOrden(prisma, input, ctx.actor);
    return jsonNoStore({ orden }, 201);
  } catch (error) {
    return errorResponse(error, 'create');
  }
}
