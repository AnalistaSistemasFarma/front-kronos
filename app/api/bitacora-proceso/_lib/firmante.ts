import { prisma } from '../../../../lib/prisma';
import { synerlinkPasswordVerifier, type PasswordVerifier } from '../../../../lib/auth/verifyPassword';
import { getOrionConfig } from '../../../../lib/orion/config';
import { loadOrionUserSignature } from '../../../../lib/orion/client';
import type { FirmaActor } from '../../../../lib/bitacora-proceso/db';
import {
  assertNoBloqueado,
  imagenFirmaSegura,
  limiteReautenticacion,
  parseFirma,
  type LimiteReautenticacion,
} from '../../../../lib/bitacora-proceso/firmas';
import { OtError } from '../../../../lib/bitacora-proceso/rules';
import { FirmaImagenError } from '../../../../lib/firma-gss/png';
import { parseFirmaNueva, registrarFirmaGss, type FirmaGssResultado, type RegistroFirmaGss } from '../../../../lib/firma-gss/miFirma';
import { firmaGssDeps } from '../../../../lib/firma-gss/server';
import type { OtRequestContext } from './context';

/**
 * Prepara a quien firma: consentimiento aceptado, contraseña de SynerLink
 * correcta (con límite de intentos) y su firma REGISTRADA en GSS Firma como
 * imagen visible. Si GSS Firma no responde o la persona no tiene firma
 * registrada, firma igual (la firma electrónica es la reautenticación + el
 * significado + la hora + la huella; la imagen es solo su representación) y
 * así una caída de Orión no frena el cierre en planta.
 *
 * Firma nueva (2026-10-14): si la persona no tiene firma registrada (o quiere
 * cambiarla), el cuerpo trae `firmaNueva: { imagen, metodo }` (dibujada o
 * IMAGEN de su firma manuscrita). DESPUÉS de verificar la contraseña se sanea,
 * se guarda en SU maestro de GSS Firma (para la próxima vez), queda auditada y
 * se usa en esta firma. Si GSS Firma no la guarda, se firma igual con esa
 * imagen y se devuelve un aviso.
 */
export interface FirmanteDeps {
  verificar: PasswordVerifier;
  firmaRegistrada: (email: string) => Promise<string | null>;
  limite: LimiteReautenticacion;
  registrarFirma: (input: RegistroFirmaGss) => Promise<FirmaGssResultado>;
}

const TIMEOUT_FIRMA_MS = 6000;

async function firmaRegistradaOrion(email: string): Promise<string | null> {
  if (!getOrionConfig().enabled) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_FIRMA_MS));
  const carga = loadOrionUserSignature(email)
    .then((r) => (r.ok ? (r.data?.dataUrl ?? null) : null))
    .catch(() => null);
  return Promise.race([carga, timeout]);
}

export function firmanteDeps(): FirmanteDeps {
  return {
    verificar: synerlinkPasswordVerifier(prisma),
    firmaRegistrada: firmaRegistradaOrion,
    limite: limiteReautenticacion,
    registrarFirma: (input) => registrarFirmaGss(firmaGssDeps(), input),
  };
}

export async function prepararFirmante(
  ctx: OtRequestContext,
  body: Record<string, unknown> | null,
  userAgent: string | null,
  deps: FirmanteDeps = firmanteDeps()
): Promise<FirmaActor & { avisoFirma: string | null }> {
  const { password } = parseFirma(body);
  let firmaNueva;
  try {
    firmaNueva = parseFirmaNueva(body?.firmaNueva);
  } catch (e) {
    if (e instanceof FirmaImagenError) throw new OtError(e.message, 400);
    throw e;
  }
  assertNoBloqueado(deps.limite, ctx.email);
  const ok = await deps.verificar(ctx.email, password);
  if (!ok) {
    deps.limite.registrarFallo(ctx.email);
    throw new OtError('Contraseña incorrecta: la firma no se registró.', 403);
  }
  deps.limite.limpiar(ctx.email);
  let nueva: FirmaGssResultado | null = null;
  if (firmaNueva) {
    try {
      nueva = await deps.registrarFirma({ idUser: ctx.actor.idUser, email: ctx.email, firma: firmaNueva, origen: 'bitacora-proceso', ip: ctx.actor.ip, userAgent });
    } catch (e) {
      if (e instanceof FirmaImagenError) throw new OtError(e.message, 400);
      throw e;
    }
  }
  const [u, imagen] = await Promise.all([
    prisma.user.findFirst({ where: { id: ctx.actor.idUser }, select: { name: true } }),
    nueva ? Promise.resolve(nueva.dataUrl) : deps.firmaRegistrada(ctx.email),
  ]);
  const avisoFirma = nueva && !nueva.guardada ? 'Su firma quedó en esta bitácora, pero GSS Firma no la guardó para la próxima vez. Regístrela luego en «Mi perfil».' : null;
  return { ...ctx.actor, userAgent, nombre: u?.name?.trim() || ctx.email, imagen: imagenFirmaSegura(imagen), avisoFirma };
}
