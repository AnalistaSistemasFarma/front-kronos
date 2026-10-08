import { prisma } from '../../../../../lib/prisma';
import { closeInitialLoad } from '../../../../../lib/sgc/db/bulkUpload';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/company-settings/initial-load { company, reason } — Calidad
 * CIERRA la carga inicial de documentos vigentes (Sprint 9). Desde ahí no se
 * suben vigentes sin el encabezado del sistema (la carga responde 409).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad cierra la carga inicial' }, 403);
    return jsonNoStore(await closeInitialLoad(prisma, idCompany, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'carga-inicial:cerrar');
  }
}
