/**
 * Cuenta tickets/casos de mesa de ayuda ([case]) por mes y total.
 * Uso: node scripts/count-tickets.mjs
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

const BY_MONTH = `
  SELECT
    YEAR(c.creation_date) AS anio,
    MONTH(c.creation_date) AS mes,
    DATENAME(MONTH, c.creation_date) AS nombre_mes,
    COUNT(*) AS total_tickets
  FROM [case] c
  GROUP BY
    YEAR(c.creation_date),
    MONTH(c.creation_date),
    DATENAME(MONTH, c.creation_date)
  ORDER BY anio DESC, mes DESC;
`;

const BY_STATUS = `
  SELECT
    sc.status AS estado,
    sc.id_status_case AS id_estado,
    COUNT(*) AS total
  FROM [case] c
  INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
  GROUP BY sc.status, sc.id_status_case
  ORDER BY total DESC;
`;

let pool;
try {
  pool = await sql.connect(sqlConfig);
  console.log('\n=== Tickets (mesa de ayuda) — tabla [case] ===\n');

  const total = await pool.request().query(`SELECT COUNT(*) AS n FROM [case]`);
  console.log(`Total tickets en la base de datos: ${total.recordset[0]?.n ?? 0}\n`);

  console.log('--- Por mes (creation_date) ---\n');
  const months = await pool.request().query(BY_MONTH);
  if (months.recordset.length === 0) {
    console.log('(sin registros)\n');
  } else {
    let sum = 0;
    for (const r of months.recordset) {
      sum += r.total_tickets;
      const pad = (n) => String(n).padStart(2, '0');
      console.log(
        `${r.anio}-${pad(r.mes)}  ${String(r.nombre_mes).padEnd(12)}  ${r.total_tickets}`
      );
    }
    console.log('─'.repeat(42));
    console.log(`Suma por meses listados: ${sum}\n`);
  }

  console.log('--- Por estado ---\n');
  const statuses = await pool.request().query(BY_STATUS);
  for (const r of statuses.recordset) {
    console.log(`  [${r.id_estado}] ${r.estado ?? '—'}: ${r.total}`);
  }
  console.log('');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  if (pool?.connected) await pool.close();
}
