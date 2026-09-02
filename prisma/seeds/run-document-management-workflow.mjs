/**
 * Ejecuta prisma/seeds/document-management-workflow.sql (siembra el proceso
 * "Gestión Documental — Ciclo de vida del documento" y sus 14 tareas en
 * process_category/task_process_category). El SQL ya es idempotente
 * (APPEND-ONLY, WHERE NOT EXISTS), así que este script se puede re-correr
 * cuantas veces haga falta sin duplicar nada — útil, por ejemplo, cuando la
 * base de pruebas se refresca/restaura y el proceso sembrado desaparece
 * (pasó el 2026-08-21 → 2026-09-01 en KRONOSDB_PRUEBAS).
 *
 * Uso:
 *   node prisma/seeds/run-document-management-workflow.mjs
 *
 * Conecta con SAPSENDSQL_* del .env actual (mismo patrón que
 * run-dashboard-permisos.mjs, vía dbconfig.js/buildMssqlConfig()).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dbconfig from '../../dbconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'document-management-workflow.sql');

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
    console.log(`\n--- Diagnóstico: tareas sembradas para "Gestión Documental — Ciclo de vida del documento" ---`);
    console.table(diagnostic);
    if (!diagnostic?.length) {
      console.warn('ADVERTENCIA: el SELECT de diagnóstico no devolvió filas. Revise manualmente.');
    } else if (diagnostic.length !== 14) {
      console.warn(`ADVERTENCIA: se esperaban 14 tareas y quedaron ${diagnostic.length}.`);
    } else {
      console.log('OK: 14/14 tareas sembradas y activas.');
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error corriendo el seed de Gestión Documental:', err);
  process.exit(1);
});
