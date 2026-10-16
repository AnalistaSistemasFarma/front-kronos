#!/usr/bin/env node
/**
 * RESPALDO LÓGICO del esquema `sgc` (SGC documental, Sprint 6).
 *
 * Exporta TODAS las tablas del esquema a JSON (una por archivo, en orden de
 * clave primaria), con un manifiesto que deja: base, servidor, fecha UTC,
 * commit, migraciones del SGC registradas, conteo y huella SHA-256 de cada
 * tabla, estructura (columnas, índices, CHECK, FK, triggers y su estado) y el
 * resultado de la verificación de la cadena de firmas al momento del respaldo.
 *
 * Complementa (no reemplaza) el respaldo completo de la base que hace
 * infraestructura: permite restaurar y VERIFICAR el SGC por separado.
 *
 * Uso (desde la carpeta del proyecto, con DATABASE_URL en el entorno o en .env):
 *   node scripts/sgc/respaldo/respaldar.mjs --out <carpeta> [--schema sgc]
 * Nunca imprime la cadena de conexión ni datos de las filas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import sql from 'mssql';
import {
  assertSchemaName,
  databaseUrlFromEnv,
  mssqlConfigFromUrl,
  normalizeRow,
  readCatalog,
  readRows,
  readStructure,
  sha256Hex,
  tableDigest,
  verifyAllChains,
} from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const out = arg('out');
const schema = assertSchemaName(arg('schema', 'sgc'));
if (!out) {
  console.error('Uso: node scripts/sgc/respaldo/respaldar.mjs --out <carpeta> [--schema sgc]');
  process.exit(2);
}

const cfg = mssqlConfigFromUrl(databaseUrlFromEnv(fs));
fs.mkdirSync(path.join(out, 'tablas'), { recursive: true });
const pool = await sql.connect(cfg);
const started = new Date();
try {
  const server = (await pool.request().query('SELECT @@SERVERNAME AS s, DB_NAME() AS db, SYSUTCDATETIME() AS now')).recordset[0];
  const { tables } = await readCatalog(pool, schema);
  if (tables.size === 0) throw new Error(`El esquema ${schema} no tiene tablas en ${server.db}`);
  const manifest = {
    tipo: 'respaldo-logico-sgc/v1',
    base: server.db,
    servidor: server.s,
    esquema: schema,
    inicio_utc: started.toISOString(),
    commit: (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    })(),
    migraciones: [],
    tablas: {},
    estructura: null,
    cadena_firmas: null,
    fin_utc: null,
  };
  const mig = await pool
    .request()
    .query("IF OBJECT_ID(N'dbo._prisma_migrations', N'U') IS NOT NULL SELECT migration_name, checksum, finished_at FROM dbo._prisma_migrations WHERE migration_name LIKE N'%sgc%' ORDER BY migration_name");
  manifest.migraciones = (mig.recordset ?? []).map((m) => ({ nombre: m.migration_name, checksum: m.checksum, aplicada_utc: m.finished_at?.toISOString?.() ?? null }));

  // Las tablas se leen una tras otra (READ COMMITTED): para un respaldo coherente entre tablas se corre
  // sin uso del módulo (ventana del pase o fuera de horario). La verificación posterior lo comprueba.
  for (const t of [...tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const rows = await readRows(pool, schema, t);
    const cols = t.columns.map((c) => c.name);
    const norm = rows.map((r) => normalizeRow(r, cols));
    const file = path.join('tablas', `${t.name}.json`);
    const body = JSON.stringify({ tabla: t.name, columnas: t.columns, clave: t.pk, identidad: t.identity, filas: norm });
    fs.writeFileSync(path.join(out, file), body);
    manifest.tablas[t.name] = { filas: norm.length, huella_filas: tableDigest(norm), archivo: file, sha256_archivo: sha256Hex(body) };
    if (t.name === 'signature') manifest.cadena_firmas = verifyAllChains(rows);
  }
  manifest.estructura = await readStructure(pool, schema);
  manifest.fin_utc = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'manifiesto.json'), JSON.stringify(manifest, null, 2));
  const total = Object.values(manifest.tablas).reduce((a, t) => a + t.filas, 0);
  console.log(`Respaldo de ${schema} en ${server.db}: ${tables.size} tablas, ${total} filas.`);
  console.log(`Cadena de firmas: ${(manifest.cadena_firmas ?? []).map((c) => `empresa ${c.idCompany} ${c.ok ? 'íntegra' : 'ROTA'} (${c.checked})`).join('; ') || 'sin firmas'}`);
  console.log(`Manifiesto: ${path.join(out, 'manifiesto.json')} (sha256 ${sha256Hex(fs.readFileSync(path.join(out, 'manifiesto.json')))})`);
} catch (e) {
  console.error('ERROR del respaldo:', e.message);
  process.exitCode = 1;
} finally {
  await pool.close();
}
