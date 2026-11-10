#!/usr/bin/env node
/**
 * PRODUCCION / PRUEBAS: comprueba en SOLO LECTURA que la BD tenga las tablas y columnas que el
 * codigo usa por SQL directo y que no estan en schema.prisma (prisma/manual/objetos-requeridos.json).
 *
 * Por que: verificar-esquema.ps1 solo compara contra schema.prisma. El bloque B (Workflow SAP,
 * Compras, Ventas) usa task_process_category.task_kind, task_sap_action, sales_* ... sin Prisma:
 * si el codigo sube sin su SQL, se cae la creacion de solicitudes de TODOS los procesos
 * («Invalid column name 'task_kind'») y el azul/verde no lo detectaria.
 *
 * Uso:  node scripts/bluegreen/verificar-objetos-sql.cjs <carpeta-con-dbconfig.js>
 * Codigos: 0 todo existe; 1 faltan objetos; 3 no se pudo verificar.
 */
const path = require('path');
const fs = require('fs');

async function main() {
  const dir = path.resolve(process.argv[2] || process.cwd());
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'prisma', 'manual', 'objetos-requeridos.json'), 'utf8'));
  // dbconfig.js lee SAPSENDSQL_* de process.env; en el runner nadie carga el .env (pase #924:
  // «Failed to connect to undefined»). Se carga sin pisar variables ya definidas.
  const envFile = path.join(dir, '.env');
  if (!process.env.SAPSENDSQL_SERVER && fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  const sql = require(require.resolve('mssql', { paths: [dir] }));
  const cfgMod = require(path.join(dir, 'dbconfig.js'));
  const cfg = typeof cfgMod.buildMssqlConfig === 'function' ? cfgMod.buildMssqlConfig() : cfgMod.default || cfgMod;
  const pool = await new sql.ConnectionPool({ ...cfg, requestTimeout: 30000 }).connect();
  try {
    const faltan = [];
    for (const t of manifest.tablas || []) {
      const r = await pool.request().input('t', sql.NVarChar(256), `dbo.${t}`).query('SELECT OBJECT_ID(@t, N\'U\') AS id');
      if (r.recordset[0].id == null) faltan.push(`tabla ${t}`);
    }
    for (const [t, c] of manifest.columnas || []) {
      const r = await pool.request().input('t', sql.NVarChar(256), `dbo.${t}`).input('c', sql.NVarChar(256), c).query('SELECT COL_LENGTH(@t, @c) AS len');
      if (r.recordset[0].len == null) faltan.push(`columna ${t}.${c}`);
    }
    const db = (await pool.request().query('SELECT DB_NAME() AS d')).recordset[0].d;
    if (faltan.length) {
      console.log(`::error::La BD ${db} NO tiene objetos que el codigo usa sin Prisma. Aplique los SQL del pase (con respaldo) ANTES de desplegar:`);
      for (const f of faltan) console.log(`  - ${f}`);
      return 1;
    }
    console.log(`OK: ${db} tiene los ${(manifest.tablas || []).length} tablas y ${(manifest.columnas || []).length} columnas requeridas.`);
    return 0;
  } finally {
    await pool.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.log(`::error::No se pudo verificar los objetos SQL: ${String(e && e.message ? e.message : e).replace(/(password|pwd)=[^;]*/gi, '$1=***')}`);
    process.exit(3);
  }
);
