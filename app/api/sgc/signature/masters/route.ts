import { prisma } from '@/lib/prisma';
import { listSignatureMasters, registerSignatureMaster } from '@/lib/sgc/db/signatures';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/signature/masters?company=3 — maestro de firmas (trazos
 * registrados por Calidad en la inducción). POST — { company, email,
 * imagePng (data URL PNG), reason } registra una versión nueva (la anterior
 * queda revocada). Solo Aseguramiento de Calidad.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad administra el maestro de firmas' }, 403);
    return jsonNoStore({ masters: await listSignatureMasters(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'firmas:maestro');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const idCompany = Number(body.company);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad administra el maestro de firmas' }, 403);
    return jsonNoStore(await registerSignatureMaster(prisma, idCompany, { email: body.email, imagePng: body.imagePng, reason: body.reason }, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'firmas:maestro:registrar');
  }
}
