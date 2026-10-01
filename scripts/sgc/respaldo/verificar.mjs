#!/usr/bin/env node
/**
 * VERIFICACIÓN DE INTEGRIDAD del esquema `sgc` (o de una restauración) contra
 * un respaldo lógico (SGC documental, Sprint 6).
 *
 * Comprueba, tabla por tabla, que el esquema verificado tiene EXACTAMENTE las
 * mismas filas que el respaldo (conteo y huella SHA-256), que la estructura es
 * la misma (columnas, índices, CHECK, claves foráneas y triggers, con su
 * estado), que la CADENA DE FIRMAS de cada empresa sigue íntegra, que ningún
 * trigger del SGC está deshabilitado y que los registros de solo inserción
 * rechazan una modificación (se intenta dentro de una transacción que se
 * revierte siempre). Deja un informe JSON y sale con código 1 si algo falla.
 *
 * También sirve para la verificación PERIÓDICA en producción (sin --from:
 * solo cadena, triggers y solo inserción).
 *
 * Uso: node scripts/sgc/respaldo/verificar.mjs [--from <carpeta>] --schema sgc_rst [--informe <archivo.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import {
  assertSchemaName,
  databaseUrlFromEnv,
  diffStructures,
  mssqlConfigFromUrl,
  normalizeRow,
  readCatalog,
  readRows,
  readStructure,
  tableDigest,
  verifyAllChains,
} from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const from = arg('from');
const schema = assertSchemaName(arg('schema', 'sgc'));
const reportFile = arg('informe');

const manifest = from ? JSON.parse(fs.readFileSync(path.join(from, 'manifiesto.json'), 'utf8')) : null;
const pool = await sql.connect(mssqlConfigFromUrl(databaseUrlFromEnv(fs)));
const report = { esquema: schema, respaldo: from ? path.resolve(from) : null, fecha_utc: new Date().toISOString(), tablas: [], estructura: null, cadena_firmas: [], triggers_deshabilitados: [], solo_insercion: [], ok: true, problemas: [] };
const fail = (msg) => {
  report.ok = false;
  report.problemas.push(msg);
};

try {
  const { tables } = await readCatalog(pool, schema);
  if (tables.size === 0) throw new Error(`El esquema ${schema} no tiene tablas.`);

  // 1. Filas: conteo y huella por tabla.
  let signatureRows = [];
  for (const t of [...tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const rows = await readRows(pool, schema, t);
    if (t.name === 'signature') signatureRows = rows;
    const norm = rows.map((r) => normalizeRow(r, t.columns.map((c) => c.name)));
    const entry = { tabla: t.name, filas: norm.length, huella: tableDigest(norm) };
    if (manifest) {
      const exp = manifest.tablas[t.name];
      if (!exp) fail(`La tabla ${t.name} no está en el respaldo.`);
      else {
        entry.esperado = { filas: exp.filas, huella: exp.huella_filas };
        entry.coincide = exp.filas === entry.filas && exp.huella_filas === entry.huella;
        if (!entry.coincide) fail(`La tabla ${t.name} no coincide con el respaldo (${entry.filas} filas frente a ${exp.filas}).`);
      }
    }
    report.tablas.push(entry);
  }
  if (manifest) for (const name of Object.keys(manifest.tablas)) if (!tables.has(name)) fail(`Falta la tabla ${name} del respaldo.`);

  // 2. Estructura.
  const structure = await readStructure(pool, schema);
  if (manifest?.estructura) {
    const diffs = diffStructures(manifest.estructura, structure);
    report.estructura = { diferencias: diffs };
    if (diffs.length) fail(`La estructura difiere del respaldo en ${diffs.length} elemento(s).`);
  }

  // 3. Cadena de firmas.
  report.cadena_firmas = verifyAllChains(signatureRows);
  for (const c of report.cadena_firmas) if (!c.ok) fail(`Cadena de firmas de la empresa ${c.idCompany} ROTA en ${c.brokenAt}: ${c.problem}`);
  if (manifest?.cadena_firmas) {
    const exp = JSON.stringify(manifest.cadena_firmas);
    if (exp !== JSON.stringify(report.cadena_firmas)) fail('El resultado de la cadena de firmas no es el mismo del respaldo.');
  }

  // 4. Triggers del SGC habilitados (y el de base de datos, si existe).
  report.triggers_deshabilitados = structure.triggers.filter((t) => t.dis).map((t) => `${t.tbl}.${t.trg}`);
  const dbTrg = (await pool.request().query("SELECT name, is_disabled FROM sys.triggers WHERE parent_class = 0 AND name = N'sgc_proteger_esquema'")).recordset[0];
  report.trigger_base_datos = dbTrg ? { existe: true, deshabilitado: !!dbTrg.is_disabled } : { existe: false };
  if (dbTrg?.is_disabled) report.triggers_deshabilitados.push('DATABASE.sgc_proteger_esquema');
  if (report.triggers_deshabilitados.length) fail(`Triggers deshabilitados: ${report.triggers_deshabilitados.join(', ')}.`);

  // 5. Solo inserción: un UPDATE debe ser rechazado (transacción que SIEMPRE se revierte).
  for (const [table, col] of [
    ['audit_log', 'detail'],
    ['signature', 'reason'],
    ['interaction', 'body'],
    ['config_change_log', 'reason'],
  ]) {
    if (!tables.has(table)) continue;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let rejected = false;
    let empty = false;
    try {
      const r = await new sql.Request(tx).query(`UPDATE TOP (1) [${schema}].[${table}] SET [${col}] = [${col}]`);
      empty = (r.rowsAffected?.[0] ?? 0) === 0;
    } catch {
      rejected = true;
    } finally {
      await tx.rollback().catch(() => undefined);
    }
    report.solo_insercion.push({ tabla: table, rechaza_modificacion: rejected || empty, vacia: empty });
    if (!rejected && !empty) fail(`La tabla ${table} admitió una modificación (debería ser de solo inserción).`);
  }

  console.log(`Verificación de ${schema}${from ? ` contra ${from}` : ''}: ${report.ok ? 'CORRECTA' : 'CON PROBLEMAS'}.`);
  console.log(`  ${report.tablas.length} tablas, ${report.tablas.reduce((a, t) => a + t.filas, 0)} filas; cadena de firmas: ${report.cadena_firmas.map((c) => `empresa ${c.idCompany} ${c.ok ? 'íntegra' : 'ROTA'} (${c.checked})`).join('; ') || 'sin firmas'}.`);
  for (const p of report.problemas) console.log(`  - ${p}`);
} catch (e) {
  fail(e.message);
  console.error('ERROR de la verificación:', e.message);
} finally {
  await pool.close();
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
