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

  const leader = 'Nicolás Rivera';

  console.log('=== Solicitudes con UsuarioAsignado ~ Nicolás Rivera ===');
  const reqs = await pool.request().query(`
    SELECT NumeroSolicitud, UsuarioAsignado, Proceso, EstadoSolicitud
    FROM vw_requests_general
    WHERE LTRIM(RTRIM(UsuarioAsignado)) LIKE '%Nicol%Rivera%'
    ORDER BY NumeroSolicitud DESC
  `);
  console.log('Solicitudes:', reqs.recordset.length);
  console.table(reqs.recordset.slice(0, 15));

  const ids = reqs.recordset.map((r) => r.NumeroSolicitud);
  if (ids.length === 0) {
    await pool.close();
    return;
  }

  console.log('\n=== Tareas (asignado_tarea) para esas solicitudes ===');
  const tasks = await pool.request().query(`
    SELECT t.ID_Solicitud, t.id_tarea, t.asignado_tarea, t.estado_tarea, t.tarea
    FROM vw_tareas_solicitudes t
    WHERE t.ID_Solicitud IN (${ids.slice(0, 50).join(',')})
    ORDER BY t.ID_Solicitud, t.asignado_tarea
  `);
  console.table(tasks.recordset);

  const byAssignee = {};
  for (const row of tasks.recordset) {
    const name = (row.asignado_tarea || '').trim() || 'Sin asignar';
    byAssignee[name] = (byAssignee[name] || 0) + 1;
  }
  console.log('\nColaboradores distintos (asignado_tarea):', Object.keys(byAssignee).length);
  console.log(byAssignee);

  console.log('\n=== Variantes de nombre UsuarioAsignado con Rivera ===');
  const variants = await pool.request().query(`
    SELECT UsuarioAsignado, COUNT(*) AS n
    FROM vw_requests_general
    WHERE UsuarioAsignado LIKE '%Rivera%'
    GROUP BY UsuarioAsignado
  `);
  console.table(variants.recordset);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
