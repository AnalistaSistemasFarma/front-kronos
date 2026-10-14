import { prisma } from '../../../../../../lib/prisma';
import { getTemplateForGeneration } from '../../../../../../lib/sgc/db/generator';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/generator/templates/<id>?company=<id> — plantilla y campos editables para generar. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const idCompany = parseCompanyParam(request.url);
    if (!id || !idCompany) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    return jsonNoStore(await getTemplateForGeneration(prisma, access, ctx.subject, id));
  } catch (error) {
    return errorResponse(error, 'generador:plantilla');
  }
}
