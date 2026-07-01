/**
 * Audita casos cerrados sin id_executor_final.
 *
 * Uso:
 *   node scripts/audit-missing-executor-final.cjs
 *   node scripts/audit-missing-executor-final.cjs --database=KRONOSDB
 */
const fs = require('fs');
const path = require('path');

const CONNECTION_KEYS = new Set([
  'DATABASE_URL',
  'SAPSENDSQL_SERVER',
  'SAPSENDSQL_BD',
  'SAPSENDSQL_USER',
  'SAPSENDSQL_PASS',
]);

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const envPath = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (CONNECTION_KEYS.has(key) || !process.env[key]) {
        process.env[key] = value;
      }
    }
    break;
  }
}

function parseArgs() {
  const databaseArg = process.argv.find((arg) => arg.startsWith('--database='));
  return {
    database: databaseArg ? databaseArg.split('=')[1]?.trim() : null,
  };
}

function patchDatabaseUrl(database) {
  const current = process.env.DATABASE_URL || '';
  if (!current) return;
  if (/database=[^;]+/i.test(current)) {
    process.env.DATABASE_URL = current.replace(/database=[^;]+/i, `database=${database}`);
  }
}

const SUMMARY_SQL = `
SELECT
  sc.id_status_case,
  sc.status,
  COUNT(*) AS total_cerrados,
  SUM(
    CASE
      WHEN NULLIF(LTRIM(RTRIM(CAST(c.id_executor_final AS NVARCHAR(255)))), '') IS NULL
      THEN 1 ELSE 0
    END
  ) AS sin_executor_final,
  SUM(
    CASE
      WHEN NULLIF(LTRIM(RTRIM(CAST(c.id_executor_final AS NVARCHAR(255)))), '') IS NOT NULL
      THEN 1 ELSE 0
    END
  ) AS con_executor_final
FROM [case] c
INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
WHERE c.id_status_case IN (2, 3)
GROUP BY sc.id_status_case, sc.status
ORDER BY sc.id_status_case
`;

const SAMPLE_SQL = `
SELECT TOP 20
  c.id_case,
  sc.status,
  c.subject_case,
  c.creation_date,
  c.end_date,
  u_asig.name AS tecnico_asignado
FROM [case] c
INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
LEFT JOIN [user] u_asig ON u_asig.id = cu.id_user
WHERE c.id_status_case IN (2, 3)
  AND NULLIF(LTRIM(RTRIM(CAST(c.id_executor_final AS NVARCHAR(255)))), '') IS NULL
ORDER BY COALESCE(c.end_date, c.creation_date) DESC, c.id_case DESC
`;

async function main() {
  loadEnv();

  const { database } = parseArgs();
  if (database) {
    process.env.SAPSENDSQL_BD = database;
    patchDatabaseUrl(database);
  }

  const { resolveConnection, buildMssqlConfig } = require('../dbconfig');
  const configured = resolveConnection();
  if (!configured.server || !configured.database) {
    throw new Error('No se pudo resolver la conexión desde .env');
  }

  console.log(`Base: ${configured.server}/${configured.database}\n`);

  const sql = require('mssql');
  const pool = await sql.connect(buildMssqlConfig());

  const dbRow = await pool.request().query('SELECT DB_NAME() AS db');
  console.log(`Conectado a: ${dbRow.recordset[0]?.db}\n`);

  const summary = await pool.request().query(SUMMARY_SQL);
  console.log('=== Resumen por estado ===');
  console.table(summary.recordset);

  const totalSin = summary.recordset.reduce(
    (acc, row) => acc + Number(row.sin_executor_final || 0),
    0
  );
  const totalCon = summary.recordset.reduce(
    (acc, row) => acc + Number(row.con_executor_final || 0),
    0
  );
  console.log(`\nTotal cerrados sin executor_final: ${totalSin}`);
  console.log(`Total cerrados con executor_final:   ${totalCon}`);

  if (totalSin > 0) {
    const sample = await pool.request().query(SAMPLE_SQL);
    console.log('\n=== Muestra (hasta 20 casos sin registro) ===');
    console.table(sample.recordset);
  }

  await pool.close();
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
