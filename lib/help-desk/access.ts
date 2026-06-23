import { getPool } from '../mssqlPool';
import { prisma } from '../prisma';
import { isHelpDeskProcess } from '../process/helpDeskNavigation';
import { MY_TICKETS_SCOPE_SQL, REQUESTER_JOINS } from './requesterSql';
import { isHelpDeskTechnician } from './technicians';

export type HelpDeskUserRole = {
  /** Puede entrar al módulo (técnico o con subproceso de mesa de ayuda). */
  hasModuleAccess: boolean;
  /** Técnico del roster (subproceso 1): panel general de todos los casos. */
  isOperator: boolean;
  /** Puede ver "Mis tickets" (casos propios o asignados al usuario). */
  isRequester: boolean;
};

async function hasHelpDeskSubprocessAssignment(userEmail: string): Promise<boolean> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: {
        user: { email: userEmail.trim() },
      },
    },
    select: {
      subprocess: {
        select: { process: { select: { process: true } } },
      },
    },
  });

  return rows.some((r) => isHelpDeskProcess(r.subprocess.process.process));
}

/**
 * Rol en mesa de ayuda:
 * - isOperator = está en el roster de técnicos (panel general de todos los casos).
 * - isRequester = puede usar "Mis tickets" (técnicos y solicitantes con acceso al módulo).
 */
export async function getHelpDeskUserRole(userEmail: string): Promise<HelpDeskUserRole> {
  if (!userEmail?.trim()) {
    return { hasModuleAccess: false, isOperator: false, isRequester: false };
  }

  try {
    const isOperator = await isHelpDeskTechnician(userEmail);
    const hasSubprocess = await hasHelpDeskSubprocessAssignment(userEmail);
    const hasModuleAccess = isOperator || hasSubprocess;
    const isRequester = hasModuleAccess;

    return { hasModuleAccess, isOperator, isRequester };
  } catch (error) {
    console.error('Error resolving help desk role:', error);
    return { hasModuleAccess: false, isOperator: false, isRequester: false };
  }
}

export async function checkHelpDeskAccess(userEmail: string): Promise<boolean> {
  const role = await getHelpDeskUserRole(userEmail);
  return role.hasModuleAccess;
}

/** Técnico del roster: listado general, editar y reasignar. */
export async function checkHelpDeskOperatorAccess(userEmail: string): Promise<boolean> {
  return isHelpDeskTechnician(userEmail);
}

export async function checkHelpDeskRequesterAccess(userEmail: string): Promise<boolean> {
  const role = await getHelpDeskUserRole(userEmail);
  return role.isRequester;
}

/** Técnicos: cualquier caso. Demás usuarios: solo casos propios (mis tickets). */
export async function canViewHelpDeskCase(userEmail: string, caseId: number): Promise<boolean> {
  if (!userEmail?.trim() || !Number.isFinite(caseId)) return false;
  if (await isHelpDeskTechnician(userEmail)) return true;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('user_email', userEmail.trim())
      .input('id_case', caseId)
      .query(`
        SELECT TOP 1 c.id_case
        FROM [case] c
        ${REQUESTER_JOINS}
        WHERE c.id_case = @id_case AND ${MY_TICKETS_SCOPE_SQL}
      `);

    return result.recordset.length > 0;
  } catch (error) {
    console.error('Error checking ticket visibility:', error);
    return false;
  }
}

export { isHelpDeskTechnician };
