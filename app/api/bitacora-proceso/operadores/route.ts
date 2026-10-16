import { prisma } from '../../../../lib/prisma';
import { cambiarOperador, crearOperador, listOperadores } from '../../../../lib/bitacora-proceso/db';
import { parseCambioOperador, parseNuevoOperador } from '../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Maestro de operarios SIN usuario de SynerLink (A1, 2026-10-14).
 * GET ?company=1[&todas=1]: activos (para programar la bitácora); con `todas=1`, también inactivos.
 * Solo Gestión (supervisores): los operarios eligen su nombre en la pantalla de planta,
 * que trae los programados en la bitácora, no este maestro.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const todas = new URL(request.url).searchParams.get('todas') === '1';
    const operadores = await listOperadores(prisma, access.idCompany, !todas);
    return jsonNoStore({ operadores });
  } catch (error) {
    return errorResponse(error, 'operadores');
  }
}

/** POST { company, nombre, documento? } — agrega un operario (solo Gestión). */
export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseNuevoOperador(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const operador = await crearOperador(prisma, input, ctx.actor);
    return jsonNoStore({ operador }, 201);
  } catch (error) {
    return errorResponse(error, 'operadores-create');
  }
}

/** PATCH { company, id_operador, nombre?, documento?, activo? } — edita o desactiva (no se borran). */
export async function PATCH(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseCambioOperador(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const operador = await cambiarOperador(prisma, input, ctx.actor);
    return jsonNoStore({ operador });
  } catch (error) {
    return errorResponse(error, 'operadores-patch');
  }
}
