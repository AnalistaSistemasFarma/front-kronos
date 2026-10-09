import { prisma } from '../../../../../../lib/prisma';
import { cancelUncontrolledCopy } from '../../../../../../lib/sgc/db/uncontrolledCopies';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/sgc/uncontrolled-copies/<id>/cancel { company } — quien la pidió, mientras está pendiente. */
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
    return jsonNoStore(await cancelUncontrolledCopy(prisma, access, id, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'copias:cancelar');
  }
}
