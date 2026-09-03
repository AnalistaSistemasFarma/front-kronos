const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const root = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m || process.env[m[1].trim()] !== undefined) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

/** Asigna responsables a tareas "Aceptar turno" del proceso FIRMA 84 */
const TURN_ASSIGNEES = [
  { taskId: 139, email: 'juan.fonseca@gsslatam.com' },
  // Completar con emails reales de dueño, gerente y empleado:
  // { taskId: 141, email: 'dueno@...' },
];

(async () => {
  const db = require('../dbconfig.js').default || require('../dbconfig.js');
  const pool = await sql.connect(typeof db.buildMssqlConfig === 'function' ? db.buildMssqlConfig() : db);

  for (const row of TURN_ASSIGNEES) {
    const user = await pool
      .request()
      .input('email', sql.NVarChar(255), row.email)
      .query(`SELECT TOP 1 id FROM [user] WHERE LOWER(email) = LOWER(@email)`);
    const userId = user.recordset[0]?.id;
    if (!userId) {
      console.warn(`Sin usuario: ${row.email}`);
      continue;
    }
    const exists = await pool
      .request()
      .input('task', sql.Int, row.taskId)
      .input('user', sql.NVarChar(255), userId)
      .query(
        `SELECT 1 FROM user_task_request_general WHERE id_task = @task AND id_user = @user`
      );
    if (exists.recordset.length === 0) {
      await pool
        .request()
        .input('task', sql.Int, row.taskId)
        .input('user', sql.NVarChar(255), userId)
        .query(`INSERT INTO user_task_request_general (id_task, id_user) VALUES (@task, @user)`);
      console.log(`Asignado ${row.email} → tarea ${row.taskId}`);
    }
  }

  await pool.close();
})();
