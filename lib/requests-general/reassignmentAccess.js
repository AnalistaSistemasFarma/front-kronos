import { getServerSession } from 'next-auth';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { prisma } from '../prisma';

export const REASSIGNMENT_MODULE_URL = '/process/request-general/reassignment-workflow-request';
export const REASSIGNMENT_MODULE_NAME = 'Reasignación Flujos y Solicitudes';

/**
 * Server-side gate for the reassignment module APIs.
 * Requires a session AND a grant on the module subprocess (subprocess_user_company),
 * and returns the departments the caller belongs to so every query can be scoped to them.
 * Returns { error: { message, status } } when access must be denied.
 */
export async function getReassignmentAccess() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id != null ? String(session.user.id) : '';
  if (!userId) return { error: { message: 'No autorizado', status: 401 } };

  const [grants, departmentRows] = await Promise.all([
    prisma.subprocessUserCompany.findMany({
      where: {
        companyUser: { id_user: userId },
        subprocess: {
          OR: [{ subprocess_url: REASSIGNMENT_MODULE_URL }, { subprocess: REASSIGNMENT_MODULE_NAME }],
        },
      },
      select: { id_subprocess_user_company: true },
      take: 1,
    }),
    prisma.departmentUser.findMany({ where: { id_user: userId }, select: { id_department: true } }),
  ]);
  if (grants.length === 0) return { error: { message: 'No tienes permiso para este módulo', status: 403 } };

  const departmentIds = [...new Set(departmentRows.map((d) => Number(d.id_department)))].filter(Number.isInteger);
  if (departmentIds.length === 0) return { error: { message: 'No perteneces a ningún departamento', status: 403 } };

  return { session, userId, departmentIds };
}

/**
 * Keeps only the requested department ids the caller belongs to.
 * When nothing is requested, falls back to all of the caller's departments (never "all departments").
 */
export function scopeDepartmentIds(requested, allowed) {
  const allowedSet = new Set(allowed);
  if (!requested || requested.length === 0) return [...allowed];
  return requested.filter((id) => allowedSet.has(id));
}
