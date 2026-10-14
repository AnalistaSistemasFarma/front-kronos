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
 * POST /api/bitacora-proceso/[id]/cerrar?company=1  { observacion?, password, acepto: true }
 *   [+ firmaNueva: { imagen, metodo }]
 * Cierre con FIRMA ELECTRÓNICA del supervisor («Cerró»): solo Gestión. Después
 * avisa al INSPECTOR (campana + push) con el enlace directo para verificar.
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
    await avisarInspector(() => datosAvisoInspector(prisma, id, access.idCompany, ctx.actor).then((a) => (a ? avisoPorVerificar(a) : [])));
    return jsonNoStore({ ok: true, firma, avisoFirma: firmante.avisoFirma });
  } catch (error) {
    return errorResponse(error, 'cerrar');
  }
}
