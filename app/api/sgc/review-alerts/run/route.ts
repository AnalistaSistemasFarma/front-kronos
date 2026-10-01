import { prisma } from '@/lib/prisma';
import { sgcAlertDeps } from '@/lib/sgc/alerts/job';
import { runDailySgcJob } from '@/lib/sgc/db/reviewAlerts';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/review-alerts/run { company } — Calidad corre AHORA los avisos
 * del día de su empresa (los mismos del programador; idempotente: lo que ya
 * salió hoy no se repite).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad ejecuta los avisos' }, 403);
    return jsonNoStore({ summary: await runDailySgcJob(prisma, sgcAlertDeps(), { idCompany, source: 'manual', actorEmail: ctx.email }) });
  } catch (error) {
    return errorResponse(error, 'vencimientos:ejecutar');
  }
}
