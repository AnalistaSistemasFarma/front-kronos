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

  console.log('=== Usuario Nicolás Rivera en [user] ===');
  const user = await pool.request().query(`
    SELECT id, name, email FROM [user]
    WHERE name LIKE '%Nicol%Rivera%'
  `);
  console.table(user.recordset);

  const userId = user.recordset[0]?.id;
  if (userId) {
    console.log('\n=== Procesos/categorías asignados al usuario (equipo) ===');
    const team = await pool.request().query(`
      SELECT DISTINCT u2.name AS miembro, pc.process, cr.category
      FROM user_process_category_request_general upcrg
      INNER JOIN process_category pc ON pc.id = upcrg.id_process_category
      INNER JOIN category_request cr ON cr.id = pc.id_category_request
      INNER JOIN [user] u2 ON u2.id = upcrg.id_user
      WHERE pc.id IN (
        SELECT DISTINCT pc2.id
        FROM user_process_category_request_general up2
        INNER JOIN process_category pc2 ON pc2.id = up2.id_process_category
        INNER JOIN [user] ul ON ul.id = up2.id_user
        WHERE ul.name LIKE '%Nicol%Rivera%'
      )
      ORDER BY pc.process, u2.name
    `);
    console.table(team.recordset.slice(0, 30));

    const members = await pool.request().query(`
      SELECT DISTINCT u2.name
      FROM user_process_category_request_general upcrg
      INNER JOIN process_category pc ON pc.id = upcrg.id_process_category
      INNER JOIN [user] u2 ON u2.id = upcrg.id_user
      WHERE pc.id IN (
        SELECT DISTINCT pc2.id
        FROM user_process_category_request_general up2
        INNER JOIN process_category pc2 ON pc2.id = up2.id_process_category
        INNER JOIN [user] ul ON ul.id = up2.id_user
        WHERE ul.name LIKE '%Nicol%Rivera%'
      )
    `);
    console.log('\nMiembros distintos en procesos del líder:', members.recordset.length);
    console.table(members.recordset);
  }

  // Colaboradores en solicitudes recientes de Nicolás (jun 2026)
  console.log('\n=== Todas las tareas jun 2026 solicitudes de Nicolás (incl. Nicolas Rojas?) ===');
  const jun = await pool.request().query(`
    SELECT t.ID_Solicitud, LTRIM(RTRIM(t.asignado_tarea)) AS colaborador,
           t.estado_tarea, t.tarea, rg.Proceso
    FROM vw_tareas_solicitudes t
    INNER JOIN vw_requests_general rg ON rg.NumeroSolicitud = t.ID_Solicitud
    WHERE LTRIM(RTRIM(rg.UsuarioAsignado)) = 'Nicolás Rivera'
      AND CAST(t.fecha_creacion_solicitud AS DATE) >= '2026-06-01'
      AND CAST(t.fecha_creacion_solicitud AS DATE) <= '2026-06-05'
  `);
  console.table(jun.recordset);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
