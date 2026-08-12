/**
 * Ejecuta el seed de Dashboard personal / Dashboard solicitudes.
 * Uso:
 *   node prisma/seeds/run-dashboard-permisos.mjs
 *   node prisma/seeds/run-dashboard-permisos.mjs tu.email@empresa.com
 *   node prisma/seeds/run-dashboard-permisos.mjs email1@x.com,email2@x.com
 *
 * Conecta con SAPSENDSQL_* / DATABASE_URL del .env actual.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dbconfig from '../../dbconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'dashboard-solicitante-solicitado-permisos.sql');

const emailsArg = process.argv[2]?.trim();
const emails = (emailsArg || process.env.ADMIN_EMAIL || 'automatizacion@gsslatam.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

function buildConfig() {
  if (typeof dbconfig.buildMssqlConfig === 'function') {
    return dbconfig.buildMssqlConfig();
  }
  return dbconfig;
}

async function ensureModulesAndGrant(pool, email) {
  let raw = fs.readFileSync(seedPath, 'utf8');
  raw = raw.replace(
    /DECLARE @AdminEmail NVARCHAR\(255\) = N?'[^']*';/,
    `DECLARE @AdminEmail NVARCHAR(255) = N'${email.replace(/'/g, "''")}';`
  );

  const result = await pool.request().query(raw);
  const sets = Array.isArray(result.recordsets) ? result.recordsets : [];
  const diagnostic = sets[sets.length - 1] ?? result.recordset ?? [];
  return diagnostic;
}

async function main() {
  const cfg = buildConfig();
  console.log(`Conectando a ${cfg.server}/${cfg.database} como ${cfg.user}`);
  console.log(`Emails a otorgar: ${emails.join(', ')}`);

  const pool = await sql.connect(cfg);
  try {
    for (const email of emails) {
      console.log(`\n--- Seed para ${email} ---`);
      const rows = await ensureModulesAndGrant(pool, email);
      if (!rows?.length) {
        console.log(
          'Subprocesos creados/actualizados, pero este email no tiene company_user o ya tenía permisos sin filas nuevas en el SELECT.'
        );
        const check = await pool
          .request()
          .input('email', sql.NVarChar(255), email)
          .query(`
            SELECT u.email, c.company, s.subprocess, s.subprocess_url
            FROM [dbo].[subprocess_user_company] suc
            JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
            JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
            JOIN [dbo].[user] u ON u.id = cu.id_user
            JOIN [dbo].[company] c ON c.id_company = cu.id_company
            WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(@email)))
              AND s.subprocess_url IN (
                N'/process/request-general/dashboard-solicitante',
                N'/process/request-general/dashboard-solicitado'
              )
            ORDER BY s.subprocess, c.company
          `);
        console.table(check.recordset);
      } else {
        console.table(rows);
      }
    }

    const catalog = await pool.request().query(`
      SELECT id_subprocess, subprocess, subprocess_url
      FROM [dbo].[subprocess]
      WHERE subprocess_url IN (
        N'/process/request-general/dashboard-solicitante',
        N'/process/request-general/dashboard-solicitado'
      )
      ORDER BY subprocess
    `);
    console.log('\nCatálogo de subprocesos:');
    console.table(catalog.recordset);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error ejecutando seed:', err);
  process.exit(1);
});
