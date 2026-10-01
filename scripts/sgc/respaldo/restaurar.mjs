#!/usr/bin/env node
/**
 * RESTAURACIÓN del respaldo lógico del esquema `sgc` (SGC documental, Sprint 6).
 *
 * 1. Comprueba que los archivos del respaldo no cambiaron (SHA-256 del manifiesto).
 * 2. Crea la estructura en el esquema DESTINO repitiendo las migraciones del
 *    SGC registradas en el respaldo (las mismas del control de cambios),
 *    reescritas al esquema destino.
 * 3. Inserta las filas en orden de claves foráneas conservando los ids
 *    (IDENTITY_INSERT). Los triggers de solo inserción no estorban: impiden
 *    modificar y borrar, no insertar.
 *
 * Por defecto restaura en un esquema TEMPORAL (p. ej. sgc_rst) de la misma
 * base, para probar el procedimiento sin tocar `sgc`. Restaurar sobre `sgc`
 * (recuperación real) exige --confirmo-restaurar-sobre-sgc y que el esquema
 * esté vacío; esa decisión la toma Tecnología con Calidad (ver el procedimiento).
 *
 * Uso: node scripts/sgc/respaldo/restaurar.mjs --from <carpeta> --target-schema sgc_rst [--migrations prisma/migrations]
 */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import {
  SGC_SCHEMA_MIGRATIONS,
  assertSchemaName,
  databaseUrlFromEnv,
  denormalizeValue,
  mssqlConfigFromUrl,
  mssqlType,
  rewriteSchema,
  sha256Hex,
  topologicalOrder,
} from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const from = arg('from');
const target = assertSchemaName(arg('target-schema', 'sgc_rst'));
const migDir = arg('migrations', path.join(process.cwd(), 'prisma', 'migrations'));
if (!from) {
  console.error('Uso: node scripts/sgc/respaldo/restaurar.mjs --from <carpeta> --target-schema sgc_rst');
  process.exit(2);
}
if (target === 'sgc' && !process.argv.includes('--confirmo-restaurar-sobre-sgc')) {
  console.error('Restaurar sobre `sgc` es una recuperación real: exige --confirmo-restaurar-sobre-sgc (y el esquema vacío).');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifiesto.json'), 'utf8'));
// 1. Integridad de los archivos del respaldo.
const tablesData = {};
for (const [name, meta] of Object.entries(manifest.tablas)) {
  const body = fs.readFileSync(path.join(from, meta.archivo), 'utf8');
  if (sha256Hex(body) !== meta.sha256_archivo) throw new Error(`El archivo del respaldo de ${name} no coincide con su huella: el respaldo fue alterado o está incompleto.`);
  tablesData[name] = JSON.parse(body);
}
console.log(`Respaldo íntegro: ${Object.keys(tablesData).length} tablas de ${manifest.base} (${manifest.inicio_utc}).`);

/** Quita los bloques que solo aplican a la base real (p. ej. el trigger de base de datos del S6). */
function stripRealOnly(text) {
  return text.replace(/-- \[solo-base-real-inicio\][\s\S]*?-- \[solo-base-real-fin\]/g, '');
}

const pool = await sql.connect(mssqlConfigFromUrl(databaseUrlFromEnv(fs)));
try {
  const existing = (await pool.request().input('s', target).query('SELECT COUNT(*) AS n FROM sys.tables WHERE schema_id = SCHEMA_ID(@s)')).recordset[0].n;
  if (existing > 0) throw new Error(`El esquema destino ${target} ya tiene ${existing} tablas: restaure en un esquema vacío.`);

  // 2. Estructura: las migraciones del SGC que el respaldo tenía registradas, en orden.
  const recorded = new Set((manifest.migraciones ?? []).map((m) => m.nombre));
  const toApply = SGC_SCHEMA_MIGRATIONS.filter((m) => recorded.size === 0 || recorded.has(m));
  for (const name of toApply) {
    const file = path.join(migDir, name, 'migration.sql');
    let text = fs.readFileSync(file, 'utf8');
    if (target !== 'sgc') text = rewriteSchema(stripRealOnly(text), target);
    await pool.request().batch(text);
    console.log(`  estructura: ${name}`);
  }

  // 3. Datos, padres primero.
  const fks = (
    await pool.request().input('s', target).query(`SELECT tc.name AS child, tp.name AS parent FROM sys.foreign_keys fk
      JOIN sys.tables tc ON tc.object_id = fk.parent_object_id JOIN sys.tables tp ON tp.object_id = fk.referenced_object_id
      WHERE SCHEMA_NAME(tc.schema_id) = @s AND SCHEMA_NAME(tp.schema_id) = @s`)
  ).recordset;
  const order = topologicalOrder(Object.keys(tablesData), fks);
  let total = 0;
  for (const name of order) {
    const t = tablesData[name];
    if (!t.filas.length) continue;
    const cols = t.columnas;
    const colList = cols.map((c) => `[${c.name}]`).join(', ');
    const perBatch = Math.max(1, Math.floor(2000 / cols.length));
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (t.identidad) await new sql.Request(tx).batch(`SET IDENTITY_INSERT [${target}].[${name}] ON;`);
      for (let i = 0; i < t.filas.length; i += perBatch) {
        const chunk = t.filas.slice(i, i + perBatch);
        const req = new sql.Request(tx);
        const values = chunk.map((row, r) => {
          return `(${cols
            .map((c, k) => {
              const p = `p${r}_${k}`;
              req.input(p, mssqlType(sql, c), denormalizeValue(row[c.name], c));
              return `@${p}`;
            })
            .join(', ')})`;
        });
        await req.query(`INSERT INTO [${target}].[${name}] (${colList}) VALUES ${values.join(', ')}`);
      }
      if (t.identidad) await new sql.Request(tx).batch(`SET IDENTITY_INSERT [${target}].[${name}] OFF;`);
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => undefined);
      throw new Error(`Restaurando ${name}: ${e.message}`);
    }
    total += t.filas.length;
    console.log(`  datos: ${name} (${t.filas.length})`);
  }
  console.log(`Restauración terminada en ${target}: ${order.length} tablas, ${total} filas. Siguiente paso: verificar.mjs --from ${from} --schema ${target}`);
} catch (e) {
  console.error('ERROR de la restauración:', e.message);
  process.exitCode = 1;
} finally {
  await pool.close();
}
