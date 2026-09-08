/**
 * Ejecuta prisma/seeds/document-management-generic-fields.sql (siembra los campos
 * genéricos de "Gestión Documental" en process_form_field / process_form_field_option --
 * parametrización pedida por Nicolás tras el Sprint 5). El SQL ya es idempotente
 * (APPEND-ONLY, WHERE NOT EXISTS), así que este script se puede re-correr cuantas veces
 * haga falta sin duplicar nada -- útil, por ejemplo, si se necesita resembrar las
 * opciones de "Tipo de documento" manualmente.
 *
 * Uso:
 *   node prisma/seeds/run-document-management-generic-fields.mjs
 *
 * Conecta con las variables del .env actual (mismo patrón que
 * run-document-management-regulatory-subprocess.mjs).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dbconfig from '../../dbconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'document-management-generic-fields.sql');

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
    console.log(`\n--- Diagnóstico: campos genéricos de Gestión Documental (id_process_category=86) ---`);
    console.table(diagnostic);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error corriendo el seed de campos genéricos de Gestión Documental:', err);
  process.exit(1);
});
