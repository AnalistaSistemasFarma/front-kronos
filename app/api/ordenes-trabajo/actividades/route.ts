import { prisma } from '../../../../lib/prisma';
import { cambiarActividad, crearActividad, listActividades } from '../../../../lib/ordenes-trabajo/db';
import { parseCambioActividad, parseNuevaActividad } from '../../../../lib/ordenes-trabajo/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ordenes-trabajo/actividades?company=1[&todas=1]
 * Activas para registrar (operario); con `todas=1`, el catálogo completo (solo Gestión).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const todas = new URL(request.url).searchParams.get('todas') === '1';
    const access = requireCompany(ctx, parseCompanyParam(request.url), todas ? 'canManage' : 'canOperate');
    if (access instanceof Response) return access;
    const actividades = await listActividades(prisma, access.idCompany, !todas);
    return jsonNoStore({ actividades });
  } catch (error) {
    return errorResponse(error, 'actividades');
  }
}

/** POST — agrega una actividad al catálogo (solo Gestión). */
export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseNuevaActividad(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const actividad = await crearActividad(prisma, input, ctx.actor);
    return jsonNoStore({ actividad }, 201);
  } catch (error) {
    return errorResponse(error, 'actividades-create');
  }
}

/** PATCH — solo cambia activo, orden y exige_observacion (solo Gestión). Las actividades no se borran. */
export async function PATCH(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseCambioActividad(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const actividad = await cambiarActividad(prisma, input);
    return jsonNoStore({ actividad });
  } catch (error) {
    return errorResponse(error, 'actividades-patch');
  }
}
