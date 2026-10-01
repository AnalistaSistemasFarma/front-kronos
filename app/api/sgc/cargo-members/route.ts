import { prisma } from '@/lib/prisma';
import { addCargoMember, listCargoMembers } from '@/lib/sgc/db/cargoMembers';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/cargo-members?company=3 — cargos y personas por cargo (para el
 * alcance de divulgación «por cargo»). POST { company, idCargo, email, reason }
 * — Calidad registra a una persona en un cargo.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await listCargoMembers(prisma, idCompany));
  } catch (error) {
    return errorResponse(error, 'cargos');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad registra personas por cargo' }, 403);
    return jsonNoStore(await addCargoMember(prisma, idCompany, body, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'cargos');
  }
}
