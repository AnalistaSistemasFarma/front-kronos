import { prisma } from '../../../../../../lib/prisma';
import { createRedissemination, previewRedissemination } from '../../../../../../lib/sgc/db/requests';
import { sgcNotifier } from '../../../../../../lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/documents/<id>/redissemination — 2026-10-26: REDIVULGAR la
 * versión VIGENTE del documento (solo Aseguramiento de Calidad):
 *   { company, action: 'vista_previa', entries }  cuántos lectores y cuántos ya la habían leído (no guarda)
 *   { company, action: 'crear', entries, reason, confirmRepeat }  crea la solicitud (201) y arranca la divulgación
 * A quien ya leyó la versión le vuelve a aparecer la lectura: si hay alguno, `confirmRepeat` debe ser true.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idDocument = parseId((await params).id);
    const body = await readJson(request);
    if (!idDocument || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, Number(body.company));
    if (!access) return jsonNoStore({ error: 'Documento no encontrado' }, 404);
    if (!access.canQuality) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad redivulga un documento' }, 403);
    const input = { idDocument, entries: body.entries, reason: body.reason, confirmRepeat: body.confirmRepeat };
    if (body.action === 'vista_previa') return jsonNoStore(await previewRedissemination(prisma, access, input));
    if (body.action === 'crear') return jsonNoStore(await createRedissemination(prisma, sgcNotifier, access, input, ctx.actor), 201);
    return jsonNoStore({ error: 'Acción inválida' }, 400);
  } catch (error) {
    return errorResponse(error, 'documents:redivulgacion');
  }
}
