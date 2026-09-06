/**
 * Ejecuta prisma/seeds/document-management-process-categories.sql (siembra
 * el catálogo de categorías de proceso documental del Sprint 9: Auditorías
 * y Autoinspecciones, No Conformidades, Ingeniería Biomédica, con sus
 * sub-procesos). El SQL ya es idempotente (APPEND-ONLY, WHERE NOT EXISTS),
 * así que este script se puede re-correr cuantas veces haga falta sin
 * duplicar nada -- útil si la base de pruebas se refresca/restaura.
 *
 * Uso:
 *   node prisma/seeds/run-document-management-process-categories.mjs
 *
 * Conecta con SAPSENDSQL_* del .env actual (mismo patrón que
 * run-document-management-workflow.mjs).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dbconfig from '../../dbconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'document-management-process-categories.sql');

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
    console.log(`\n--- Diagnóstico: catálogo de categorías de proceso documental ---`);
    console.table(diagnostic);
    const categorias = new Set(diagnostic.map((r) => r.categoria));
    if (categorias.size !== 3) {
      console.warn(`ADVERTENCIA: se esperaban 3 categorías y quedaron ${categorias.size}.`);
    } else if (diagnostic.length !== 27) {
      console.warn(`ADVERTENCIA: se esperaban 27 sub-procesos en total y quedaron ${diagnostic.length}.`);
    } else {
      console.log('OK: 3 categorías / 27 sub-procesos sembrados y activos.');
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error corriendo el seed de categorías de proceso documental:', err);
  process.exit(1);
});
