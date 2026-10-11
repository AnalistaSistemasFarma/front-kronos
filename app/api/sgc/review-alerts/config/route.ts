import { prisma } from '@/lib/prisma';
import { listAlertConfigs, saveAlertConfig } from '@/lib/sgc/db/reviewAlerts';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/review-alerts/config?company=3 — configuración de los avisos
 * (empresa, por tipo documental y por documento). POST { company, scope,
 * idDocumentType?, idDocument?, offsets, overdueEveryDays,
 * readingReminderDays?, emailEnabled?, extraEmails?, isActive?, reason } —
 * Calidad la guarda (con motivo, queda en auditoría).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad consulta la configuración de avisos' }, 403);
    return jsonNoStore({ configs: await listAlertConfigs(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'vencimientos:config');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, idCompany, 'canQuality');
    if (!access) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad configura los avisos de vencimiento' }, 403);
    return jsonNoStore({ saved: await saveAlertConfig(prisma, access, body, ctx.actor) }, 201);
  } catch (error) {
    return errorResponse(error, 'vencimientos:config');
  }
}
