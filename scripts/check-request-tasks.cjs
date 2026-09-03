const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const root = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m || process.env[m[1].trim()] !== undefined) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const requestId = Number(process.argv[2] || 2088);

(async () => {
  const db = require('../dbconfig.js').default || require('../dbconfig.js');
  const cfg = typeof db.buildMssqlConfig === 'function' ? db.buildMssqlConfig() : db;
  const pool = await sql.connect(cfg);

  const r = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT trg.id, trg.id_task, tpc.task, trg.id_status, sc.status,
           u.name AS assigned, u.email
    FROM task_request_general trg
    LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
    INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
    LEFT JOIN [user] u ON u.id = trg.id_assigned
    WHERE trg.id_request_general = @id
    ORDER BY trg.id
  `);

  console.log(`Tareas solicitud #${requestId}:`);
  console.table(r.recordset);
  await pool.close();
})();
