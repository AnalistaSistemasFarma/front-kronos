#!/usr/bin/env node
/**
 * Verificación REAL de los conectores de PRUEBAS (pruebas-kronos.mjs) contra
 * KRONOSDB_PRUEBAS y la web de testing. No imprime secretos.
 *
 *   node scripts/verificar-pruebas-kronos.mjs --secretos <conectores-secretos.json> [--crear-usuarios] [--trabajo <carpeta>]
 *
 * --crear-usuarios corre scripts/pruebas-kronos-usuarios.sql (idempotente, SOLO en KRONOSDB_PRUEBAS)
 * con la credencial de testing, sin suplantación, después de verificar DB_NAME().
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { crearServidor, leerSecretos } from '../src/mcp-pruebas-kronos.mjs';
import { configMssql } from '../src/pruebas-sql-servidor.mjs';
import { partirPorGo } from '../src/pruebas-sql.mjs';
import { resolverChrome } from '../src/pdf.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : null;
};
const secretosRuta = opt('secretos');
if (!secretosRuta) {
  console.error('uso: --secretos <archivo>');
  process.exit(2);
}
const sec = leerSecretos(secretosRuta);
let fallos = 0;
const ok = (c, m) => {
  console.log(`${c ? '✅' : '❌'} ${m}`);
  if (!c) fallos += 1;
};

if (argv.includes('--crear-usuarios')) {
  const pool = new sql.ConnectionPool(configMssql(sec.sql, 30_000));
  await pool.connect();
  try {
    const db = (await pool.request().query('SELECT DB_NAME() AS db')).recordset[0].db;
    if (db !== 'KRONOSDB_PRUEBAS') throw new Error(`conectado a ${db}, no a KRONOSDB_PRUEBAS`);
    for (const lote of partirPorGo(readFileSync(path.join(aqui, 'pruebas-kronos-usuarios.sql'), 'utf8'))) {
      const r = await pool.request().batch(lote);
      for (const f of r.recordset ?? []) console.log('   usuario:', JSON.stringify(f));
    }
    ok(true, 'usuarios sin login de KRONOSDB_PRUEBAS listos (agente_hilos_lectura, agente_hilos_escritura)');
  } finally {
    await pool.close();
  }
}

const hilo = mkdtempSync(path.join(opt('trabajo') ?? tmpdir(), 'verif-pruebas-'));
const { mkdirSync } = await import('node:fs');
mkdirSync(path.join(hilo, 'trabajo'), { recursive: true });
const filas = [];
const args = { hilo, auditoria: '/dev/null', conversacion: 'verificacion', chrome: resolverChrome({ home: process.env.HOME }) };
const S = crearServidor({ modo: 'sql', args, secretos: sec, driver: sql, auditar: (f) => filas.push(f) });
const W = crearServidor({ modo: 'web', args, secretos: sec, auditar: (f) => filas.push(f) });
const texto = (r) => r.texto;

let r = await S.llamar('pruebas_sql_consultar', { sql: 'SELECT DB_NAME() AS base, USER_NAME() AS usuario, ORIGINAL_LOGIN() AS login_original, 1 AS uno' });
ok(!r.isError && /"base": "KRONOSDB_PRUEBAS"/.test(texto(r)) && /agente_hilos_lectura/.test(texto(r)), 'SELECT trivial en KRONOSDB_PRUEBAS, suplantado como agente_hilos_lectura');
r = await S.llamar('pruebas_sql_consultar', { sql: 'SELECT TOP 3 id, email FROM [user] ORDER BY email', limite_filas: 2 });
ok(!r.isError && /"filas": 2/.test(texto(r)), 'lectura de una tabla real con tope de filas (2)');
r = await S.llamar('pruebas_sql_consultar', { sql: 'SELECT TOP 1 * FROM KRONOSDB.dbo.[user]' });
ok(r.isError && /RECHAZADO/.test(texto(r)), 'guarda: KRONOSDB (producción) rechazado');
r = await S.llamar('pruebas_sql_ejecutar', { sql: 'USE KRONOSDB_PRUEBAS; SELECT 1', motivo: 'verificación de guardas del conector' });
ok(r.isError && /USE/.test(texto(r)), 'guarda: USE rechazado');
r = await S.llamar('pruebas_sql_ejecutar', { sql: 'DROP DATABASE KRONOSDB_PRUEBAS', motivo: 'verificación de guardas del conector' });
ok(r.isError && /DATABASE/.test(texto(r)), 'guarda: DROP DATABASE rechazado');
r = await S.llamar('pruebas_sql_consultar', { sql: 'SELECT 1; DELETE FROM [user] WHERE 1 = 0' });
ok(r.isError && /solo lectura/.test(texto(r)), 'guarda: consultar no admite escritura');
// El cerco del SERVIDOR: SQL dinámico armado por partes (la guarda de texto no ve «KRONOSDB»).
r = await S.llamar('pruebas_sql_ejecutar', { sql: "DECLARE @b sysname = N'KRONO' + N'SDB'; EXEC(N'SELECT TOP 1 name FROM ' + @b + N'.sys.objects');", motivo: 'verificación: la suplantación no sale de PRUEBAS' });
ok(r.isError && /not able to access the database|no puede tener acceso|security context/i.test(texto(r)), `servidor: SQL dinámico hacia KRONOSDB negado por SQL Server (${texto(r).slice(0, 160).replace(/\s+/g, ' ')})`);
r = await S.llamar('pruebas_sql_ejecutar', { sql: "DECLARE @b sysname = N'SAPS' + N'END'; EXEC(N'SELECT TOP 1 name FROM ' + @b + N'.sys.objects');", motivo: 'verificación: la suplantación no sale de PRUEBAS' });
ok(r.isError && /not able to access the database|no puede tener acceso|security context/i.test(texto(r)), 'servidor: SQL dinámico hacia SAPSEND negado por SQL Server');
const tabla = `zz_puente_verificacion_${Date.now()}`;
r = await S.llamar('pruebas_sql_ejecutar', { sql: `CREATE TABLE dbo.${tabla} (id INT NOT NULL PRIMARY KEY, nota NVARCHAR(50));\nGO\nINSERT INTO dbo.${tabla} VALUES (1, N'prueba');\nPRINT N'insertado';\nGO\nSELECT COUNT(*) AS n FROM dbo.${tabla};\nDROP TABLE dbo.${tabla};`, motivo: 'verificación del conector: escritura y DDL en PRUEBAS' });
ok(!r.isError && /insertado/.test(texto(r)) && /"n": 1/.test(texto(r)), 'escritura real: CREATE TABLE + INSERT + PRINT + DROP TABLE en PRUEBAS (3 lotes por GO)');
ok(filas.some((f) => f.motivo === 'verificación del conector: escritura y DDL en PRUEBAS'), 'auditoría: el motivo queda registrado');

r = await W.llamar('testing_http', { ruta: '/api/auth/session' });
ok(!r.isError && /qa\.sgc@gsslatam\.com/.test(texto(r)), 'testing_http: sesión del usuario QA en testing');
ok(!texto(r).includes(sec.qa.password), 'testing_http: la clave no sale en la respuesta');
r = await W.llamar('testing_http', { ruta: '/api/companies' });
ok(!r.isError && /"estado": 200/.test(texto(r)), 'testing_http: GET /api/companies como QA');
r = await W.llamar('testing_http', { ruta: 'https://synerlink.example.com/' });
ok(r.isError, 'testing_http: URL absoluta (otro servidor) rechazada');
r = await W.llamar('testing_captura', { ruta: '/login', nombre: 'login', sin_sesion: true });
ok(!r.isError && /trabajo\/capturas\/login\.png/.test(texto(r)), `testing_captura: /login (${texto(r).slice(0, 120).replace(/\s+/g, ' ')})`);
r = await W.llamar('testing_captura', { ruta: '/process', nombre: 'process-qa' });
ok(!r.isError, 'testing_captura: /process con la sesión del QA');
console.log(`capturas en ${path.join(hilo, 'trabajo', 'capturas')}`);
console.log(fallos ? `❌ ${fallos} verificación(es) fallaron` : '✅ todo verificado');
process.exit(fallos ? 1 : 0);
