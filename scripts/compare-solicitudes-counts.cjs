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

  const ranges = [
    ['2026-06-01', '2026-06-05'],
    ['2026-06-01', '2026-06-30'],
    ['2026-01-01', '2026-06-05'],
  ];

  for (const [from, to] of ranges) {
    console.log(`\n=== ${from} → ${to} ===`);

    const r = await pool
      .request()
      .input('df', from)
      .input('dt', to)
      .query(`
        SELECT COUNT(*) AS cnt FROM vw_requests_general
        WHERE CAST([FechaCreación] AS DATE) >= CAST(@df AS DATE)
          AND CAST([FechaCreación] AS DATE) <= CAST(@dt AS DATE)
      `);

    const t = await pool
      .request()
      .input('df', from)
      .input('dt', to)
      .query(`
        SELECT COUNT(*) AS task_rows, COUNT(DISTINCT ID_Solicitud) AS distinct_sol
        FROM vw_tareas_solicitudes
        WHERE CAST(fecha_creacion_solicitud AS DATE) >= CAST(@df AS DATE)
          AND CAST(fecha_creacion_solicitud AS DATE) <= CAST(@dt AS DATE)
      `);

    const missing = await pool
      .request()
      .input('df', from)
      .input('dt', to)
      .query(`
        SELECT COUNT(*) AS cnt FROM vw_requests_general rg
        WHERE CAST(rg.[FechaCreación] AS DATE) >= CAST(@df AS DATE)
          AND CAST(rg.[FechaCreación] AS DATE) <= CAST(@dt AS DATE)
          AND NOT EXISTS (
            SELECT 1 FROM vw_tareas_solicitudes t WHERE t.ID_Solicitud = rg.NumeroSolicitud
          )
      `);

    const extra = await pool
      .request()
      .input('df', from)
      .input('dt', to)
      .query(`
        SELECT COUNT(DISTINCT t.ID_Solicitud) AS cnt
        FROM vw_tareas_solicitudes t
        WHERE CAST(t.fecha_creacion_solicitud AS DATE) >= CAST(@df AS DATE)
          AND CAST(t.fecha_creacion_solicitud AS DATE) <= CAST(@dt AS DATE)
          AND NOT EXISTS (
            SELECT 1 FROM vw_requests_general rg WHERE rg.NumeroSolicitud = t.ID_Solicitud
          )
      `);

    console.log('vw_requests_general (FechaCreación):', r.recordset[0].cnt);
    console.log('vw_tareas (distinct ID_Solicitud):', t.recordset[0].distinct_sol, '| task rows:', t.recordset[0].task_rows);
    console.log('En vw_requests SIN tarea en vw_tareas:', missing.recordset[0].cnt);
    console.log('En vw_tareas SIN match en vw_requests:', extra.recordset[0].cnt);
  }

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
