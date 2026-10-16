import { prisma } from '../../../../../lib/prisma';
import { confirmarVistoBueno, datosAviso } from '../../../../../lib/bitacora-proceso/db';
import { parseConfirmacion } from '../../../../../lib/bitacora-proceso/firmas';
import { avisoSiguienteVistoBueno } from '../../../../../lib/bitacora-proceso/notificaciones';
import { readClientOrigin } from '../../../../../lib/sgc/clientOrigin';
import { avisar } from '../../_lib/aviso';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';
import { prepararConfirmante } from '../../_lib/firmante';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/confirmar?company=1
 *   { rol: 'OPERARIO' | 'SUPERVISOR' | 'INSPECTOR' | 'JEFE_PROD', confirmo: true,
 *     operador? (OPERARIO), persona? (los demás), pin? (si la sesión no es de la persona),
 *     observacion? (SUPERVISOR) }
 * VISTO BUENO (B2/B3, 2026-10-15), sin contraseña: sesión propia o PIN en la tablet.
 * El del SUPERVISOR cierra la bitácora («Cerró»). Orden: operario → supervisor →
 * inspector → jefe de producción. Después avisa (campana + push) a quien le toca el
 * siguiente visto bueno.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const input = parseConfirmacion(await readJson(request));
    const confirmante = await prepararConfirmante(ctx, access.idCompany, input, readClientOrigin(request).userAgent);
    const r = await confirmarVistoBueno(prisma, id, access, input.observacion, confirmante);
    await avisar(() =>
      datosAviso(prisma, id, access.idCompany, { idUser: confirmante.idUser ?? ctx.actor.idUser, email: confirmante.email, nombre: r.nombre }).then((a) =>
        a ? avisoSiguienteVistoBueno(a, r.rol, r.siguiente) : []
      )
    );
    return jsonNoStore({ ok: true, rol: r.rol, firmante: r.nombre, firmadoEn: r.firmadoEn, siguiente: r.siguiente });
  } catch (error) {
    return errorResponse(error, 'confirmar');
  }
}
