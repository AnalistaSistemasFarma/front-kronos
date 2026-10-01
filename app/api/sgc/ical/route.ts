import { prisma } from '@/lib/prisma';
import { createIcalToken, getIcalStatus, revokeIcalToken } from '@/lib/sgc/db/ical';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Enlace iCal privado de la persona (solo lectura) para suscribir el
 * calendario de vencimientos en Outlook.
 *   GET    ?company=3       → si tiene un enlace activo (no se vuelve a mostrar)
 *   POST   { company }      → crea uno nuevo (revoca el anterior) y lo muestra UNA vez
 *   DELETE ?company=3       → revoca el enlace
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    const access = idCompany ? companyAccess(ctx, idCompany) : null;
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await getIcalStatus(prisma, access, ctx.email));
  } catch (error) {
    return errorResponse(error, 'ical');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const access = companyAccess(ctx, Number(body?.company));
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const { token, path } = await createIcalToken(prisma, access, ctx.actor);
    const base = (process.env.NEXTAUTH_URL || new URL(request.url).origin).replace(/\/+$/, '');
    return jsonNoStore({ url: `${base}${path}`, webcal: `${base.replace(/^https?:/, 'webcal:')}${path}` }, 201);
  } catch (error) {
    return errorResponse(error, 'ical');
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    const access = idCompany ? companyAccess(ctx, idCompany) : null;
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore(await revokeIcalToken(prisma, access, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'ical');
  }
}
