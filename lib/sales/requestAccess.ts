import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { prisma } from '../prisma';
import { getSalesAccess } from './access';

/**
 * ¿Puede el usuario ver la oferta de venta enlazada a esta solicitud? El solicitante,
 * quien tenga o haya tenido una tarea de ella (autorizadores), el pool del tipo de
 * autorización de sus tareas en la empresa, o quien lea Ventas en la empresa.
 * Mismo criterio que Compras (lib/purchases/requestAccess.ts).
 */
export async function canReadLinkedSale(email: string, requestId: number, idCompany: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return false;
  const pool = await sql.connect(sqlConfig);
  const r = await pool
    .request()
    .input('req', sql.Int, requestId)
    .input('u', sql.NVarChar(50), user.id)
    .query(`
      SELECT TOP 1 1 AS ok FROM requests_general rg
      WHERE rg.id = @req AND (
        rg.id_requester = @u
        OR EXISTS (SELECT 1 FROM task_request_general t
                   WHERE t.id_request_general = rg.id AND (t.id_assigned = @u OR t.id_executor_final = @u))
        OR EXISTS (
          SELECT 1 FROM task_request_general t
          INNER JOIN task_process_category tpc ON tpc.id = t.id_task
          WHERE t.id_request_general = rg.id AND tpc.is_authorization = 1 AND tpc.type_authorization IS NOT NULL
            AND tpc.type_authorization IN (SELECT ut.type_authorization FROM user_types_authorization ut WHERE ut.id_user = @u)
            AND rg.id_company IN (SELECT cu.id_company FROM company_user cu WHERE cu.id_user = @u)
        )
      );`);
  if (r.recordset.length > 0) return true;
  return (await getSalesAccess(email)).some((a) => a.idCompany === idCompany && a.canRead);
}
