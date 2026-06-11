/**
 * Últimos tickets y conteo del mes actual (creation_date).
 * Uso: node scripts/recent-tickets.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
    break;
  }
}

loadEnv();

const sqlConfig = (await import('../dbconfig.js')).default;
const now = new Date();
const y = now.getFullYear();
const m = now.getMonth() + 1;
const d = now.getDate();
const todayStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const utcToday = new Date().toISOString().split('T')[0];

let pool;
try {
  pool = await sql.connect(sqlConfig);
  console.log('\n=== Tickets recientes ===\n');
  console.log(`Fecha local (script): ${todayStr}`);
  console.log(`Fecha UTC (como create_ticket): ${utcToday}\n`);

  const recent = await pool.request().query(`
    SELECT TOP 20
      c.id_case,
      c.creation_date,
      CAST(c.creation_date AS DATE) AS fecha_calendario,
      c.subject_case,
      sc.status
    FROM [case] c
    INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
    ORDER BY c.id_case DESC
  `);

  console.log('--- Últimos 20 por id_case ---\n');
  for (const r of recent.recordset) {
    const fd =
      r.fecha_calendario instanceof Date
        ? r.fecha_calendario.toISOString().slice(0, 10)
        : String(r.fecha_calendario ?? '').slice(0, 10);
    const subj = (r.subject_case || '').slice(0, 50);
    console.log(`  #${r.id_case}  ${fd}  [${r.status}]  ${subj}`);
  }

  const mes = await pool
    .request()
    .input('y', sql.Int, y)
    .input('m', sql.Int, m)
    .query(
      `SELECT COUNT(*) AS n FROM [case] WHERE YEAR(creation_date)=@y AND MONTH(creation_date)=@m`
    );
  const hoy = await pool
    .request()
    .input('today', sql.Date, todayStr)
    .query(
      `SELECT COUNT(*) AS n FROM [case] WHERE CAST(creation_date AS DATE)=CAST(@today AS DATE)`
    );
  const hoyUtc = await pool
    .request()
    .input('today', sql.Date, utcToday)
    .query(
      `SELECT COUNT(*) AS n FROM [case] WHERE CAST(creation_date AS DATE)=CAST(@today AS DATE)`
    );

  console.log(`\n--- Conteos ---`);
  console.log(`Mes ${y}-${String(m).padStart(2, '0')}: ${mes.recordset[0]?.n ?? 0}`);
  console.log(`Hoy (${todayStr}, local): ${hoy.recordset[0]?.n ?? 0}`);
  console.log(`Hoy (${utcToday}, UTC create_ticket): ${hoyUtc.recordset[0]?.n ?? 0}`);
  console.log('');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  if (pool?.connected) await pool.close();
}
