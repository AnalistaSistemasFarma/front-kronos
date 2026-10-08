import { prisma } from '@/lib/prisma';
import { deactivateCargoMember } from '@/lib/sgc/db/cargoMembers';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/cargo-members/<id>/deactivate { company, reason } — Calidad retira a una persona de un cargo (no se borra). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!id || !body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad retira personas de un cargo' }, 403);
    return jsonNoStore(await deactivateCargoMember(prisma, idCompany, id, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'cargos');
  }
}
