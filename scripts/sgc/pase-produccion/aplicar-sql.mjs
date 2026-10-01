#!/usr/bin/env node
/**
 * Aplica uno o varios archivos .sql (lotes separados por GO) contra la base del
 * .env del proyecto (DATABASE_URL de Prisma), para el PASE del SGC documental.
 *
 * - Muestra la base destino y se NIEGA a tocar KRONOSDB sin --confirmo-produccion.
 * - Detiene la ejecución en el primer error (no sigue con el siguiente archivo).
 * - Deja un registro (hora, archivo, SHA-256 del archivo, duración y resultado)
 *   en --registro <archivo> (por defecto pase-sgc-sql-<fecha>.log).
 * - Nunca imprime la cadena de conexión.
 *
 * Uso (desde la carpeta del proyecto en el servidor):
 *   node scripts/sgc/pase-produccion/aplicar-sql.mjs [--confirmo-produccion] [--registro x.log] a.sql b.sql ...
 */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { databaseUrlFromEnv, mssqlConfigFromUrl, sha256Hex } from '../respaldo/lib.mjs';

const args = process.argv.slice(2);
const confirm = args.includes('--confirmo-produccion');
const regIdx = args.indexOf('--registro');
const regFile = regIdx >= 0 ? args[regIdx + 1] : `pase-sgc-sql-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
const files = args.filter((a, i) => !a.startsWith('--') && !(regIdx >= 0 && i === regIdx + 1));
if (!files.length) {
  console.error('Uso: node scripts/sgc/pase-produccion/aplicar-sql.mjs [--confirmo-produccion] [--registro x.log] a.sql ...');
  process.exit(2);
}
const cfg = mssqlConfigFromUrl(databaseUrlFromEnv(fs));
if (/^KRONOSDB$/i.test(cfg.database) && !confirm) {
  console.error(`La base destino es ${cfg.database} (PRODUCCIÓN): agregue --confirmo-produccion (solo con la autorización del pase).`);
  process.exit(2);
}
const log = (line) => {
  const l = `${new Date().toISOString()} ${line}`;
  console.log(l);
  fs.appendFileSync(regFile, `${l}\n`);
};
const pool = await sql.connect(cfg);
log(`Base destino: ${cfg.database} en ${cfg.server}`);
try {
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const batches = text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
    const t0 = Date.now();
    log(`== ${path.basename(file)} (sha256 ${sha256Hex(text).slice(0, 16)}…, ${batches.length} lote/s)`);
    for (const b of batches) {
      const r = await pool.request().batch(b);
      for (const rs of r.recordsets ?? []) log(`   ${JSON.stringify(rs).slice(0, 4000)}`);
    }
    log(`   OK en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} catch (e) {
  log(`ERROR: ${e.message}`);
  log('Se detuvo la ejecución. Revise el error y aplique la reversa del paso si corresponde.');
  process.exitCode = 1;
} finally {
  await pool.close();
}
