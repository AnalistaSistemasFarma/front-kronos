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
  const cfg = typeof db.buildMssqlConfig === 'function' ? db.buildMssqlConfig() : db;
  const pool = await sql.connect(cfg);
  try {
    const r = await pool.request().query(`
      SELECT TOP 5 id, name, email
      FROM [user]
      WHERE isActive = 1
        AND email IS NOT NULL
        AND email != ''
      ORDER BY name ASC
    `);
    console.log('OK', r.recordset.length, 'users');
    console.table(r.recordset);
  } catch (e) {
    console.error('QUERY FAILED:', e.message);
  }
  await pool.close();
})();
