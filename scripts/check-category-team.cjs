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

  console.log('=== Miembros por categoría (user_category_request_general) ===');
  const cat = await pool.request().query(`
    SELECT cr.category, u.name
    FROM user_category_request_general ucrg
    INNER JOIN category_request cr ON cr.id = ucrg.id_category
    INNER JOIN [user] u ON u.id = ucrg.id_user
    WHERE cr.category LIKE '%Tecno%' OR u.name LIKE '%Rivera%' OR u.name LIKE '%Rojas%'
    ORDER BY cr.category, u.name
  `);
  console.table(cat.recordset);

  console.log('\n=== Todos los usuarios en procesos donde participa Nicolás Rivera ===');
  const all = await pool.request().query(`
    SELECT DISTINCT LTRIM(RTRIM(u.name)) AS usuario, pc.process
    FROM user_process_category_request_general upcrg
    INNER JOIN process_category pc ON pc.id = upcrg.id_process_category
    INNER JOIN [user] u ON u.id = upcrg.id_user
    WHERE upcrg.id_process_category IN (
      SELECT id_process_category FROM user_process_category_request_general up2
      INNER JOIN [user] ul ON ul.id = up2.id_user
      WHERE ul.name LIKE '%Nicol%Rivera%'
    )
    ORDER BY pc.process, usuario
  `);
  console.table(all.recordset);

  // ¿Vista vw tiene más columnas de equipo?
  console.log('\n=== Columnas vw_requests_general ===');
  const cols = await pool.request().query('SELECT TOP 1 * FROM vw_requests_general');
  console.log(Object.keys(cols.recordset[0] || {}));

  // Solicitud 305 - todas las tareas sin filtro fecha
  console.log('\n=== Solicitud 305 - todas las tareas (equipo real asignado) ===');
  const s305 = await pool.request().query(`
    SELECT id_tarea, LTRIM(RTRIM(asignado_tarea)) AS colaborador, estado_tarea, tarea
    FROM vw_tareas_solicitudes WHERE ID_Solicitud = 305
  `);
  console.table(s305.recordset);

  console.log('\n=== Equipo categoría Tecnologia ===');
  const tech = await pool.request().query(`
    SELECT DISTINCT LTRIM(RTRIM(u.name)) AS usuario
    FROM user_category_request_general ucrg
    INNER JOIN category_request cr ON cr.id = ucrg.id_category
    INNER JOIN [user] u ON u.id = ucrg.id_user
    WHERE cr.category LIKE 'Tecnologia%'
    ORDER BY usuario
  `);
  console.table(tech.recordset);

  await pool.close();
}

main().catch(console.error);
