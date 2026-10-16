import { prisma } from '../../../../lib/prisma';
import { getCopyConfig, listCopiesForQuality, listMyCopies, requestUncontrolledCopy } from '../../../../lib/sgc/db/uncontrolledCopies';
import { sgcNotifier } from '../../../../lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, rateLimitResponse, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * COPIAS NO CONTROLADAS (Sprint 11).
 * GET  ?company=<id>[&vista=mias|calidad][&estado=pendiente]
 *      «mias» (por defecto): las copias de la persona; «calidad»: las de la
 *      empresa (decide el grupo SGC-COPIA-NC; Calidad ve el historial).
 * POST { company, idDocument, justification, destination, destinationDetail?, days? }
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    const q = new URL(request.url).searchParams;
    const config = await getCopyConfig(prisma, idCompany);
    if (q.get('vista') === 'calidad') return jsonNoStore({ config, ...(await listCopiesForQuality(prisma, access, ctx.email, { status: q.get('estado') })) });
    return jsonNoStore({ config, copies: await listMyCopies(prisma, idCompany, ctx.email) });
  } catch (error) {
    return errorResponse(error, 'copias');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('solicitudAcceso', ctx.email);
    if (limited) return limited;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    return jsonNoStore(await requestUncontrolledCopy(prisma, sgcNotifier, access, ctx.subject, body, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'copias:solicitar');
  }
}
