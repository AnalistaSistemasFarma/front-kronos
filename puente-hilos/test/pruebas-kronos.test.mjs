import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { ErrorGuarda, partirPorGo, tokenizar, validarMotivo, validarRutaScript, validarSql } from '../src/pruebas-sql.mjs';
import { consultar, ejecutarLotes, abrirSesion, configMssql } from '../src/pruebas-sql-servidor.mjs';
import { crearClienteTesting, perfilCaptura, urlDeRuta, validarBase, nombreCaptura } from '../src/pruebas-web.mjs';
import { crearServidor, leerSecretos, servirStdio } from '../src/mcp-pruebas-kronos.mjs';
import { prepararPruebasTurno, textoPruebas, verificarSecretosPruebas, secretosPruebas } from '../src/pruebas-kronos.mjs';
import { combinarPerfil } from '../src/conectores.mjs';
import { textoSistema } from '../src/hilos.mjs';
import { EXT_PERMITIDAS, tipoMime } from '../src/adjuntos-salida.mjs';

const rechaza = (sql, modo, re) => assert.throws(() => validarSql(sql, modo), (e) => e instanceof ErrorGuarda && (!re || re.test(e.message)));

test('guardas: producción, USE y DROP DATABASE se rechazan', () => {
  rechaza('SELECT * FROM KRONOSDB.dbo.[user]', 'consultar', /KRONOSDB/);
  rechaza('SELECT * FROM [KRONOSDB].[dbo].[user]', 'consultar', /KRONOSDB/);
  rechaza("EXEC(N'SELECT 1 FROM kronosdb..x')", 'ejecutar', /KRONOSDB/);
  rechaza('USE KRONOSDB_PRUEBAS; SELECT 1', 'ejecutar', /USE/);
  rechaza('use [KRONOSDB_PRUEBAS]', 'ejecutar', /USE/);
  rechaza('DROP DATABASE KRONOSDB_PRUEBAS', 'ejecutar', /DATABASE/);
  rechaza('drop   database   x', 'ejecutar', /DATABASE/);
});

test('guardas: otras bases, linked servers y administración se rechazan', () => {
  rechaza('SELECT * FROM SAPSEND.dbo.Usuarios', 'consultar', /otra base/);
  rechaza('SELECT * FROM [ORIONDB_PRUEBAS]..tabla', 'consultar', /otra base/);
  rechaza('SELECT * FROM otraBase..tabla', 'consultar', /otra base/);
  rechaza('SELECT * FROM SRV.KRONOSDB_PRUEBAS.dbo.x', 'consultar', /4 partes/);
  rechaza("SELECT * FROM OPENQUERY(SRV, 'select 1')", 'consultar', /OPENQUERY/);
  rechaza("EXEC ('select 1') AT SRV", 'ejecutar', /AT/);
  rechaza("EXEC xp_cmdshell 'dir'", 'ejecutar', /xp_/);
  rechaza("EXEC sp_configure 'show advanced options', 1", 'ejecutar', /sp_configure/);
  rechaza("CREATE LOGIN x WITH PASSWORD = 'y'", 'ejecutar', /logins/);
  rechaza('CREATE USER x WITHOUT LOGIN', 'ejecutar', /usuarios/);
  rechaza('ALTER ROLE db_owner ADD MEMBER x', 'ejecutar', /roles/);
  rechaza('GRANT SELECT ON x TO y', 'ejecutar', /GRANT/);
  rechaza("EXECUTE AS USER = 'dbo'", 'ejecutar', /EXECUTE AS/);
  rechaza('REVERT', 'ejecutar', /REVERT/);
  rechaza("BACKUP DATABASE KRONOSDB_PRUEBAS TO DISK = 'x'", 'ejecutar', /BACKUP/);
  rechaza("RESTORE DATABASE x FROM DISK = 'y'", 'ejecutar', /RESTORE/);
  rechaza("EXEC sp_addlinkedserver 'x'", 'ejecutar');
  rechaza('CREATE TRIGGER t ON ALL SERVER FOR LOGON AS SELECT 1', 'ejecutar', /ALL SERVER/);
  rechaza("EXEC(N'SELECT * FROM SAPSEND_RYAN.dbo.x')", 'ejecutar', /otra base/);
});

test('guardas: consultar es solo lectura', () => {
  rechaza('UPDATE [user] SET name = 1', 'consultar', /solo admite SELECT/);
  rechaza('SELECT 1; DELETE FROM x', 'consultar', /solo lectura/);
  rechaza('SELECT * INTO #t FROM x', 'consultar', /solo lectura/);
  assert.deepEqual(validarSql('WITH c AS (SELECT 1 a) SELECT * FROM c', 'consultar'), { ok: true });
  assert.deepEqual(validarSql("SELECT TOP 5 id, email FROM [user] WHERE email LIKE N'%use%' -- use KRONOSDB_PRUEBAS", 'consultar'), { ok: true });
});

test('guardas: lo válido de PRUEBAS pasa (SQL dinámico de los scripts del repo, nombres de 3 partes de la base de pruebas)', () => {
  assert.ok(validarSql("IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix') EXEC(N'CREATE NONCLUSTERED INDEX [ix] ON [dbo].[t]([a]);');", 'ejecutar').ok);
  assert.ok(validarSql("EXEC sp_executesql N'SELECT @a = 1', N'@a INT OUTPUT', @a = @x OUTPUT;", 'ejecutar').ok);
  assert.ok(validarSql('SELECT * FROM KRONOSDB_PRUEBAS.dbo.[user]', 'consultar').ok);
  assert.ok(validarSql('SELECT * FROM tempdb..#t', 'consultar').ok);
  assert.ok(validarSql("INSERT INTO t (correo, url) VALUES (N'nicolas.rivera@gsslatam.com', N'www.ejemplo.com.co'); EXEC sp_rename N'dbo.t.a', N'b', N'COLUMN';", 'ejecutar').ok);
  assert.ok(validarSql("CREATE PROCEDURE dbo.p AS BEGIN SELECT 'Use el botón' END", 'ejecutar').ok);
});

test('tokenizador: cadenas y comentarios no esconden nada', () => {
  rechaza("SELECT 'x--' ; USE otra", 'ejecutar', /USE/);
  rechaza("SELECT 1 /* a /* anidado */ sigue */ ; USE x", 'ejecutar', /USE/);
  rechaza("SELECT 'sin cerrar", 'ejecutar', /cadena/);
  assert.equal(tokenizar("N'a''b'")[0].valor, "a'b");
});

test('partirPorGo: lotes, GO n, y GO dentro de cadenas o comentarios', () => {
  assert.deepEqual(partirPorGo('SELECT 1\nGO\nSELECT 2\ngo  -- fin\n'), ['SELECT 1', 'SELECT 2']);
  assert.equal(partirPorGo('SELECT 1\nGO 3').length, 3);
  assert.equal(partirPorGo("SELECT '\nGO\n'\nGO").length, 1);
  assert.equal(partirPorGo('/*\nGO\n*/ SELECT 1').length, 1);
});

test('rutas de script y motivo', () => {
  assert.equal(validarRutaScript('./codigo/front-kronos/prisma/manual/2026-10-22-x-PRUEBAS.sql'), 'codigo/front-kronos/prisma/manual/2026-10-22-x-PRUEBAS.sql');
  assert.equal(validarRutaScript('trabajo/sql/ajuste.sql'), 'trabajo/sql/ajuste.sql');
  for (const mal of ['codigo/front-kronos/prisma/manual/x-PROD.sql', '../x.sql', '/etc/x.sql', 'trabajo/../../x.sql', 'trabajo/.oculto.sql', 'adjuntos/x.sql']) {
    assert.throws(() => validarRutaScript(mal), ErrorGuarda, mal);
  }
  assert.throws(() => validarMotivo('corto'), ErrorGuarda);
  assert.equal(validarMotivo('  probar el ajuste de compras  '), 'probar el ajuste de compras');
});

/** Doble de mssql: registra lo que se manda y simula la sesión suplantada. */
function driverFalso({ db = 'KRONOSDB_PRUEBAS', usuario = null, filas = 5 } = {}) {
  const enviados = [];
  let suplantado = null;
  class Req {
    constructor() {
      this.oyentes = {};
      this.stream = false;
    }
    on(ev, f) {
      (this.oyentes[ev] ??= []).push(f);
      return this;
    }
    emit(ev, ...a) {
      for (const f of this.oyentes[ev] ?? []) f(...a);
    }
    async query(t) {
      enviados.push(t);
      if (/DB_NAME\(\) AS db, USER_NAME/.test(t)) return { recordset: [{ db, u: usuario ?? suplantado ?? 'dbo' }] };
      if (/DB_NAME\(\) AS db/.test(t)) return { recordset: [{ db }] };
      if (this.stream) {
        setImmediate(() => {
          this.emit('recordset', { n: {} });
          for (let i = 0; i < filas && !this.cancelado; i += 1) this.emit('row', { n: i });
          this.emit('done');
        });
        return undefined;
      }
      return { recordset: [] };
    }
    cancel() {
      this.cancelado = true;
    }
    async batch(t) {
      enviados.push(t);
      const m = /EXECUTE AS USER = N'([a-z_]+)'/.exec(t);
      if (m) {
        suplantado = m[1];
        return {};
      }
      this.emit('info', { message: 'hecho' });
      return { recordsets: [[{ n: 1 }]], rowsAffected: [1] };
    }
  }
  return {
    enviados,
    ConnectionPool: class {
      async connect() {}
      request() {
        return new Req();
      }
      async close() {}
    },
  };
}
const SEC = { sql: { server: '192.168.10.3', user: 'u', password: 'clave-secreta-sql' }, qa: { email: 'qa.sgc@gsslatam.com', password: 'clave-secreta-qa' } };

test('servidor SQL (doble): consulta suplantada como lectura con tope de filas', async () => {
  const d = driverFalso({ filas: 10 });
  const r = await consultar({ driver: d, sec: SEC.sql, sql: 'SELECT n FROM t', limite: 3 });
  assert.equal(r.filas, 3);
  assert.equal(r.truncado, true);
  assert.ok(d.enviados.some((t) => t.includes("EXECUTE AS USER = N'agente_hilos_lectura' WITH NO REVERT")));
});

test('servidor SQL (doble): escritura suplantada como escritura, verifica antes de cada lote', async () => {
  const d = driverFalso();
  const r = await ejecutarLotes({ driver: d, sec: SEC.sql, lotes: ['INSERT INTO t VALUES (1)', 'UPDATE t SET a = 2'] });
  assert.equal(r.ok, true);
  assert.equal(r.resultados[0].mensajes[0], 'hecho');
  assert.ok(d.enviados.some((t) => t.includes("N'agente_hilos_escritura'")));
  assert.ok(d.enviados.filter((t) => /USER_NAME\(\)/.test(t)).length >= 3);
});

test('servidor SQL (doble): otra base o sin suplantar → aborta sin correr nada', async () => {
  const d1 = driverFalso({ db: 'KRONOSDB' });
  await assert.rejects(() => ejecutarLotes({ driver: d1, sec: SEC.sql, lotes: ['SELECT 1'] }), /KRONOSDB_PRUEBAS/);
  assert.ok(!d1.enviados.includes('SELECT 1'));
  const d2 = driverFalso({ usuario: 'dbo' });
  await assert.rejects(() => abrirSesion({ driver: d2, sec: SEC.sql, modo: 'ejecutar', timeoutMs: 1000 }), /suplantada/);
  assert.throws(() => configMssql({ ...SEC.sql, database: 'KRONOSDB' }, 1000), /KRONOSDB_PRUEBAS/);
  assert.equal(configMssql({ ...SEC.sql }, 1000).database, 'KRONOSDB_PRUEBAS');
});

test('MCP (doble): flujo feliz, rechazo con auditoría, scripts del hilo y salida sin secretos', async () => {
  const hilo = mkdtempSync(path.join(tmpdir(), 'hilo-'));
  mkdirSync(path.join(hilo, 'trabajo'));
  mkdirSync(path.join(hilo, 'codigo', 'front-kronos', 'prisma', 'manual'), { recursive: true });
  writeFileSync(path.join(hilo, 'codigo', 'front-kronos', 'prisma', 'manual', 'x-PRUEBAS.sql'), 'SELECT 1\nGO\nSELECT 2\n');
  writeFileSync(path.join(hilo, 'trabajo', 'malo.sql'), 'SELECT 1\nGO\nUSE KRONOSDB\n');
  symlinkSync('/etc/hosts', path.join(hilo, 'trabajo', 'enlace.sql'));
  const filas = [];
  const d = driverFalso();
  const S = crearServidor({ modo: 'sql', args: { hilo, auditoria: '/dev/null' }, secretos: SEC, driver: d, auditar: (f) => filas.push(f), basesImpl: async () => null });
  let r = await S.llamar('pruebas_sql_consultar', { sql: 'SELECT n FROM t' });
  assert.equal(r.isError, false);
  assert.match(r.texto, /KRONOSDB_PRUEBAS/);
  r = await S.llamar('pruebas_sql_ejecutar', { sql: 'UPDATE t SET a = 1' });
  assert.equal(r.isError, true);
  assert.match(r.texto, /motivo/);
  r = await S.llamar('pruebas_sql_ejecutar', { sql: 'SELECT * FROM KRONOSDB.dbo.x', motivo: 'probar la guarda de producción' });
  assert.match(r.texto, /RECHAZADO/);
  assert.equal(filas.at(-1).rechazado, true);
  assert.equal(filas.at(-1).motivo, 'probar la guarda de producción');
  r = await S.llamar('pruebas_sql_correr_script', { ruta: 'codigo/front-kronos/prisma/manual/x-PRUEBAS.sql', motivo: 'correr el script de pruebas' });
  assert.equal(r.isError, false);
  assert.equal(filas.at(-1).lotes, 2);
  const antes = d.enviados.length;
  r = await S.llamar('pruebas_sql_correr_script', { ruta: 'trabajo/malo.sql', motivo: 'script con un lote prohibido' });
  assert.match(r.texto, /lote 2/);
  assert.equal(d.enviados.length, antes, 'no corre ningún lote si uno no pasa');
  r = await S.llamar('pruebas_sql_correr_script', { ruta: 'trabajo/enlace.sql', motivo: 'enlace simbólico afuera' });
  assert.match(r.texto, /enlace/);
  const W = crearServidor({ modo: 'web', args: { hilo, auditoria: '/dev/null' }, secretos: SEC, cliente: { http: async () => ({ estado: 200, cuerpo: 'x clave-secreta-qa y' }), secretos: () => [] }, auditar: () => {} });
  r = await W.llamar('testing_http', { ruta: '/api/x' });
  assert.ok(!r.texto.includes('clave-secreta-qa'));
});

test('MCP por stdio: initialize, tools/list y tools/call', async () => {
  const ent = new PassThrough();
  const sal = new PassThrough();
  const S = crearServidor({ modo: 'sql', args: { hilo: '/tmp', auditoria: '/dev/null' }, secretos: SEC, driver: driverFalso(), auditar: () => {}, basesImpl: async () => null });
  servirStdio({ servidor: S, nombre: 'kronos-pruebas-sql', entrada: ent, salida: sal });
  const resp = [];
  sal.on('data', (c) => resp.push(...c.toString().trim().split('\n').map((l) => JSON.parse(l))));
  ent.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  ent.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  ent.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  ent.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pruebas_sql_consultar', arguments: { sql: 'USE x' } } })}\n`);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(resp.find((x) => x.id === 1).result.serverInfo.name, 'kronos-pruebas-sql');
  assert.deepEqual(resp.find((x) => x.id === 2).result.tools.map((t) => t.name), ['pruebas_sql_consultar', 'pruebas_sql_ejecutar', 'pruebas_sql_correr_script']);
  assert.equal(resp.find((x) => x.id === 3).result.isError, true);
});

test('web: solo PRUEBAS, rutas relativas y sin /api/auth', () => {
  assert.equal(validarBase('http://192.168.11.230:3030'), 'http://192.168.11.230:3030');
  assert.throws(() => validarBase('https://synerlink.gsslatam.com'), /PRUEBAS/);
  const b = 'http://192.168.11.230:3030';
  assert.equal(urlDeRuta(b, '/process?x=1').href, `${b}/process?x=1`);
  for (const mal of ['http://otro/x', '//otro/x', 'process', '/api/auth/signout', '/api/auth/callback/credentials', '/API/AUTH/signin']) assert.throws(() => urlDeRuta(b, mal), Error, mal);
  assert.equal(urlDeRuta(b, '/api/auth/session').pathname, '/api/auth/session');
  assert.match(perfilCaptura(41234), /\(allow network-outbound \(remote ip "localhost:41234"\)\)/);
  assert.match(perfilCaptura(41234), /\(deny network\*\)/);
  assert.equal(nombreCaptura('../../x y', '/a'), 'x-y.png');
});

test('web (doble): login de NextAuth una vez, reintento al vencer la sesión y sin cookies ni clave en la salida', async () => {
  const llamadas = [];
  let vence = 1;
  const resp = (status, body, cookies = [], extra = {}) => ({ status, headers: { get: (k) => extra[k] ?? (k === 'content-type' ? 'application/json' : null), getSetCookie: () => cookies }, json: async () => JSON.parse(body), text: async () => body });
  const fetchImpl = async (url, o = {}) => {
    const u = new URL(url);
    llamadas.push(`${o.method ?? 'GET'} ${u.pathname}`);
    if (u.pathname === '/api/auth/csrf') return resp(200, '{"csrfToken":"t"}', ['__Host-next-auth.csrf-token=abc; Path=/']);
    if (u.pathname === '/api/auth/callback/credentials') {
      assert.match(String(o.body), /password=clave-secreta-qa/);
      return resp(200, '{}', ['__Secure-next-auth.session-token=TOKENSESION123; Path=/']);
    }
    if (u.pathname === '/api/auth/session') return resp(200, /TOKENSESION123/.test(o.headers?.cookie ?? '') ? '{"user":{"email":"qa.sgc@gsslatam.com"}}' : '{}');
    if (u.pathname === '/api/x') {
      if (vence-- > 0) return resp(401, '{}');
      return resp(200, '{"eco":"TOKENSESION123"}');
    }
    return resp(404, '{}');
  };
  const c = crearClienteTesting({ qa: SEC.qa, fetchImpl });
  const r = await c.http({ ruta: '/api/x' });
  assert.equal(r.estado, 200);
  assert.ok(!r.cuerpo.includes('TOKENSESION123'));
  assert.equal(llamadas.filter((l) => l.endsWith('/callback/credentials')).length, 2);
});

test('puente: los conectores de PRUEBAS van en TODOS los turnos, sin rol, y se combinan con el perfil', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ph-'));
  const sec = path.join(dir, 'conectores-secretos.json');
  writeFileSync(sec, JSON.stringify({ otro: 'x'.repeat(20), 'kronos-pruebas': SEC }), { mode: 0o600 });
  const cfg = { hilosDir: dir, home: '/Users/x', conectoresSecretos: sec, pruebasKronos: { habilitado: true, base: 'http://192.168.11.230:3030' } };
  const rutas = { cwd: path.join(dir, 'proyectos/9/conversaciones/7') };
  const lote = [{ author: { kind: 'user', email: 'alguien.sin.rol@gsslatam.com' } }];
  const p = prepararPruebasTurno({ cfg, rutas, idConversation: 7, lote, chrome: '/c/chrome', nodeBin: '/n/node' });
  assert.deepEqual(p.servidores.map((s) => s.nombre), ['kronos-pruebas-sql', 'synerlink-testing-web']);
  const txt = JSON.stringify(p.servidores);
  assert.ok(!txt.includes('clave-secreta'), 'el mcp.json no lleva secretos');
  assert.match(txt, /alguien\.sin\.rol@gsslatam\.com/);
  const perfil = combinarPerfil({ mcpServers: { sap: {} }, herramientas: ['mcp__sap__q'], web: false }, p);
  assert.ok(perfil.herramientas.includes('mcp__kronos-pruebas-sql__pruebas_sql_ejecutar'));
  assert.ok(perfil.herramientas.includes('mcp__synerlink-testing-web__testing_captura'));
  assert.equal(perfil.mcpServers['kronos-pruebas-sql'].type, 'stdio');
  assert.deepEqual(secretosPruebas(cfg), [path.join(dir, 'pruebas-kronos-sesion-qa.json')]);
  // Sin credenciales: falla cerrado y lo dice.
  const sin = prepararPruebasTurno({ cfg: { ...cfg, conectoresSecretos: null }, rutas, idConversation: 7, lote });
  assert.equal(sin.servidores.length, 0);
  assert.match(sin.bloque, /no están disponibles/);
  chmodSync(sec, 0o644);
  assert.throws(() => verificarSecretosPruebas(sec), /600/);
  assert.equal(leerSecretos.length >= 1, true);
});

test('encabezado: dice que tiene PRUEBAS en lectura y escritura, testing como QA, nunca prod, y que verifique él mismo', () => {
  const t = textoPruebas({ disponible: true });
  assert.match(t, /tiene acceso de lectura y escritura a la base de PRUEBAS \(KRONOSDB_PRUEBAS\) y puede revisar testing como usuario QA; nunca a prod/);
  assert.match(t, /VERIFIQUE USTED MISMO/);
  const ctx = { project: { name: 'P', company: { companyName: 'OLP' }, profile: { label: 'x' } } };
  assert.match(textoSistema({ agente: 'Orus', contexto: ctx, instruccionesEn: 'claude-md', bloquePruebas: t }), /nunca a prod/);
});

test('adjuntos: .sql y .ts salen como texto; los scripts que bloquea SynerLink no', () => {
  assert.ok(EXT_PERMITIDAS.includes('sql') && EXT_PERMITIDAS.includes('ts'));
  for (const x of ['ps1', 'sh', 'js', 'mjs']) assert.ok(!EXT_PERMITIDAS.includes(x), x);
  assert.equal(tipoMime('a.sql'), 'text/plain');
});
