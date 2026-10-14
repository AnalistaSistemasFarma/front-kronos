import { prisma } from '../../../../lib/prisma';
import { cambiarArea, crearArea, listAreas } from '../../../../lib/bitacora-proceso/db';
import { parseCambioArea, parseNuevaArea } from '../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Catálogo de áreas por empresa (A5, 2026-10-14): el área de la bitácora ya no es texto libre.
 * GET ?company=1[&todas=1] (solo Gestión: lo usan la apertura y el catálogo).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const todas = new URL(request.url).searchParams.get('todas') === '1';
    const areas = await listAreas(prisma, access.idCompany, !todas);
    return jsonNoStore({ areas });
  } catch (error) {
    return errorResponse(error, 'areas');
  }
}

/** POST { company, nombre, orden? } — agrega un área (solo Gestión). */
export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseNuevaArea(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const area = await crearArea(prisma, input, ctx.actor);
    return jsonNoStore({ area }, 201);
  } catch (error) {
    return errorResponse(error, 'areas-create');
  }
}

/** PATCH { company, id_area, activo?, orden? } — activa, desactiva u ordena (no se borran). */
export async function PATCH(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseCambioArea(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const area = await cambiarArea(prisma, input);
    return jsonNoStore({ area });
  } catch (error) {
    return errorResponse(error, 'areas-patch');
  }
}
