import { prisma } from '@/lib/prisma';
import { getMySignature, registerOwnSignature } from '@/lib/sgc/db/signatures';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Sprint 13 — «MI FIRMA» (firma propia, R13).
 * GET /api/sgc/signature/own?company=3 — la firma de la persona de la SESIÓN (validada y pendiente) y si la empresa la tiene encendida.
 * POST { company, imagePng, method: dibujada|imagen } — registra la firma de la persona de la SESIÓN (queda pendiente de validación).
 * El correo NUNCA se toma del cuerpo: si viene uno distinto, 403.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await getMySignature(prisma, idCompany, ctx.email));
  } catch (error) {
    return errorResponse(error, 'firmas:propia');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await registerOwnSignature(prisma, idCompany, body, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'firmas:propia:registrar');
  }
}
