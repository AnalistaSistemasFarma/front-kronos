import { prisma } from '../prisma';
import type { Requester } from './drafts';

/**
 * Resuelve el solicitante de SAPSEND para el usuario de la sesion EN UNA EMPRESA.
 * SOLO servidor: el navegador nunca envia U_SEND_UserId ni U_SEND_Dep.
 *
 * Cada SAPSEND (Farmalogica, OLP, Ryan, ...) tiene su propia base, asi que el ID
 * de perfil y el de departamento cambian por empresa. Por eso salen de
 * company_user (usuario x empresa), no de User:
 *  - U_SEND_UserId <- company_user.id_user_sapsend
 *  - U_SEND_Dep    <- company_user.id_department_sapsend (SAP lo guarda como texto)
 * Si faltan, se rechaza: no se adivina, porque el departamento define la bandeja
 * de autorizacion y quien ve la solicitud en SAPSEND.
 */
export type RequesterResult = { ok: true; requester: Requester } | { ok: false; error: string };

export async function resolveRequester(email: string, companyId: number): Promise<RequesterResult> {
  const row = await prisma.companyUser.findFirst({
    where: { id_company: companyId, user: { email } },
    select: {
      id_user_sapsend: true,
      id_department_sapsend: true,
      user: { select: { name: true, email: true } },
    },
  });

  if (!row) return { ok: false, error: 'Su usuario no esta asociado a esta empresa.' };
  if (row.id_user_sapsend == null) {
    return { ok: false, error: 'Su usuario no tiene perfil de SAPSEND configurado en esta empresa.' };
  }
  if (row.id_department_sapsend == null) {
    return { ok: false, error: 'Su usuario no tiene departamento de SAPSEND configurado en esta empresa.' };
  }

  return {
    ok: true,
    requester: {
      sapsendUserId: row.id_user_sapsend,
      name: row.user.name ?? row.user.email,
      email: row.user.email,
      departmentId: String(row.id_department_sapsend),
    },
  };
}
