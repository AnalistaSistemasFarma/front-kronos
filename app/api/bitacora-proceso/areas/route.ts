import { prisma } from '../../../../lib/prisma';
import { cambiarArea, crearArea, listAreas } from '../../../../lib/bitacora-proceso/db';
import { parseCambioArea, parseNuevaArea } from '../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany, requireCompanyOpen } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Catálogo de áreas por empresa (A5, 2026-10-14): el área de la bitácora ya no es texto libre.
 * GET ?company=1[&todas=1]: sin `todas`, las activas para abrir (Gestión o jefe asignado, R3); con `todas`, el catálogo (solo Gestión).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const todas = new URL(request.url).searchParams.get('todas') === '1';
    // Con `todas` es el catálogo (solo Gestión); sin él, la lista activa para ABRIR (Gestión o jefe, R3).
    let access;
    if (todas) {
      access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
      if (access instanceof Response) return access;
    } else {
      const open = await requireCompanyOpen(ctx, parseCompanyParam(request.url));
      if (open instanceof Response) return open;
      access = open.access;
    }
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
