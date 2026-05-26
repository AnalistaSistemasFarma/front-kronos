import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function GET() {
  try {
    const pool = await sql.connect(sqlConfig);

    const [solicitudes, actividades] = await Promise.all([
      pool.request().query('SELECT * FROM vw_requests_general'),
      pool.request().query('SELECT * FROM vw_tareas_solicitudes'),
    ]);

    return Response.json({
      solicitudes: solicitudes.recordset,
      actividades: actividades.recordset,
    });
  } catch (err) {
    console.error('Error exportando dashboard:', err);
    return Response.json({ error: 'Error al obtener datos', details: err.message }, { status: 500 });
  }
}
