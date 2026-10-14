import { prisma } from '../../../../lib/prisma';
import { synerlinkPasswordVerifier, type PasswordVerifier } from '../../../../lib/auth/verifyPassword';
import { getOtAccessForUser, type FirmaActor } from '../../../../lib/bitacora-proceso/db';
import { assertNoBloqueado, limiteReautenticacion, parseConfirmacion, type LimiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';
import { companyOtAccess, OtError, type OtCompanyAccess } from '../../../../lib/bitacora-proceso/rules';
import type { OtRequestContext } from './context';

/**
 * Prepara a quien CONFIRMA «Cerró» o «Verificó» (A4, 2026-10-14).
 *
 * La tablet de planta usa una CUENTA COMPARTIDA, así que la sesión NO sirve para
 * confirmar (Nicolás, 2026-10-14): la persona elige SU nombre (cuerpo `firmante`
 * = su user.id), marca la casilla y escribe SU contraseña de SynerLink. El
 * servidor la valida contra la cuenta de ESA persona (usuario activo de la
 * empresa), con límite de intentos por persona, y devuelve sus datos y su acceso
 * al módulo. La confirmación se guarda con el id de esa persona, no el de la sesión.
 *
 * Ya no se usa la imagen de la firma de GSS Firma ni su consentimiento (GSS Firma
 * y el SGC quedan intactos).
 */
export interface FirmanteDeps {
  verificar: PasswordVerifier;
  limite: LimiteReautenticacion;
  /** Usuario ACTIVO de la empresa con ese id, o null. */
  persona: (idUser: string, idCompany: number) => Promise<{ id: string; email: string; name: string | null } | null>;
  /** Acceso al módulo de esa persona (por correo). */
  acceso: (email: string) => Promise<OtCompanyAccess[]>;
}

export function firmanteDeps(): FirmanteDeps {
  return {
    verificar: synerlinkPasswordVerifier(prisma),
    limite: limiteReautenticacion,
    persona: async (idUser, idCompany) => {
      const cu = await prisma.companyUser.findFirst({
        where: { id_company: idCompany, id_user: idUser, user: { isActive: true } },
        select: { user: { select: { id: true, email: true, name: true } } },
      });
      return cu?.user ?? null;
    },
    acceso: (email) => getOtAccessForUser(prisma, email),
  };
}

export async function prepararFirmante(
  ctx: OtRequestContext,
  idCompany: number,
  body: Record<string, unknown> | null,
  userAgent: string | null,
  deps: FirmanteDeps = firmanteDeps()
): Promise<FirmaActor> {
  const { idFirmante, password } = parseConfirmacion(body);
  const persona = await deps.persona(idFirmante, idCompany);
  if (!persona) throw new OtError('La persona elegida no es un usuario activo de la empresa.', 400);
  assertNoBloqueado(deps.limite, persona.email);
  const ok = await deps.verificar(persona.email, password);
  if (!ok) {
    deps.limite.registrarFallo(persona.email);
    throw new OtError('Contraseña incorrecta: la confirmación no se registró.', 403);
  }
  deps.limite.limpiar(persona.email);
  const access = companyOtAccess(await deps.acceso(persona.email), idCompany);
  return {
    idUser: persona.id,
    email: persona.email,
    ip: ctx.actor.ip,
    userAgent,
    nombre: persona.name?.trim() || persona.email,
    access,
  };
}
