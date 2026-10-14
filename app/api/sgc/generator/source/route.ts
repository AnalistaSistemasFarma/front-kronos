import { prisma } from '../../../../../lib/prisma';
import { getTemplateSource, listTemplateSources } from '../../../../../lib/sgc/db/generator';
import { downloadSgcFile } from '../../../../../lib/sgc/onedrive';
import { docxToHtml } from '../../../../../lib/sgc/pdf/render';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, rateLimitResponse } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/generator/source?company=<id>&documento=<idDocumento> — para
 * «Nueva plantilla»: los campos editables detectados en el contenido vigente
 * (Word o editor) del documento. No guarda nada.
 * GET /api/sgc/generator/source?company=<id>&vista=fuentes — S19 (R34): los
 * vigentes de tipos «plantilla guía» (sin codificación) que pueden ser origen.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const idCompany = parseCompanyParam(request.url);
    if (idCompany && new URL(request.url).searchParams.get('vista') === 'fuentes') {
      const access = companyAccess(ctx, idCompany);
      if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
      return jsonNoStore(await listTemplateSources(prisma, access, ctx.subject));
    }
    const idDocument = Number(new URL(request.url).searchParams.get('documento'));
    if (!idCompany || !Number.isInteger(idDocument) || idDocument < 1) return jsonNoStore({ error: 'Falta la empresa o el documento' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    return jsonNoStore(await getTemplateSource(prisma, { download: downloadSgcFile, docxToHtml }, access, ctx.subject, idDocument));
  } catch (error) {
    return errorResponse(error, 'generador:origen');
  }
}
