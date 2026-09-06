/**
 * Ejecuta prisma/seeds/service-layer-metrics-permisos.sql (siembra el
 * subproceso '/process/service-layer-metrics' y otorga acceso a
 * automatizacion@gsslatam.com solo para OLP). El SQL ya es idempotente
 * (APPEND-ONLY, WHERE NOT EXISTS), así que este script se puede re-correr
 * cuantas veces haga falta sin duplicar nada.
 *
 * Uso:
 *   node prisma/seeds/run-service-layer-metrics-permisos.mjs
 *
 * Conecta con SAPSENDSQL_* del .env actual (mismo patrón que
 * run-dashboard-permisos.mjs / run-document-management-workflow.mjs, vía
 * dbconfig.js/buildMssqlConfig()).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dbconfig from '../../dbconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'service-layer-metrics-permisos.sql');

function buildConfig() {
  if (typeof dbconfig.buildMssqlConfig === 'function') {
    return dbconfig.buildMssqlConfig();
  }
  return dbconfig;
}

async function main() {
  const cfg = buildConfig();
  console.log(`Conectando a ${cfg.server}/${cfg.database} como ${cfg.user}`);

  const raw = fs.readFileSync(seedPath, 'utf8');
  const pool = await sql.connect(cfg);
  try {
    const result = await pool.request().query(raw);
    const sets = Array.isArray(result.recordsets) ? result.recordsets : [];
    const diagnostic = sets[sets.length - 1] ?? result.recordset ?? [];
    console.log('\n--- Diagnóstico: acceso otorgado a "Métricas Service Layer" ---');
    console.table(diagnostic);
    if (!diagnostic?.length) {
      console.warn(
        'ADVERTENCIA: el SELECT de diagnóstico no devolvió filas. Revise que automatizacion@gsslatam.com tenga company_user en OLP (id_company=3).'
      );
    } else {
      console.log('OK: acceso otorgado.');
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error corriendo el seed de Métricas Service Layer:', err);
  process.exit(1);
});
