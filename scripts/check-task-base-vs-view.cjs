const fs = require('fs');
const path = require('path');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const envPath = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    break;
  }
}

loadEnv();

async function main() {
  const sql = require('mssql');
  const { buildMssqlConfig } = require('../dbconfig');
  const pool = await sql.connect(buildMssqlConfig());

  const ids = [315, 330, 334];
  console.log('=== task_request_general vs vista (solicitudes jun) ===');
  for (const id of ids) {
    const base = await pool.request().query(`
      SELECT trg.id, tpc.task, u.name AS asignado, sc.status
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      INNER JOIN [user] u ON u.id = trg.id_assigned
      INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
      WHERE trg.id_request_general = ${id}
    `);
    const view = await pool.request().query(`
      SELECT id_tarea, tarea, asignado_tarea, estado_tarea
      FROM vw_tareas_solicitudes WHERE ID_Solicitud = ${id}
    `);
    console.log('\nSolicitud', id);
    console.log('Base:', base.recordset);
    console.log('Vista:', view.recordset);
  }

  // ¿Hay endpoint de actividades por líder?
  console.log('\n=== Distintos asignado_tarea en vw para todo jun 2026 ===');
  const jun = await pool.request().query(`
    SELECT LTRIM(RTRIM(asignado_tarea)) AS colaborador, COUNT(*) n
    FROM vw_tareas_solicitudes
    WHERE CAST(fecha_creacion_solicitud AS DATE) >= '2026-06-01'
      AND CAST(fecha_creacion_solicitud AS DATE) <= '2026-06-05'
    GROUP BY LTRIM(RTRIM(asignado_tarea))
    ORDER BY n DESC
  `);
  console.table(jun.recordset);

  await pool.close();
}

main().catch(console.error);
