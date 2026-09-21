import 'server-only';
import { prisma } from '../prisma';
import { BALANCE_COMPANIES } from './companies';

/**
 * Permisos del módulo de Balances — mismo esquema que Asistente de Pagos
 * (process -> subprocess -> subprocess_user_company), un único subproceso.
 *
 * ⚠️ PENDIENTE DE ACTIVACIÓN EN BASE DE DATOS (NO ejecutado por este cambio,
 * a propósito — es dato de producción, no código): hace falta UNA fila en
 * `subprocess` con `subprocess_url = BALANCES_URL` (colgada de algún
 * `process` existente, p.ej. "Gestión de Procesos" o uno nuevo "Finanzas"),
 * y una fila en `subprocess_user_company` por cada (usuario, empresa) que
 * deba ver el botón — al menos Nicolás Rivera x {Farmalogica, OLP, GSS} para
 * poder probarlo en testing. Sin esas filas, `userCanAccessCompany` devuelve
 * false para todos y el módulo queda invisible (fail-closed), no roto.
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
  // Acotado SIEMPRE a las 3 empresas del Sprint 1, aunque el permiso en BD
  // llegara a incluir otra (defensa en profundidad mientras no exista el SQL
  // de las demás empresas).
  return BALANCE_COMPANIES.map((c) => c.idCompany).filter((id) => ids.has(id));
}

export async function userCanAccessCompany(userEmail: string, companyId: number): Promise<boolean> {
  const accessible = await getUserAccessibleCompanies(userEmail);
  return accessible.includes(companyId);
}
