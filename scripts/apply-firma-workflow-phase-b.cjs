const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const root = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m || process.env[m[1].trim()] !== undefined) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
(async () => {
  const db = require('../dbconfig.js').default || require('../dbconfig.js');
  const pool = await sql.connect(typeof db.buildMssqlConfig === 'function' ? db.buildMssqlConfig() : db);
  const sqlText = fs.readFileSync(
    path.join(root, 'prisma', 'seeds', 'firma-proceso-84-workflow-phase-b.sql'),
    'utf8'
  );
  await pool.request().query(sqlText);
  const tasks = await pool.request().input('pid', sql.Int, 84).query(`
    SELECT id, task, display_order, is_sequential, is_authorization, active
    FROM task_process_category WHERE id_process_category = @pid AND active = 1
    ORDER BY display_order, id
  `);
  console.table(tasks.recordset);
  await pool.close();
})();
