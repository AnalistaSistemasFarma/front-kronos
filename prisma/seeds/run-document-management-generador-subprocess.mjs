/**
 * Ejecuta prisma/seeds/document-management-generador-subprocess.sql (siembra el
 * subproceso '/process/document-management/generador' que independiza el
 * permiso del Generador de Documentos del permiso general de Gestión
 * Documental -- fix pedido por Nicolás, 2026-09-02). El SQL ya es idempotente
 * (APPEND-ONLY, WHERE NOT EXISTS), así que este script se puede re-correr
 * cuantas veces haga falta sin duplicar nada.
 *
 * Uso:
 *   node prisma/seeds/run-document-management-generador-subprocess.mjs
 *
 * Conecta con SAPSENDSQL_* del .env actual (mismo patrón que
 * run-document-management-regulatory-subprocess.mjs).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dbconfig from '../../dbconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'document-management-generador-subprocess.sql');

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
    console.log(`\n--- Diagnóstico: acceso al Generador de Documentos ---`);
    console.table(diagnostic);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error corriendo el seed del subproceso del Generador de Documentos:', err);
  process.exit(1);
});
