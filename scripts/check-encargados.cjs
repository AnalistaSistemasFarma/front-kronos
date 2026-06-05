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

  const leaders = await pool.request().query(`
    SELECT TOP 15 UsuarioAsignado, COUNT(*) AS solicitudes
    FROM vw_requests_general
    WHERE UsuarioAsignado IS NOT NULL AND LTRIM(RTRIM(UsuarioAsignado)) <> ''
    GROUP BY UsuarioAsignado
    ORDER BY solicitudes DESC
  `);
  console.log('Líderes (UsuarioAsignado):', leaders.recordset);

  const sample = await pool.request().query(`
    SELECT TOP 5
      t.ID_Solicitud,
      t.asignado_tarea,
      rg.UsuarioAsignado
    FROM vw_tareas_solicitudes t
    LEFT JOIN vw_requests_general rg ON rg.NumeroSolicitud = t.ID_Solicitud
  `);
  console.log('Muestra tarea → líder:', sample.recordset);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
