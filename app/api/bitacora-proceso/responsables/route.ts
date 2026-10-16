import { prisma } from '../../../../lib/prisma';
import { isOtResponsableRol } from '../../../../lib/bitacora-proceso/constants';
import {
  asignarResponsable,
  cambiarResponsable,
  listCandidatosResponsable,
  listResponsables,
  listResponsablesEmpresa,
} from '../../../../lib/bitacora-proceso/db';
import { parseCambioResponsable, parseNuevoResponsable } from '../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * RESPONSABLES de la bitácora por empresa (2026-10-16): supervisor, inspector y jefe de
 * producción. Cada selector lista SOLO a los asignados (antes salían todos los usuarios de
 * la empresa). No se borran: se desactivan.
 *   GET ?company=1&rol=INSPECTOR — los que hoy pueden actuar con ese rol (para elegir al
 *       abrir la bitácora). Solo Gestión (quien abre).
 *   GET ?company=1               — Catálogo → Responsables: asignaciones y candidatos (Gestión).
 *   POST  { company, id_user, rol }            — asignar (Gestión).
 *   PATCH { company, id_responsable, activo }  — activar o desactivar (Gestión).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const rol = new URL(request.url).searchParams.get('rol');
    if (rol !== null) {
      if (!isOtResponsableRol(rol)) return jsonNoStore({ error: 'Rol no válido' }, 400);
      return jsonNoStore({ responsables: await listResponsables(prisma, access.idCompany, rol) });
    }
    const [responsables, candidatos] = await Promise.all([listResponsablesEmpresa(prisma, access.idCompany), listCandidatosResponsable(prisma, access.idCompany)]);
    return jsonNoStore({ responsables, candidatos });
  } catch (error) {
    return errorResponse(error, 'responsables');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseNuevoResponsable(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    const r = await asignarResponsable(prisma, { ...input, idCompany: access.idCompany }, ctx.actor);
    return jsonNoStore({ responsable: r }, 201);
  } catch (error) {
    return errorResponse(error, 'responsables-asignar');
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseCambioResponsable(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    return jsonNoStore(await cambiarResponsable(prisma, { ...input, idCompany: access.idCompany }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'responsables-cambiar');
  }
}
