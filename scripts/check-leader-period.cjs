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

  // Periodo mensual aprox (jun 2026)
  const dateFrom = '2026-06-01';
  const dateTo = '2026-06-05';

  console.log(`=== Tareas periodo ${dateFrom} → ${dateTo} para líder Nicolás Rivera ===`);
  const q = await pool.request().query(`
    SELECT t.ID_Solicitud, t.asignado_tarea, t.estado_tarea, t.tarea,
           rg.UsuarioAsignado
    FROM vw_tareas_solicitudes t
    INNER JOIN vw_requests_general rg ON rg.NumeroSolicitud = t.ID_Solicitud
    WHERE LTRIM(RTRIM(rg.UsuarioAsignado)) = 'Nicolás Rivera'
      AND CAST(t.fecha_creacion_solicitud AS DATE) >= '${dateFrom}'
      AND CAST(t.fecha_creacion_solicitud AS DATE) <= '${dateTo}'
    ORDER BY t.asignado_tarea
  `);
  console.table(q.recordset);

  const byAssignee = {};
  for (const row of q.recordset) {
    const name = (row.asignado_tarea || '').trim();
    byAssignee[name] = (byAssignee[name] || 0) + 1;
  }
  console.log('Colaboradores en periodo:', byAssignee);

  // YTD ene-jun 2026
  console.log('\n=== Tareas ene-jun 2026 para Nicolás Rivera ===');
  const q2 = await pool.request().query(`
    SELECT LTRIM(RTRIM(t.asignado_tarea)) AS colaborador, COUNT(*) AS tareas
    FROM vw_tareas_solicitudes t
    INNER JOIN vw_requests_general rg ON rg.NumeroSolicitud = t.ID_Solicitud
    WHERE LTRIM(RTRIM(rg.UsuarioAsignado)) = 'Nicolás Rivera'
      AND CAST(t.fecha_creacion_solicitud AS DATE) >= '2026-01-01'
      AND CAST(t.fecha_creacion_solicitud AS DATE) <= '2026-06-05'
    GROUP BY LTRIM(RTRIM(t.asignado_tarea))
    ORDER BY tareas DESC
  `);
  console.table(q2.recordset);

  // Buscar tablas/vistas de equipo por líder
  console.log('\n=== Columnas en vw_tareas_solicitudes ===');
  const cols = await pool.request().query(`
    SELECT TOP 1 * FROM vw_tareas_solicitudes
  `);
  console.log(Object.keys(cols.recordset[0] || {}));

  // ¿Hay vista de usuarios por proceso/categoría?
  console.log('\n=== Tablas con user y process/category ===');
  const tables = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%user%process%' OR TABLE_NAME LIKE '%user%category%'
    ORDER BY TABLE_NAME
  `);
  console.table(tables.recordset);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
