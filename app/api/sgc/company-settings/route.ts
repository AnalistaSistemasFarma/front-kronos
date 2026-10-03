import { prisma } from '../../../../lib/prisma';
import { getCompanySettings, saveCompanySettings } from '../../../../lib/sgc/db/companySettings';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/company-settings?company=<id> — configuración general de la
 * empresa en el SGC (logo del encabezado institucional, dominios de correo de
 * la divulgación automática y umbral de avance de lectura). Cualquiera con
 * acceso al SGC de la empresa la consulta.
 * PUT — { company, logoDataUrl?, removeLogo?, disseminationDomains?,
 * readThresholdPct?, reason } solo Aseguramiento de Calidad; queda en la auditoría.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    return jsonNoStore(await getCompanySettings(prisma, idCompany));
  } catch (error) {
    return errorResponse(error, 'company-settings');
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad cambia la configuración del SGC' }, 403);
    return jsonNoStore(await saveCompanySettings(prisma, idCompany, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'company-settings:guardar');
  }
}
