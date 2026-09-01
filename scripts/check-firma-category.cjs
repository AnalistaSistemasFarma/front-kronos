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

  const companies = await pool.request().query(`SELECT id_company, company FROM company WHERE company LIKE '%FARMA%'`);
  console.log('\nEmpresas FARMADOSIS:', companies.recordset);

  for (const co of companies.recordset) {
    const id = co.id_company;
    const cats = await pool.request().input('co', sql.Int, id).query(`
      SELECT cr.id, cr.category, cr.active,
        CASE WHEN ccr.id_company IS NULL THEN 0 ELSE 1 END AS linked_to_company
      FROM category_request cr
      LEFT JOIN company_category_request ccr ON ccr.id_category_request = cr.id AND ccr.id_company = @co
      WHERE cr.category LIKE '%FIRMA%' OR cr.category LIKE '%firma%'
    `);
    console.log(`\n--- Empresa ${co.company} (id=${id}) ---`);
    console.log(cats.recordset);

    const visible = await pool.request().input('co', sql.Int, id).query(`
      SELECT cr.id, cr.category
      FROM company_category_request ccr
      INNER JOIN category_request cr ON cr.id = ccr.id_category_request
      WHERE ccr.id_company = @co AND cr.active = 1
    `);
    console.log('Categorías visibles al crear solicitud:', visible.recordset);
  }

  const procs = await pool.request().query(`
    SELECT pc.id, pc.process, pc.active, pc.id_category_request, cr.category
    FROM process_category pc
    JOIN category_request cr ON cr.id = pc.id_category_request
    WHERE pc.process LIKE '%firma%' OR cr.category LIKE '%FIRMA%'
    ORDER BY pc.id DESC
  `);
  console.log('\nProcesos firma:', procs.recordset);

  await pool.close();
})();
