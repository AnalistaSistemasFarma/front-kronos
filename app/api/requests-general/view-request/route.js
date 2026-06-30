import { NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID de solicitud es requerido' }, { status: 400 });
    }

    const query = `
      SELECT
        rg.id,
        cr.category as category,
        cr.id as id_category,
        pc.process as process,
        rg.[user] as usuario,
        rg.[description],
        rg.id_company,
        c.company,
        rg.created_at,
        rg.id_requester,
        urq.email as requester_email,
        urq.name as requester,
        rg.status_req,
        pc.id as id_process_category,
        pc.assigned as assignedUserId,
        assignedUser.name as assignedUserName,
        rg.subject_request, 
        rg.resolution as resolutioncase, 
        rg.date_resolution,
		    uex.name as executor_final,
        rg.url
      FROM requests_general rg
      INNER JOIN company c ON c.id_company = rg.id_company
      LEFT JOIN [user] urq ON urq.id = rg.id_requester
	    INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
      INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
      LEFT JOIN category_request cr ON cr.id = pc.id_category_request
	    INNER JOIN user_process_category_request_general upcrg ON upcrg.id_process_category = pc.id
      INNER JOIN [user] assignedUser ON assignedUser.id = upcrg.id_user
	    LEFT JOIN [user] uex ON uex.id = rg.id_executor_final
      WHERE rg.id = @id
    `;

    const result = await withMssqlPool(async (pool) => {
      return pool.request().input('id', sql.Int, Number(id)).query(query);
    });

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0], { status: 200 });
  } catch (err) {
    console.error('Error al obtener la solicitud:', err);
    return NextResponse.json(
      { error: 'Error al obtener la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
