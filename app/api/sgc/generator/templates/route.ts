import { prisma } from '../../../../../lib/prisma';
import { proposeTemplateVersion } from '../../../../../lib/sgc/db/generator';
import { sgcNotifier } from '../../../../../lib/sgc/notifications';
import { downloadSgcFile } from '../../../../../lib/sgc/onedrive';
import { docxToHtml } from '../../../../../lib/sgc/pdf/render';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/generator/templates { company, idDocument, name?, description?, fields, reason }
 * Propone una configuración de plantilla (queda pendiente de Aseguramiento de Calidad).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    return jsonNoStore(await proposeTemplateVersion(prisma, { download: downloadSgcFile, docxToHtml }, sgcNotifier, access, ctx.subject, body, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'generador:proponer');
  }
}
