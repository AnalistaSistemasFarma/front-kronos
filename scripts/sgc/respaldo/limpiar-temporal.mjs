#!/usr/bin/env node
/**
 * Quita el esquema TEMPORAL de una prueba de restauración (p. ej. sgc_rst):
 * claves foráneas, triggers, tablas y el esquema. Se niega a tocar `sgc`,
 * `dbo` o cualquier esquema que no empiece por «sgc_».
 *
 * Uso: node scripts/sgc/respaldo/limpiar-temporal.mjs --schema sgc_rst
 */
import fs from 'node:fs';
import sql from 'mssql';
import { assertSchemaName, databaseUrlFromEnv, mssqlConfigFromUrl } from './lib.mjs';

const i = process.argv.indexOf('--schema');
const schema = assertSchemaName(i > 0 ? process.argv[i + 1] : '');
if (!/^sgc_/.test(schema)) {
  console.error('Solo se limpian esquemas temporales que empiecen por «sgc_» (nunca sgc ni dbo).');
  process.exit(2);
}
const pool = await sql.connect(mssqlConfigFromUrl(databaseUrlFromEnv(fs)));
try {
  const q = async (text) => (await pool.request().input('s', schema).query(text)).recordset;
  for (const fk of await q(`SELECT fk.name AS fk, t.name AS tbl FROM sys.foreign_keys fk JOIN sys.tables t ON t.object_id = fk.parent_object_id WHERE SCHEMA_NAME(t.schema_id) = @s`)) {
    await pool.request().batch(`ALTER TABLE [${schema}].[${fk.tbl}] DROP CONSTRAINT [${fk.fk}]`);
  }
  for (const tr of await q(`SELECT tr.name AS trg FROM sys.triggers tr JOIN sys.tables t ON t.object_id = tr.parent_id WHERE SCHEMA_NAME(t.schema_id) = @s`)) {
    await pool.request().batch(`DROP TRIGGER [${schema}].[${tr.trg}]`);
  }
  const tables = await q(`SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(@s)`);
  for (const t of tables) await pool.request().batch(`DROP TABLE [${schema}].[${t.name}]`);
  const left = await q(`SELECT COUNT(*) AS n FROM sys.objects WHERE schema_id = SCHEMA_ID(@s)`);
  if (left[0].n === 0 && (await q(`SELECT 1 AS x FROM sys.schemas WHERE name = @s`)).length) await pool.request().batch(`DROP SCHEMA [${schema}]`);
  console.log(`Esquema temporal ${schema} eliminado (${tables.length} tablas).`);
} catch (e) {
  console.error('ERROR al limpiar:', e.message);
  process.exitCode = 1;
} finally {
  await pool.close();
}
