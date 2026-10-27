import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { getCompanyEndpointForUser, getPurchasesAccess } from './access';
import { companySap } from './authorization';
import { sapLogin, type SapSession } from '../sap/serviceLayer';
import { prisma } from '../prisma';

/**
 * ¿Puede el usuario ver la solicitud de compra enlazada a esta solicitud general?
 * El solicitante, quien tenga o haya tenido una tarea de ella, el pool de
 * Autorizaciones (tipo + departamento del solicitante + empresa) o quien lea
 * Compras en la empresa. Lo usan el detalle y los anexos.
 */
export async function canReadLinkedPurchase(email: string, requestId: number, idCompany: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return false;

  const pool = await sql.connect(sqlConfig);
  const involved = await pool
    .request()
    .input('req', sql.Int, requestId)
    .input('u', sql.NVarChar(50), user.id)
    .query(`
      SELECT TOP 1 1 AS ok FROM requests_general rg
      WHERE rg.id = @req AND (
        rg.id_requester = @u
        OR EXISTS (SELECT 1 FROM task_request_general t
                   WHERE t.id_request_general = rg.id AND (t.id_assigned = @u OR t.id_executor_final = @u))
        -- Pool de Autorizaciones (mismo criterio que authorization-activities): tipo de autorización
        -- del usuario + mismo departamento del solicitante + empresa accesible.
        OR EXISTS (
          SELECT 1 FROM task_request_general t
          INNER JOIN task_process_category tpc ON tpc.id = t.id_task
          WHERE t.id_request_general = rg.id AND t.id_assigned IS NULL
            AND tpc.is_authorization = 1 AND tpc.type_authorization IS NOT NULL
            AND tpc.type_authorization IN (SELECT ut.type_authorization FROM user_types_authorization ut WHERE ut.id_user = @u)
            AND rg.id_company IN (
              SELECT cu.id_company FROM company_user cu
              INNER JOIN subprocess_user_company suc ON suc.id_company_user = cu.id_company_user
              WHERE cu.id_user = @u)
            AND EXISTS (
              SELECT 1 FROM department_user du_c
              INNER JOIN department_user du_a ON du_a.id_department = du_c.id_department
              WHERE du_c.id_user = rg.id_requester AND du_a.id_user = @u)
        )
      );`);
  const canRead =
    involved.recordset.length > 0 ||
    (await getPurchasesAccess(email)).some((a) => a.idCompany === idCompany && a.canRead);
  return canRead;
}

/**
 * Sesion SAP para LEER los adjuntos: con permiso de Compras en la empresa, la del
 * usuario; si llega `requestId` (detalle en Mis solicitudes o Autorizaciones), la de
 * la empresa cuando el usuario puede ver esa solicitud y el borrador es el enlazado.
 * null = sin acceso.
 */
export async function readPurchaseSession(email: string, companyId: number, docEntry: number, requestId: number | null): Promise<SapSession | null> {
  const company = await getCompanyEndpointForUser(email, companyId);
  if (company?.endpoint) return sapLogin(company.endpoint);
  if (!requestId) return null;
  const link = await prisma.purchaseAuthorization.findUnique({ where: { id_request_general: requestId } });
  if (!link || link.id_company !== companyId || link.doc_entry !== docEntry) return null;
  if (!(await canReadLinkedPurchase(email, requestId, companyId))) return null;
  return companySap(companyId);
}
