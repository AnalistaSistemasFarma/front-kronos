import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { perfilConAgente, prepararConectoresAgente, proyectoDelAgente, secretosConectoresAgente, servidoresAgente, textoConectoresAgente } from '../src/conectores-agente.mjs';
import { armarArgumentos, revisarInit } from '../src/claude.mjs';
import { cargarConfig, validarPerfiles } from '../src/config.mjs';
import { conectoresAgenteListo, crearPuente } from '../src/puente.mjs';
import { Estado } from '../src/hilos.mjs';

const NICO = 'nicolas.rivera@gsslatam.com';
const OTRA = 'silvia.usuaria@gsslatam.com';
const tmp = () => mkdtempSync(path.join(tmpdir(), 'conectores-agente-'));
const msg = (id, email, body = 'hola') => ({ id, idConversation: 60, body, author: { kind: 'user', name: email, email }, conversation: { kind: 'project' }, attachments: [] });

/** Config dir FALSO de un bot como Play: MCP de proyecto (su vault), un plugin con MCP, Telegram y su .env. */
function configAgente(dir) {
  const conf = path.join(dir, 'play-config');
  mkdirSync(conf, { recursive: true });
  const engram = path.join(dir, 'plugins', 'engram');
  const telegram = path.join(dir, 'plugins', 'telegram');
  for (const d of [engram, telegram]) mkdirSync(path.join(d, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(engram, '.mcp.json'), JSON.stringify({ mcpServers: { engram: { command: 'engram', args: ['mcp', '--tools=agent'] } } }));
  writeFileSync(path.join(telegram, '.mcp.json'), JSON.stringify({ mcpServers: { telegram: { command: 'bun', args: ['tg'] } } }));
  mkdirSync(path.join(conf, 'plugins'), { recursive: true });
  writeFileSync(
    path.join(conf, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'engram@engram': [{ installPath: engram }], 'telegram@claude-plugins-official': [{ installPath: telegram }] } })
  );
  writeFileSync(path.join(conf, 'settings.json'), JSON.stringify({ enabledPlugins: { 'engram@engram': true, 'telegram@claude-plugins-official': true } }));
  writeFileSync(
    path.join(conf, '.claude.json'),
    JSON.stringify({
      mcpServers: { 'mi-api': { type: 'http', url: 'http://10.0.0.9/mcp', headers: { Authorization: 'Bearer ${MI_LLAVE}' } }, synerlink: { command: 'bun', args: ['canal'] } },
      projects: {
        '/Users/pedro/brain/gsslatam-graph': { mcpServers: { playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} } } },
        '/Users/pedro/otra-carpeta': { mcpServers: { ajeno: { command: 'x' } } },
      },
    })
  );
  const env = path.join(dir, 'play.env');
  writeFileSync(env, 'CLAUDE_CODE_OAUTH_TOKEN=tok\nMI_LLAVE=llave-secreta-del-agente\n', { mode: 0o600 });
  return { conf, env, vault: '/Users/pedro/brain/gsslatam-graph/shared-brain/agentes/silvia' };
}

test('proyectoDelAgente: la misma carpeta o la más cercana que la contiene', () => {
  const p = { '/a': { n: 1 }, '/a/b': { n: 2 } };
  assert.equal(proyectoDelAgente(p, '/a/b/c/d').n, 2);
  assert.equal(proyectoDelAgente(p, '/a/x').n, 1);
  assert.equal(proyectoDelAgente(p, '/z'), null);
  assert.equal(proyectoDelAgente(p, null), null);
});

test('servidoresAgente: usuario + proyecto de su carpeta + plugins habilitados; sin canales ni Telegram; ${VAR} del .env', () => {
  const d = tmp();
  const { conf, env, vault } = configAgente(d);
  const r = servidoresAgente({ configDir: conf, envArchivo: env, proyectoDir: vault });
  assert.deepEqual(r.nombres, ['engram', 'mi-api', 'playwright']);
  assert.equal(r.mcpServers['mi-api'].headers.Authorization, 'Bearer llave-secreta-del-agente');
  assert.equal(r.origen.playwright, 'proyecto');
  assert.equal(r.origen.engram, 'plugin engram@engram');
  assert.deepEqual(r.faltan, []);
  // Sin carpeta de proyecto, solo lo de usuario y plugins; con excluir, fuera.
  assert.deepEqual(servidoresAgente({ configDir: conf, envArchivo: env, excluir: ['mi-api'] }).nombres, ['engram']);
});

test('prepararConectoresAgente: mcp.json COMPLETO en 600 fuera del hilo; permisos por servidor; no pisa los del perfil', () => {
  const d = tmp();
  const { conf, env, vault } = configAgente(d);
  const cfg = { hilosDir: path.join(d, 'puente'), conectoresAgente: { configDir: conf, envArchivo: env, proyectoDir: vault, excluir: [] } };
  const perfilSrv = { 'sapbo-farmalogica': { type: 'http', url: 'http://p/mcp' }, playwright: { command: 'del-perfil' } };
  const a = prepararConectoresAgente({ cfg, idConversation: 9, perfilServidores: perfilSrv, ahora: 1 });
  assert.deepEqual(a.servidores, ['engram', 'mi-api'], 'el playwright del perfil manda');
  assert.deepEqual(a.herramientas, ['mcp__engram', 'mcp__mi-api']);
  assert.ok(a.rutaMcp.startsWith(path.join(cfg.hilosDir, 'conectores-agente')));
  const j = JSON.parse(readFileSync(a.rutaMcp, 'utf8'));
  assert.deepEqual(Object.keys(j.mcpServers).sort(), ['engram', 'mi-api', 'playwright', 'sapbo-farmalogica']);
  assert.equal(j.mcpServers.playwright.command, 'del-perfil');
  const perfil = perfilConAgente({ mcpServers: perfilSrv, herramientas: ['mcp__sapbo-farmalogica__sap_query'], web: true }, a);
  assert.ok(perfil.herramientas.includes('mcp__engram') && perfil.herramientas.includes('mcp__sapbo-farmalogica__sap_query'));
  // Los argumentos: sigue --restricted + dontAsk; las reglas por servidor van en --allowedTools.
  const args = armarArgumentos({ perfil, sesion: { id: '11111111-1111-1111-1111-111111111111', nueva: true }, rutaMcp: a.rutaMcp, rutaSistema: '/x/sistema.md' });
  assert.ok(args.includes('--restricted'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.ok(args.includes('mcp__mi-api'));
  assert.equal(args[args.indexOf('--mcp-config') + 1], a.rutaMcp);
  // revisarInit acepta los conectores del agente y rechaza cualquier otro.
  assert.deepEqual(revisarInit({ tools: ['Read'], mcp_servers: [{ name: 'engram' }, { name: 'sapbo-farmalogica' }] }, perfil), []);
  assert.deepEqual(revisarInit({ tools: ['Read'], mcp_servers: [{ name: 'telegram' }] }, perfil), ['conector no declarado: telegram']);
  // Rutas negadas al sandbox de los turnos con código.
  const sec = secretosConectoresAgente(cfg);
  assert.ok(sec.includes(path.join(cfg.hilosDir, 'conectores-agente')) && sec.includes(env) && sec.includes(path.join(conf, '.claude.json')));
  assert.match(textoConectoresAgente({ agente: 'Play', servidores: a.servidores, origen: a.origen }), /los mismos de su chat de Play/);
  assert.equal(prepararConectoresAgente({ cfg: { hilosDir: d }, idConversation: 1 }), null, 'sin la variable: apagado');
});

test('config: HILOS_CONECTORES_AGENTE_* validan rutas y no aceptan el config aislado', () => {
  const d = tmp();
  const { conf, env, vault } = configAgente(d);
  const perfiles = path.join(d, 'perfiles.json');
  writeFileSync(perfiles, '{}');
  const base = { HILOS_ENTORNO: 'pruebas', HILOS_SYNERLINK_URL: 'http://pruebas.local:3070', HILOS_SYNERLINK_KEY: 'k'.repeat(40), HILOS_AGENTE: 'play', HILOS_DIR: path.join(d, 'puente'), HILOS_PERFILES: perfiles, HILOS_ANTHROPIC_API_KEY: 'sk' };
  assert.equal(cargarConfig(base).conectoresAgente, null);
  assert.throws(() => cargarConfig({ ...base, HILOS_CONECTORES_AGENTE_CONFIG_DIR: 'relativa' }), /ruta absoluta/);
  assert.throws(() => cargarConfig({ ...base, HILOS_CONECTORES_AGENTE_CONFIG_DIR: path.join(d, 'no-existe') }), /no tiene .claude.json/);
  assert.throws(() => cargarConfig({ ...base, HILOS_CONECTORES_AGENTE_CONFIG_DIR: conf, HILOS_CONECTORES_AGENTE_ENV: 'x.env' }), /ruta absoluta/);
  const cfg = cargarConfig({ ...base, HILOS_CONECTORES_AGENTE_CONFIG_DIR: conf, HILOS_CONECTORES_AGENTE_ENV: env, HILOS_CONECTORES_AGENTE_PROYECTO: vault, HILOS_CONECTORES_AGENTE_EXCLUIR: 'a, b' });
  assert.deepEqual(cfg.conectoresAgente, { configDir: conf, envArchivo: env, proyectoDir: vault, excluir: ['a', 'b'] });
  const listo = conectoresAgenteListo(cfg);
  assert.match(listo, /^engram, mi-api, playwright \(de /);
  assert.ok(!listo.includes('llave-secreta'), 'la línea «listo:» no lleva valores');
});

// ---------- Integración con el puente (correr falso) ----------

function synerlinkFalso() {
  const llamadas = [];
  return {
    llamadas,
    estado: async (...a) => llamadas.push(['estado', ...a]),
    contexto: async (id) => ({
      project: { idProject: 3, name: 'Comex Latam', company: { companyName: 'GSS' }, profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v1', files: [] },
      conversation: { id, title: 'x' },
    }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    proponer: async () => ({ creadas: [], rechazadas: [] }),
    consumo: async () => {},
    confirmar: async (ids) => llamadas.push(['confirmar', ids]),
    descargar: async () => Buffer.from(''),
  };
}

test('puente: cualquier usuario recibe los conectores del agente; el hilo no ve sus llaves; el mcp del turno se borra', async () => {
  const d = tmp();
  const { conf, env, vault } = configAgente(d);
  const dir = path.join(d, 'puente');
  mkdirSync(dir);
  const cfg = {
    hilosDir: dir, agente: 'play', agenteNombre: 'Play', maxConcurrencia: 1, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: '/Users/pedro', configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'oauth-token', valor: 't' },
    conectoresAgente: { configDir: conf, envArchivo: env, proyectoDir: vault, excluir: [] },
  };
  const corridas = [];
  const s = synerlinkFalso();
  const puente = crearPuente({
    cfg, synerlink: s, estado: new Estado(dir),
    correr: async (o) => {
      const i = o.args.indexOf('--mcp-config');
      corridas.push({ ...o, rutaMcp: o.args[i + 1], mcp: JSON.parse(readFileSync(o.args[i + 1], 'utf8')), sistema: readFileSync(path.join(o.cwd, '.puente', 'sistema.md'), 'utf8') });
      return { resultado: { ok: true, texto: 'ok' }, tokens: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 }, modelos: [] };
    },
  });
  await puente.atender('60', [msg(1, OTRA, 'usa tus conectores')]);
  await puente.atender('61', [msg(2, NICO, 'usa tus conectores')]);
  for (const c of corridas) {
    assert.ok(c.args.includes('--restricted'), 'sigue el modo normal (sin Orus completo en este puente)');
    assert.deepEqual(Object.keys(c.mcp.mcpServers).sort(), ['engram', 'mi-api', 'playwright']);
    assert.ok(c.rutaMcp.startsWith(path.join(dir, 'conectores-agente')));
    assert.ok(!existsSync(c.rutaMcp), 'se borra al terminar el turno');
    assert.deepEqual(JSON.parse(readFileSync(path.join(c.cwd, '.puente', 'mcp.json'), 'utf8')), { mcpServers: {} }, 'el mcp.json del hilo no lleva los del agente');
    assert.ok(!readFileSync(path.join(c.cwd, '.puente', 'sistema.md'), 'utf8').includes('llave-secreta'));
    assert.match(c.sistema, /Sus conectores \(los mismos de su chat de Play\)/);
    assert.ok(c.args.includes('mcp__playwright') && c.args.includes('mcp__engram'));
  }
  assert.equal(corridas.length, 2);
  assert.deepEqual(readdirSync(path.join(dir, 'conectores-agente')), []);
});

test('puente: si el config del agente no se puede leer, el turno va sin sus conectores y lo dice', async () => {
  const d = tmp();
  const { conf } = configAgente(d);
  const dir = path.join(d, 'puente');
  mkdirSync(dir);
  writeFileSync(path.join(conf, '.claude.json'), '{roto');
  const cfg = {
    hilosDir: dir, agente: 'play', agenteNombre: 'Play', maxConcurrencia: 1, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: '/Users/pedro', configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'oauth-token', valor: 't' },
    conectoresAgente: { configDir: conf, envArchivo: null, proyectoDir: null, excluir: [] },
  };
  const corridas = [];
  const s = synerlinkFalso();
  const puente = crearPuente({ cfg, synerlink: s, estado: new Estado(dir), correr: async (o) => (corridas.push(o), { resultado: { ok: true, texto: 'ok' } }) });
  await puente.atender('70', [msg(1, OTRA)]);
  assert.equal(corridas[0].args[corridas[0].args.indexOf('--mcp-config') + 1], path.join(corridas[0].cwd, '.puente', 'mcp.json'));
  assert.match(s.llamadas.find((l) => l[0] === 'responder')[2], /no pude cargar mis conectores de siempre/);
});
