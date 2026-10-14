import { prisma } from '../../../../../lib/prisma';
import { cerrarYFirmar, datosAvisoInspector } from '../../../../../lib/bitacora-proceso/db';
import { avisoPorVerificar } from '../../../../../lib/bitacora-proceso/notificaciones';
import { avisarInspector } from '../../_lib/aviso';
import { parseCierre } from '../../../../../lib/bitacora-proceso/rules';
import { readClientOrigin } from '../../../../../lib/sgc/clientOrigin';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';
import { prepararFirmante } from '../../_lib/firmante';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/cerrar?company=1  { firmante, confirmo: true, password, observacion? }
 * Cierre con CONFIRMACIÓN «Cerró» (A4). La sesión puede ser la cuenta compartida
 * de planta: quien confirma elige su nombre (`firmante`) y escribe SU contraseña;
 * debe ser supervisor (Gestión) en la empresa. Después avisa al JEFE DE
 * PRODUCCIÓN (campana + push) con el enlace directo para verificar.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const body = await readJson(request);
    const { observacion } = parseCierre(body);
    const firmante = await prepararFirmante(ctx, access.idCompany, body, readClientOrigin(request).userAgent);
    const firma = await cerrarYFirmar(prisma, id, access, observacion, firmante);
    await avisarInspector(() => datosAvisoInspector(prisma, id, access.idCompany, firmante).then((a) => (a ? avisoPorVerificar(a) : [])));
    return jsonNoStore({ ok: true, firma, firmante: firmante.nombre });
  } catch (error) {
    return errorResponse(error, 'cerrar');
  }
}
