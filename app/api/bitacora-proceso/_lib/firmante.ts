import { prisma } from '../../../../lib/prisma';
import { getOtAccessForUser, personaActivaEmpresa, verificarPinPersona, type ConfirmanteActor } from '../../../../lib/bitacora-proceso/db';
import { metodoConfirmacion, type ConfirmacionInput } from '../../../../lib/bitacora-proceso/firmas';
import { companyOtAccess, OtError, type OtCompanyAccess } from '../../../../lib/bitacora-proceso/rules';
import type { OtRequestContext } from './context';

/**
 * Prepara a quien da un VISTO BUENO (B2/B3, 2026-10-15). Sin contraseña:
 *   - OPERARIO: toca su nombre entre los programados (la capa de datos lo valida);
 *     queda el operario y, aparte, la sesión.
 *   - Supervisor, inspector o jefe EN SU PROPIA SESIÓN (la persona elegida es la de la
 *     sesión): basta «Sí, confirmo» → método «sesion_propia».
 *   - Desde OTRA sesión (la cuenta compartida «Producción» de la tablet): la persona
 *     elige su nombre y escribe SU PIN de 4 dígitos; el servidor lo valida (bcrypt, con
 *     bloqueo a los 5 fallos) → método «pin_tablet».
 * Se guarda el id de LA PERSONA (no el de la sesión) y, aparte, el de la sesión.
 */
export interface ConfirmanteDeps {
  /** Usuario ACTIVO de la empresa con ese id, o null. */
  persona: (idUser: string, idCompany: number) => Promise<{ id: string; email: string; name: string | null } | null>;
  /** Acceso al módulo de esa persona (por correo). */
  acceso: (email: string) => Promise<OtCompanyAccess[]>;
  /** Valida el PIN (lanza OtError 403/409/423). */
  verificarPin: (idUser: string, pin: string, nombre: string, sesionEmail: string) => Promise<void>;
}

export function confirmanteDeps(): ConfirmanteDeps {
  return {
    persona: (idUser, idCompany) => personaActivaEmpresa(prisma, idUser, idCompany),
    acceso: (email) => getOtAccessForUser(prisma, email),
    verificarPin: (idUser, pin, nombre, sesionEmail) => verificarPinPersona(prisma, idUser, pin, nombre, sesionEmail),
  };
}

export async function prepararConfirmante(
  ctx: OtRequestContext,
  idCompany: number,
  input: ConfirmacionInput,
  userAgent: string | null,
  deps: ConfirmanteDeps = confirmanteDeps()
): Promise<ConfirmanteActor> {
  const base = { rol: input.rol, sesion: { idUser: ctx.actor.idUser, email: ctx.email }, ip: ctx.actor.ip, userAgent };
  if (input.rol === 'OPERARIO') {
    return { ...base, idUser: null, idOperador: input.idOperador, email: ctx.email, nombre: null, access: null, metodo: metodoConfirmacion(input, ctx.actor.idUser) };
  }
  const metodo = metodoConfirmacion(input, ctx.actor.idUser);
  const persona = await deps.persona(input.persona ?? '', idCompany);
  if (!persona) throw new OtError('La persona elegida no es un usuario activo de la empresa.', 400);
  const nombre = persona.name?.trim() || persona.email;
  if (metodo === 'pin_tablet') await deps.verificarPin(persona.id, input.pin ?? '', nombre, ctx.email);
  const access = companyOtAccess(await deps.acceso(persona.email), idCompany);
  return { ...base, idUser: persona.id, idOperador: null, email: persona.email, nombre, access, metodo };
}
