/**
 * Crea la empresa FARMADOSIS en [company] si no existe.
 * Uso: node scripts/ensure-farmadosis-company.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import sql from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'scripts', '.farmadosis-company-result.json');

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

function patchEnvCompanyId(companyId) {
  const envPath = path.join(root, '.env');
  let text = fs.readFileSync(envPath, 'utf8');
  if (/^FARMADOSIS_COMPANY_ID=/m.test(text)) {
    text = text.replace(/^FARMADOSIS_COMPANY_ID=.*$/m, `FARMADOSIS_COMPANY_ID=${companyId}`);
  } else {
    text += `\nFARMADOSIS_COMPANY_ID=${companyId}\n`;
  }
  fs.writeFileSync(envPath, text, 'utf8');
}

async function main() {
  loadEnv();
  const dbconfig = (await import(pathToFileURL(path.join(root, 'dbconfig.js')).href)).default;
  const cfg =
    typeof dbconfig.buildMssqlConfig === 'function'
      ? dbconfig.buildMssqlConfig()
      : dbconfig;

  const pool = await sql.connect(cfg);
  try {
    const existing = await pool.request().query(`
      SELECT TOP 1 id_company, company
      FROM company
      WHERE LOWER(LTRIM(RTRIM(company))) IN ('farmadosis', 'farmadosis s.a.', 'farmadosis sa')
         OR LOWER(company) LIKE 'farmadosis%'
      ORDER BY id_company
    `);

    let row = existing.recordset[0];
    let created = false;

    if (!row) {
      const inserted = await pool.request().input('name', sql.NVarChar(255), 'FARMADOSIS').query(`
        INSERT INTO company (company)
        OUTPUT INSERTED.id_company, INSERTED.company
        VALUES (@name)
      `);
      row = inserted.recordset[0];
      created = true;
    }

    patchEnvCompanyId(row.id_company);

    const result = {
      created,
      id_company: row.id_company,
      company: row.company,
      env: `FARMADOSIS_COMPANY_ID=${row.id_company}`,
    };
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(created ? 'Empresa creada:' : 'Empresa ya existía:');
    console.log(`  id_company=${row.id_company}  company=${row.company}`);
    console.log(`  .env actualizado: FARMADOSIS_COMPANY_ID=${row.id_company}`);
    console.log('Reinicia npm run dev para cargar el nuevo valor.');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  try {
    fs.writeFileSync(outPath, JSON.stringify({ error: String(err) }, null, 2));
  } catch {
    /* ignore */
  }
  process.exit(1);
});
