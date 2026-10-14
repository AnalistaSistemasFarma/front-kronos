import { prisma } from '../../../../../../../lib/prisma';
import { decideTemplateVersion } from '../../../../../../../lib/sgc/db/generator';
import { sgcNotifier } from '../../../../../../../lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '../../../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/generator/versions/<id>/decision { company, decision: aprobar|rechazar, reason } — solo Aseguramiento de Calidad, nunca la propia. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!id || !body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    return jsonNoStore(await decideTemplateVersion(prisma, sgcNotifier, access, id, body, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'generador:decidir');
  }
}
