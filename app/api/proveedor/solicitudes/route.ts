import { NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { getSupplierIdentityFromSession } from '../../../../lib/proveedor/session';

/**
 * Listado de solicitudes del PROVEEDOR autenticado.
 * GET /api/proveedor/solicitudes
 *
 * AISLAMIENTO (crítico):
 *  - Deny by default: sin sesión tipo Proveedor válida → 401.
 *  - El scoping se hace SIEMPRE por el id de usuario derivado de la SESIÓN del
 *    servidor (ident.userId), nunca por un id/NIT enviado por el cliente.
 *  - El filtro rg.id_requester = @idUser garantiza que solo se devuelven las
 *    solicitudes cuyo solicitante es este proveedor.
 */
export async function GET() {
  try {
    const ident = await getSupplierIdentityFromSession();
    if (!ident) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const result = await withMssqlPool((pool) =>
      pool
        .request()
        .input('idUser', sql.NVarChar(255), ident.userId)
        .query(`
          SELECT
            rg.id,
            rg.subject_request AS subject,
            rg.[description],
            rg.created_at,
            rg.date_resolution,
            rg.status_req AS id_status,
            sc.status,
            c.company,
            cr.category,
            pc.process
          FROM requests_general rg
          INNER JOIN company c ON c.id_company = rg.id_company
          INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
          LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
          LEFT JOIN category_request cr ON cr.id = pc.id_category_request
          WHERE rg.id_requester = @idUser
          ORDER BY rg.created_at DESC
        `)
    );

    return NextResponse.json({ solicitudes: result.recordset }, { status: 200 });
  } catch (err) {
    console.error('Error en /api/proveedor/solicitudes GET:', err);
    return NextResponse.json({ error: 'Error procesando la solicitud' }, { status: 500 });
  }
}
