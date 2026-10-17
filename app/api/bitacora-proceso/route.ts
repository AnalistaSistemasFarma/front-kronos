import { prisma } from '../../../lib/prisma';
import { crearOrden, datosAviso, empresasComoJefe, listOrdenes } from '../../../lib/bitacora-proceso/db';
import { avisosApertura } from '../../../lib/bitacora-proceso/notificaciones';
import { avisar } from './_lib/aviso';
import { parseNuevaOrden } from '../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany, requireCompanyOpen, type OtRequestContext } from './_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Empresas con su acceso y `canOpen` (R3, 2026-10-17): puede abrir quien tiene Gestión o es
 * jefe de producción asignado en la empresa. La UI muestra «Nueva bitácora» con `canOpen`.
 */
async function conApertura(ctx: OtRequestContext) {
  const jefe = ctx.access.some((a) => !a.canManage) ? await empresasComoJefe(prisma, ctx.actor.idUser) : new Set<number>();
  return ctx.access.map((a) => ({ ...a, canOpen: a.canManage || (a.canOperate && jefe.has(a.idCompany)) }));
}

/**
 * GET /api/bitacora-proceso[?company=1] (con ?solo=acceso, solo las empresas y permisos)
 * Empresas en las que la persona tiene el módulo (con sus permisos) y el
 * listado de la empresa pedida (o la primera): abiertas + cerradas de 30 días.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const companies = await conApertura(ctx);
    if (new URL(request.url).searchParams.get('solo') === 'acceso') return jsonNoStore({ companies });
    const pedida = parseCompanyParam(request.url) ?? ctx.access[0].idCompany;
    const access = requireCompany(ctx, pedida);
    if (access instanceof Response) return access;
    const ordenes = await listOrdenes(prisma, access.idCompany, ctx.actor.idUser);
    return jsonNoStore({ companies, company: companies.find((c) => c.idCompany === access.idCompany) ?? access, ordenes });
  } catch (error) {
    return errorResponse(error, 'list');
  }
}

/** POST /api/bitacora-proceso — abre una bitácora (Gestión o jefe de producción asignado, R3) y avisa al inspector y al jefe de producción designados (campana + push). */
export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseNuevaOrden(await readJson(request));
    const open = await requireCompanyOpen(ctx, input.idCompany);
    if (open instanceof Response) return open;
    const { access, abreComo } = open;
    const orden = await crearOrden(prisma, input, ctx.actor, abreComo);
    await avisar(() => datosAviso(prisma, orden.id, access.idCompany, ctx.actor).then((a) => (a ? avisosApertura(a) : [])));
    return jsonNoStore({ orden }, 201);
  } catch (error) {
    return errorResponse(error, 'create');
  }
}

