/**
 * Ejecuta prisma/seeds/chat-agents.sql — siembra el módulo "Asistentes IA":
 * empresa GSS (por NOMBRE), proceso + subprocesos de permiso, el agente Orus
 * y su vínculo con GSS, y otorga los permisos al administrador.
 *
 * El SQL es idempotente (APPEND-ONLY, WHERE NOT EXISTS), así que se puede
 * re-correr cuantas veces haga falta sin duplicar nada.
 *
 * Uso:
 *   node prisma/seeds/run-chat-agents.mjs
 *
 * Conecta con SAPSENDSQL_* del .env actual (mismo patrón que
 * run-service-layer-metrics-permisos.mjs, vía dbconfig.js/buildMssqlConfig()).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dbconfig from '../../dbconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, 'chat-agents.sql');

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
    const [agents = [], subprocesses = [], grants = []] = sets.slice(-3);

    console.log('\n--- Agentes sembrados y su empresa ---');
    console.table(agents);
    console.log('\n--- Subprocesos del módulo (esto es el permiso) ---');
    console.table(subprocesses);
    console.log('\n--- Permisos otorgados ---');
    console.table(grants);

    if (!agents.length) {
      console.warn('ADVERTENCIA: no quedó ningún agente vinculado a una empresa.');
      process.exitCode = 1;
      return;
    }
    if (subprocesses.length < 2) {
      console.warn('ADVERTENCIA: se esperaban 2 subprocesos (/process/chat y /process/chat/orus).');
      process.exitCode = 1;
      return;
    }
    if (!grants.length) {
      console.warn(
        'ADVERTENCIA: nadie quedó con el permiso. Revise que el correo del admin exista en [dbo].[user].'
      );
      return;
    }
    console.log('\nOK: módulo "Asistentes IA" sembrado.');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error corriendo el seed de Asistentes IA:', err);
  process.exit(1);
});
