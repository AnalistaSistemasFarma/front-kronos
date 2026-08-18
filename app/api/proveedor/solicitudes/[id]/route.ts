import { NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../../lib/mssqlPool';
import { getSupplierIdentityFromSession } from '../../../../../lib/proveedor/session';
import { assertOwnership } from '../../../../../lib/proveedor/isolation';

/**
 * Detalle de UNA solicitud del proveedor autenticado + sus respuestas de formulario.
 * GET /api/proveedor/solicitudes/[id]
 *
 * AISLAMIENTO / anti-IDOR (crítico):
 *  - Deny by default: sin sesión tipo Proveedor válida → 401.
 *  - El id de la solicitud llega por la URL (cliente), pero el dueño se deriva de la
 *    SESIÓN. La consulta filtra por rg.id_requester = @idUser, así que un proveedor
 *    JAMÁS obtiene una solicitud que no sea suya.
 *  - Doble control: además del WHERE, se valida la propiedad con assertOwnership.
 *  - Si la solicitud no existe o no es suya → 404 (no se filtra su existencia).
 *  - Las respuestas del formulario se leen SOLO tras confirmar la propiedad.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ident = await getSupplierIdentityFromSession();
    if (!ident) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const requestId = parseInt(id, 10);
    if (!requestId || Number.isNaN(requestId)) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    const data = await withMssqlPool(async (pool) => {
      const requestResult = await pool
        .request()
        .input('id', sql.Int, requestId)
        .input('idUser', sql.NVarChar(255), ident.userId)
        .query(`
          SELECT
            rg.id,
            rg.id_requester,
            rg.subject_request AS subject,
            rg.[description],
            rg.created_at,
            rg.date_resolution,
            rg.resolution,
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
          WHERE rg.id = @id AND rg.id_requester = @idUser
        `);

      const request = requestResult.recordset[0];
      if (!request) return null;

      // Defensa en profundidad: confirma la propiedad antes de exponer nada.
      if (!assertOwnership(request.id_requester, ident.userId)) return null;

      const valuesResult = await pool
        .request()
        .input('id', sql.Int, requestId)
        .query(`
          SELECT
            f.field_label,
            f.field_type,
            rfv.value_text,
            o.option_label
          FROM request_form_value rfv
          INNER JOIN process_form_field f ON f.id = rfv.id_form_field
          LEFT JOIN process_form_field_option o ON o.id = rfv.id_option
          WHERE rfv.id_request_general = @id
          ORDER BY f.display_order, f.id
        `);

      // No exponemos id_requester al cliente (dato interno de scoping).
      delete request.id_requester;

      return { solicitud: request, campos: valuesResult.recordset };
    });

    if (!data) {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error('Error en /api/proveedor/solicitudes/[id] GET:', err);
    return NextResponse.json({ error: 'Error procesando la solicitud' }, { status: 500 });
  }
}
