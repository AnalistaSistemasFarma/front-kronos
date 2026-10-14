import { prisma } from '../../../../lib/prisma';
import { isGeneratorEnabled, listAvailableTemplates, listGeneratedForQuality, listMyGenerated, listTemplatesForManagement } from '../../../../lib/sgc/db/generator';
import { canApproveTemplate, canProposeTemplate } from '../../../../lib/sgc/generator';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GENERADOR DE DOCUMENTOS (plantillas aprobadas por Calidad).
 * GET ?company=<id>[&vista=disponibles|mios|gestion|calidad]
 *   sin vista: si está habilitado y qué puede hacer la persona;
 *   disponibles: plantillas desde las que puede generar hoy;
 *   mios: los registros que generó;
 *   gestion: plantillas y versiones (gestión documental o Calidad);
 *   calidad: el registro de todo lo generado (solo Calidad).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    const enabled = await isGeneratorEnabled(prisma, idCompany);
    const base = { enabled, canPropose: canProposeTemplate(access), canApprove: canApproveTemplate(access), canQuality: access.canQuality };
    const vista = new URL(request.url).searchParams.get('vista');
    if (!vista) return jsonNoStore(base);
    if (!enabled) return jsonNoStore({ error: 'El generador de documentos no está habilitado para esta empresa.' }, 403);
    if (vista === 'disponibles') return jsonNoStore({ ...base, templates: await listAvailableTemplates(prisma, access, ctx.subject) });
    if (vista === 'mios') return jsonNoStore({ ...base, documents: await listMyGenerated(prisma, idCompany, ctx.email) });
    if (vista === 'gestion') return jsonNoStore({ ...base, ...(await listTemplatesForManagement(prisma, access, ctx.subject)) });
    if (vista === 'calidad') return jsonNoStore({ ...base, documents: await listGeneratedForQuality(prisma, access) });
    return jsonNoStore({ error: 'Vista inválida' }, 400);
  } catch (error) {
    return errorResponse(error, 'generador');
  }
}
