/**
 * Activa categoría FIRMA y verifica vínculo con FARMADOSIS.
 * Uso: node scripts/fix-firma-category.cjs
 */
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

  const companyId = Number(process.env.FARMADOSIS_COMPANY_ID || 7);

  await pool.request().query(`
    UPDATE category_request SET active = 1
    WHERE category = 'FIRMA' AND (active IS NULL OR active = 0)
  `);

  const cat = await pool.request().query(`
    SELECT TOP 1 id, category, active FROM category_request WHERE category = 'FIRMA' ORDER BY id DESC
  `);
  const categoryId = cat.recordset[0]?.id;
  if (!categoryId) {
    console.error('No existe categoría FIRMA');
    process.exit(1);
  }

  await pool
    .request()
    .input('cid', sql.Int, categoryId)
    .input('co', sql.Int, companyId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM company_category_request WHERE id_category_request = @cid AND id_company = @co)
      INSERT INTO company_category_request (id_category_request, id_company) VALUES (@cid, @co)
    `);

  const visible = await pool.request().input('co', sql.Int, companyId).query(`
    SELECT cr.id, cr.category, cr.active
    FROM company_category_request ccr
    INNER JOIN category_request cr ON cr.id = ccr.id_category_request
    WHERE ccr.id_company = @co AND cr.active = 1 AND cr.category = 'FIRMA'
  `);

  console.log('\n✓ Categoría FIRMA lista para FARMADOSIS:');
  console.log(visible.recordset[0] || '(revisa id_company)');

  const proc = await pool.request().input('cid', sql.Int, categoryId).query(`
    SELECT id, process, active FROM process_category
    WHERE id_category_request = @cid AND process LIKE '%firma%'
  `);
  console.log('\nProcesos (deben tener active=1):');
  for (const p of proc.recordset) {
    console.log(`  id=${p.id} ${p.process} active=${p.active}`);
    if (!p.active) {
      await pool.request().input('id', sql.Int, p.id).query('UPDATE process_category SET active = 1 WHERE id = @id');
      console.log('  → activado');
    }
  }

  console.log('\nRecarga Crear solicitud y elige FARMADOSIS → categoría FIRMA → firmas proceso');
  await pool.close();
})();
