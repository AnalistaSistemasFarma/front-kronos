import 'server-only';
import { prisma } from '../prisma';
import { getEnabledBalanceCompanies } from './companies';

/**
 * Permisos del módulo de Balances — mismo esquema que Asistente de Pagos
 * (process -> subprocess -> subprocess_user_company), un único subproceso.
 *
 * La activación se resuelve en dos capas, ambas obligatorias: filas de
 * `subprocess_user_company` y el interruptor `enabled` en companies.ts. El
 * despliegue actual solo puede conceder Farmalogica; permisos para OLP/GSS no
 * bastan mientras sus interruptores permanezcan apagados. Sin filas de permiso
 * el módulo queda invisible (fail-closed), no roto.
 */

export const BALANCES_URL = '/process/balances';

export async function getUserAccessibleCompanies(userEmail: string): Promise<number[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: BALANCES_URL },
    },
    select: { companyUser: { select: { id_company: true } } },
  });
  const ids = new Set(rows.map((r) => r.companyUser.id_company));
  // Acotado a las empresas activas en código. Así una concesión anticipada en
  // KRONOSDB no puede habilitar accidentalmente OLP/GSS.
  return getEnabledBalanceCompanies().map((c) => c.idCompany).filter((id) => ids.has(id));
}

export async function userCanAccessCompany(userEmail: string, companyId: number): Promise<boolean> {
  const accessible = await getUserAccessibleCompanies(userEmail);
  return accessible.includes(companyId);
}
