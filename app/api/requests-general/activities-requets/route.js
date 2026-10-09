import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

const MAX_IDS = 500;

/**
 * Tareas de solicitudes generales.
 *   ?id=5          → tareas de una solicitud
 *   ?ids=5,6,7     → tareas de esas solicitudes (las listas piden solo las de la página visible)
 *   sin parámetros → todas (comportamiento histórico; evitarlo, es la tabla completa)
 */
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const idsParam = searchParams.get('ids');
    const ids = idsParam
      ? [
          ...new Set(
            idsParam
              .split(',')
              .map((v) => Number.parseInt(v.trim(), 10))
              .filter((v) => Number.isInteger(v) && v > 0)
          ),
        ].slice(0, MAX_IDS)
      : null;

    // Lista de ids vacía (página sin solicitudes): nada que buscar.
    if (ids && ids.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Sin los JOIN a process_category* / uex, que no se usaban en el SELECT y podían repetir tareas.
    let query = `
        SELECT
          rg.id as id_request_general,
          trg.id,
          tpc.task,
          trg.id_status,
          sc.status as status_task,
          trg.resolution,
          u.name as assigned
        FROM task_request_general trg
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
          INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
          LEFT JOIN [user] u ON u.id = trg.id_assigned
          INNER JOIN [user] urq ON urq.id = rg.id_requester
          INNER JOIN company c ON c.id_company = rg.id_company
        WHERE 1=1
    `;

    const recordset = await withMssqlPool(async (pool) => {
      const request = pool.request();

      if (id) {
        query += ` AND rg.id = @id`;
        request.input('id', sql.Int, Number.parseInt(id, 10));
      }
      if (ids) {
        const names = ids.map((value, i) => {
          request.input(`id${i}`, sql.Int, value);
          return `@id${i}`;
        });
        query += ` AND trg.id_request_general IN (${names.join(', ')})`;
      }

      query += ` ORDER BY rg.id, trg.id ASC`;
      const result = await request.query(query);
      return result.recordset;
    });

    return NextResponse.json(recordset, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
