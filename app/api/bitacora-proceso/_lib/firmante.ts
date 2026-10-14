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
import type { OtRequestContext } from './context';

/**
 * Prepara a quien firma: consentimiento aceptado, contraseña de SynerLink
 * correcta (con límite de intentos) y su firma REGISTRADA en GSS Firma como
 * imagen visible. Si GSS Firma no responde o la persona no tiene firma
 * registrada, firma igual (la firma electrónica es la reautenticación + el
 * significado + la hora + la huella; la imagen es solo su representación) y
 * así una caída de Orión no frena el cierre en planta.
 */
export interface FirmanteDeps {
  verificar: PasswordVerifier;
  firmaRegistrada: (email: string) => Promise<string | null>;
  limite: LimiteReautenticacion;
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
  return { verificar: synerlinkPasswordVerifier(prisma), firmaRegistrada: firmaRegistradaOrion, limite: limiteReautenticacion };
}

export async function prepararFirmante(
  ctx: OtRequestContext,
  body: Record<string, unknown> | null,
  userAgent: string | null,
  deps: FirmanteDeps = firmanteDeps()
): Promise<FirmaActor> {
  const { password } = parseFirma(body);
  assertNoBloqueado(deps.limite, ctx.email);
  const ok = await deps.verificar(ctx.email, password);
  if (!ok) {
    deps.limite.registrarFallo(ctx.email);
    throw new OtError('Contraseña incorrecta: la firma no se registró.', 403);
  }
  deps.limite.limpiar(ctx.email);
  const [u, imagen] = await Promise.all([
    prisma.user.findFirst({ where: { id: ctx.actor.idUser }, select: { name: true } }),
    deps.firmaRegistrada(ctx.email),
  ]);
  return { ...ctx.actor, userAgent, nombre: u?.name?.trim() || ctx.email, imagen: imagenFirmaSegura(imagen) };
}
