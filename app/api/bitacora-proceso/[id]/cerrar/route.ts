import { prisma } from '../../../../../lib/prisma';
import { cerrarYFirmar } from '../../../../../lib/bitacora-proceso/db';
import { parseCierre } from '../../../../../lib/bitacora-proceso/rules';
import { readClientOrigin } from '../../../../../lib/sgc/clientOrigin';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';
import { prepararFirmante } from '../../_lib/firmante';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/cerrar?company=1  { observacion?, password, acepto: true }
 * Cierre con FIRMA ELECTRÓNICA del supervisor («Cerró»): solo Gestión.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const body = await readJson(request);
    const { observacion } = parseCierre(body);
    const firmante = await prepararFirmante(ctx, body, readClientOrigin(request).userAgent);
    const firma = await cerrarYFirmar(prisma, id, access, observacion, firmante);
    return jsonNoStore({ ok: true, firma });
  } catch (error) {
    return errorResponse(error, 'cerrar');
  }
}
