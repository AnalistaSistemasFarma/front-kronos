/**
 * Crea categoría + proceso de firma digital con campo orion_signature.
 * Uso: node scripts/seed-orion-workflow.mjs --email=tu@correo.com
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import sql from 'mssql';

const ORION_SIGNATURE_FIELD_TYPE = 'orion_signature';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) throw new Error('No se encontró .env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function parseArgs() {
  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  const companyArg = process.argv.find((a) => a.startsWith('--company='));
  return {
    email: emailArg ? emailArg.split('=').slice(1).join('=').trim() : null,
    companyId: companyArg ? Number(companyArg.split('=')[1]) : Number(process.env.FARMADOSIS_COMPANY_ID || 7),
  };
}

async function findUser(pool, email) {
  if (email) {
    const r = await pool
      .request()
      .input('email', sql.NVarChar(255), email)
      .query(`SELECT TOP 1 id, name, email FROM [user] WHERE LOWER(email) = LOWER(@email)`);
    if (r.recordset[0]) return r.recordset[0];
  }
  const any = await pool
    .request()
    .query(`SELECT TOP 1 id, name, email FROM [user] WHERE email IS NOT NULL ORDER BY id`);
  return any.recordset[0] || null;
}

async function main() {
  loadEnv();
  const { email, companyId } = parseArgs();
  const dbconfig = (await import(pathToFileURL(path.join(root, 'dbconfig.js')).href)).default;
  const cfg = typeof dbconfig.buildMssqlConfig === 'function' ? dbconfig.buildMssqlConfig() : dbconfig;
  const pool = await sql.connect(cfg);

  const user = await findUser(pool, email);
  if (!user) throw new Error('No hay usuario con email en [user]. Use --email=tu@correo.com');

  const company = await pool
    .request()
    .input('id', sql.Int, companyId)
    .query(`SELECT id_company, company FROM company WHERE id_company = @id`);
  if (!company.recordset[0]) throw new Error(`Empresa ${companyId} no existe`);

  const PROCESS_NAME = 'Firma de documento';
  const CATEGORY_NAME = 'Firma digital';

  let categoryId;
  const cat = await pool.request().query(`
    SELECT TOP 1 id FROM category_request WHERE LOWER(LTRIM(RTRIM(category))) = LOWER('${CATEGORY_NAME}')
  `);
  if (cat.recordset[0]) {
    categoryId = cat.recordset[0].id;
  } else {
    const ins = await pool
      .request()
      .input('category', sql.NVarChar(255), CATEGORY_NAME)
      .query(`INSERT INTO category_request (category) OUTPUT INSERTED.id VALUES (@category)`);
    categoryId = ins.recordset[0].id;
  }

  await pool
    .request()
    .input('cid', sql.Int, categoryId)
    .input('co', sql.Int, companyId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM company_category_request WHERE id_category_request = @cid AND id_company = @co)
      INSERT INTO company_category_request (id_category_request, id_company) VALUES (@cid, @co)
    `);

  let processId;
  const proc = await pool
    .request()
    .input('name', sql.NVarChar(1000), PROCESS_NAME)
    .query(`
      SELECT TOP 1 id FROM process_category
      WHERE LOWER(LTRIM(RTRIM(process))) = LOWER(@name)
      ORDER BY active DESC, id DESC
    `);
  if (proc.recordset[0]) {
    processId = proc.recordset[0].id;
    await pool.request().input('id', sql.Int, processId).query(`UPDATE process_category SET active = 1 WHERE id = @id`);
  } else {
    const ins = await pool
      .request()
      .input('process', sql.NVarChar(1000), PROCESS_NAME)
      .input('id_category', sql.Int, categoryId)
      .query(`
        INSERT INTO process_category (process, id_category_request, active, id_status)
        OUTPUT INSERTED.id VALUES (@process, @id_category, 1, 6)
      `);
    processId = ins.recordset[0].id;
  }

  const field = await pool
    .request()
    .input('pid', sql.Int, processId)
    .input('ft', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
    .query(`
      SELECT TOP 1 id FROM process_form_field
      WHERE id_process_category = @pid AND field_type = @ft
    `);
  if (!field.recordset[0]) {
    await pool
      .request()
      .input('pid', sql.Int, processId)
      .input('label', sql.NVarChar(255), 'Firma digital')
      .input('ft', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
      .query(`
        INSERT INTO process_form_field (id_process_category, field_label, field_type, required, active, display_order)
        VALUES (@pid, @label, @ft, 0, 1, 0)
      `);
  }

  const task = await pool
    .request()
    .input('pid', sql.Int, processId)
    .query(`SELECT TOP 1 id FROM task_process_category WHERE id_process_category = @pid`);
  if (!task.recordset[0]) {
    const t = await pool
      .request()
      .input('task', sql.NVarChar(1000), 'Gestionar firma del documento')
      .input('pid', sql.Int, processId)
      .query(`
        INSERT INTO task_process_category (task, id_process_category, active, cost, is_sequential, display_order, is_authorization)
        OUTPUT INSERTED.id VALUES (@task, @pid, 1, 0, 0, 0, 0)
      `);
    const taskId = t.recordset[0].id;
    await pool
      .request()
      .input('tid', sql.Int, taskId)
      .input('uid', sql.NVarChar(1000), user.id)
      .query(`INSERT INTO user_task_request_general (id_task, id_user) VALUES (@tid, @uid)`);
  }

  await pool
    .request()
    .input('pid', sql.Int, processId)
    .input('uid', sql.NVarChar(1000), user.id)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM user_process_category_request_general WHERE id_process_category = @pid AND id_user = @uid)
      INSERT INTO user_process_category_request_general (id_process_category, id_user) VALUES (@pid, @uid)
    `);

  console.log('Proceso de firma listo:');
  console.log(`  empresa: ${company.recordset[0].company} (id=${companyId})`);
  console.log(`  categoría: ${CATEGORY_NAME} (id=${categoryId})`);
  console.log(`  proceso: ${PROCESS_NAME} (id=${processId})`);
  console.log(`  responsable: ${user.name} <${user.email}>`);
  console.log('\nCrea una solicitud con ese proceso y ábrela para ver el iframe Orion.');

  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
