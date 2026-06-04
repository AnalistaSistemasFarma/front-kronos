/**
 * Cuenta solicitudes (requests_general) por año-mes.
 * Uso: node scripts/count-solicitudes-por-mes.mjs
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

const QUERY = `
  SELECT
    YEAR(rg.created_at) AS anio,
    MONTH(rg.created_at) AS mes,
    DATENAME(MONTH, rg.created_at) AS nombre_mes,
    COUNT(*) AS total_solicitudes
  FROM requests_general rg
  GROUP BY
    YEAR(rg.created_at),
    MONTH(rg.created_at),
    DATENAME(MONTH, rg.created_at)
  ORDER BY anio DESC, mes DESC;
`;

const QUERY_TOTAL = `
  SELECT COUNT(*) AS total_general FROM requests_general;
`;

let pool;
try {
  pool = await sql.connect(sqlConfig);
  console.log('\n=== Solicitudes por mes (requests_general.created_at) ===\n');

  const byMonth = await pool.request().query(QUERY);
  const rows = byMonth.recordset;

  if (rows.length === 0) {
    console.log('No hay solicitudes en la tabla.');
  } else {
    let sum = 0;
    const pad = (n) => String(n).padStart(2, '0');
    for (const r of rows) {
      sum += r.total_solicitudes;
      console.log(
        `${r.anio}-${pad(r.mes)}  ${String(r.nombre_mes).padEnd(12)}  ${r.total_solicitudes}`
      );
    }
    console.log('─'.repeat(40));
    console.log(`SUMA por meses listados: ${sum}`);
  }

  const total = await pool.request().query(QUERY_TOTAL);
  console.log(`\nTotal en tabla (sin filtro de fecha): ${total.recordset[0]?.total_general ?? 0}`);

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const detalle = await pool.request().query(`
    SELECT
      rg.id,
      CAST(rg.created_at AS DATE) AS fecha,
      rg.subject_request AS asunto,
      sc.status AS estado
    FROM requests_general rg
    LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
    WHERE YEAR(rg.created_at) = ${y} AND MONTH(rg.created_at) = ${m}
    ORDER BY rg.created_at DESC
  `);
  console.log(`\n=== Detalle mes actual (${y}-${String(m).padStart(2, '0')}) ===\n`);
  for (const r of detalle.recordset) {
    console.log(`  #${r.id}  ${r.fecha?.toISOString?.()?.slice(0, 10) ?? r.fecha}  ${r.estado ?? '—'}  ${(r.asunto ?? '').slice(0, 50)}`);
  }
  console.log(`\nCantidad este mes: ${detalle.recordset.length}\n`);
} catch (err) {
  console.error('Error conectando o consultando:', err.message);
  process.exit(1);
} finally {
  if (pool?.connected) await pool.close();
}
