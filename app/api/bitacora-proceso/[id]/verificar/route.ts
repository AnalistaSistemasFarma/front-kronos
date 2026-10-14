import { prisma } from '../../../../../lib/prisma';
import { verificarYFirmar } from '../../../../../lib/bitacora-proceso/db';
import { readClientOrigin } from '../../../../../lib/sgc/clientOrigin';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';
import { prepararFirmante } from '../../_lib/firmante';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/verificar?company=1  { firmante, confirmo: true, password }
 * Verificación con CONFIRMACIÓN «Verificó» del jefe de producción designado (A3, A4),
 * después del cierre. Valida SU contraseña (no la sesión de la tablet).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const firmante = await prepararFirmante(ctx, access.idCompany, await readJson(request), readClientOrigin(request).userAgent);
    const firma = await verificarYFirmar(prisma, id, access, firmante);
    return jsonNoStore({ ok: true, firma, firmante: firmante.nombre });
  } catch (error) {
    return errorResponse(error, 'verificar');
  }
}
