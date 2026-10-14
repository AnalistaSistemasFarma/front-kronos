import { prisma } from '@/lib/prisma';
import { listHeaderTemplates, saveHeaderTemplate, setDefaultHeaderTemplate } from '@/lib/sgc/db/headerTemplates';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * PLANTILLAS DE ENCABEZADO por tipo documental (S16, R31; D20).
 * GET  ?company=<id>                                         lista (cualquiera con acceso al SGC de la empresa)
 * POST { company, action: 'guardar', id?, code, name, config, isActive?, isDefault?, reason }  crea o edita (solo Calidad)
 * POST { company, action: 'por_defecto', id, reason }       la marca por defecto (solo Calidad)
 * Cada cambio pide motivo y queda en el control de cambios y la auditoría.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    return jsonNoStore({ templates: await listHeaderTemplates(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'encabezados');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad administra las plantillas de encabezado' }, 403);
    if (body.action === 'guardar') return jsonNoStore(await saveHeaderTemplate(prisma, idCompany, body, ctx.actor));
    if (body.action === 'por_defecto') return jsonNoStore(await setDefaultHeaderTemplate(prisma, idCompany, Number(body.id), body, ctx.actor));
    return jsonNoStore({ error: 'Acción inválida' }, 400);
  } catch (error) {
    return errorResponse(error, 'encabezados:guardar');
  }
}
