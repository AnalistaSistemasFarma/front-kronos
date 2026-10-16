import { prisma } from '../../../../../lib/prisma';
import { restablecerPin } from '../../../../../lib/bitacora-proceso/db';
import { companyOtAccess } from '../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/pin/restablecer  { company, idUser }
 * Restablece (BORRA y desbloquea) el PIN de bitácora de una persona de la empresa.
 * Solo supervisor (Gestión en esa empresa) o administrador. Nadie fija el PIN de otro:
 * la persona lo vuelve a configurar desde su sesión. Queda en user_audit_log.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    const idUser = typeof body?.idUser === 'string' ? body.idUser.trim() : '';
    if (!Number.isInteger(idCompany) || idCompany < 1 || !idUser || idUser.length > 50) return jsonNoStore({ error: 'Falta la empresa o la persona.' }, 400);
    if (!ctx.isAdmin && !companyOtAccess(ctx.access, idCompany, 'canManage')) {
      return jsonNoStore({ error: 'Solo un supervisor (Bitácora de Proceso: Gestión) o un administrador restablece el PIN.' }, 403);
    }
    await restablecerPin(prisma, idCompany, idUser, { idUser: ctx.actor.idUser, email: ctx.email });
    return jsonNoStore({ ok: true });
  } catch (error) {
    return errorResponse(error, 'pin-restablecer');
  }
}
