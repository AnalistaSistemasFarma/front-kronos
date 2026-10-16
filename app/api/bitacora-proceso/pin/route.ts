import { prisma } from '../../../../lib/prisma';
import { synerlinkPasswordVerifier } from '../../../../lib/auth/verifyPassword';
import { configurarPin, estadoPin } from '../../../../lib/bitacora-proceso/db';
import { assertNoBloqueado, limiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';
import { parsePinNuevo } from '../../../../lib/bitacora-proceso/pin';
import { OtError } from '../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * PIN personal de la bitácora (B3, 2026-10-15) — SOLO el de la persona de la SESIÓN.
 * GET  → { configurado, bloqueado } (nunca el hash).
 * POST { pin, confirmacion, password } → configura o cambia SU PIN. Pide una vez su
 *      contraseña de SynerLink (con límite de intentos) para que nadie fije el PIN de
 *      otra persona con una sesión abierta ajena. Desbloquea y pone en 0 los intentos.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    return jsonNoStore(await estadoPin(prisma, ctx.actor.idUser));
  } catch (error) {
    return errorResponse(error, 'pin');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const { pin, password } = parsePinNuevo(await readJson(request));
    assertNoBloqueado(limiteReautenticacion, ctx.email);
    const ok = await synerlinkPasswordVerifier(prisma)(ctx.email, password);
    if (!ok) {
      limiteReautenticacion.registrarFallo(ctx.email);
      throw new OtError('Contraseña de SynerLink incorrecta: el PIN no se guardó.', 403);
    }
    limiteReautenticacion.limpiar(ctx.email);
    await configurarPin(prisma, ctx.actor.idUser, pin, { email: ctx.email, ip: ctx.actor.ip });
    return jsonNoStore({ ok: true, configurado: true, bloqueado: false });
  } catch (error) {
    return errorResponse(error, 'pin-configurar');
  }
}
