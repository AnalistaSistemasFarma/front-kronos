/**
 * Diagnóstico rápido Farmadosis → procesos / empresa / usuario.
 * Uso: node scripts/check-farmadosis-setup.mjs
 */
import sql from 'mssql';
import dbconfig from '../dbconfig.js';

const cfg =
  typeof dbconfig.buildMssqlConfig === 'function'
    ? dbconfig.buildMssqlConfig()
    : dbconfig;

const NAMES = ['Contacto web', 'Calidad web', 'Farmacovigilancia web'];

async function main() {
  const pool = await sql.connect(cfg);

  const names = await pool.request().query(`
    SELECT id, process, active, id_category_request
    FROM process_category
    WHERE LOWER(LTRIM(RTRIM(process))) IN (
      'contacto web', 'calidad web', 'farmacovigilancia web'
    )
    ORDER BY id
  `);
  console.log('=== Procesos por nombre exacto ===');
  console.log(names.recordset.length ? names.recordset : '(ninguno)');

  const related = await pool.request().query(`
    SELECT TOP 40 id, process, active
    FROM process_category
    WHERE LOWER(process) LIKE '%contacto%'
       OR LOWER(process) LIKE '%calidad%'
       OR LOWER(process) LIKE '%farmac%'
       OR LOWER(process) LIKE '%farmadosis%'
       OR LOWER(process) LIKE '%web%'
    ORDER BY id DESC
  `);
  console.log('\n=== Procesos relacionados (contacto/calidad/farmac/web) ===');
  console.log(related.recordset.length ? related.recordset : '(ninguno)');

  const cats = await pool.request().query(`
    SELECT TOP 30 id, category
    FROM category_request
    ORDER BY id DESC
  `);
  console.log('\n=== Categorías recientes ===');
  console.log(cats.recordset);

  const companyId = Number(process.env.FARMADOSIS_COMPANY_ID || 1);
  const company = await pool
    .request()
    .input('id', sql.Int, companyId)
    .query(`SELECT id_company, company FROM company WHERE id_company = @id`);
  console.log('\n=== Empresa FARMADOSIS_COMPANY_ID ===', companyId);
  console.log(company.recordset[0] || '(no existe)');

  const users = await pool.request().query(`
    SELECT TOP 15 id, name, email, role
    FROM [user]
    WHERE email IS NOT NULL
    ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name
  `);
  console.log('\n=== Usuarios candidatos (REQUESTER_USER_ID) ===');
  console.log(users.recordset);

  console.log('\n=== Nombres esperados ===');
  console.log(NAMES.join(' | '));

  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
