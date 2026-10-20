import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARCHIVO_ENTORNO, cargarConfig, leerTokenDeEnv, sellarEntorno, validarAislamiento, validarPerfiles } from '../src/config.mjs';

function envBase(dir, extra = {}) {
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({ farmalogica: { mcpServers: { s: { type: 'http', url: 'http://x/mcp' } }, herramientas: ['mcp__s__sap_query'] } }));
  return {
    HILOS_ENTORNO: 'pruebas',
    HILOS_SYNERLINK_URL: 'http://pruebas.local:3070/',
    HILOS_SYNERLINK_KEY: 'k'.repeat(40),
    HILOS_AGENTE: 'Play',
    HILOS_DIR: path.join(dir, 'puente'),
    HILOS_PERFILES: perfiles,
    HILOS_ANTHROPIC_API_KEY: 'sk-test',
    ...extra,
  };
}

const tmp = () => mkdtempSync(path.join(tmpdir(), 'puente-hilos-'));

test('carga una configuración válida con tope 2 por defecto', () => {
  const cfg = cargarConfig(envBase(tmp()));
  assert.equal(cfg.maxConcurrencia, 2);
  assert.equal(cfg.agente, 'play');
  assert.equal(cfg.url, 'http://pruebas.local:3070');
  assert.ok(cfg.configClaudeDir.endsWith(path.join('puente', 'claude-config')));
  assert.ok(cfg.perfiles.has('sin-conectores'));
});

test('solo admite pruebas o produccion', () => {
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_ENTORNO: 'prod' })), /pruebas o produccion/);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_ENTORNO: 'Produccion' })), /pruebas o produccion/);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_ENTORNO: 'testing' })), /pruebas o produccion/);
});

const URL_PROD = 'http://192.168.10.5:3003';
function envProd(dir, extra = {}) {
  return envBase(dir, {
    HILOS_ENTORNO: 'produccion',
    HILOS_SYNERLINK_URL: `${URL_PROD}/`,
    HILOS_CONFIRMAR_URL_PRODUCCION: URL_PROD,
    HILOS_DIR: path.join(dir, 'horus-prod'),
    ...extra,
  });
}

test('producción válida: URL de prod confirmada y carpeta propia', () => {
  const cfg = cargarConfig(envProd(tmp()));
  assert.equal(cfg.entorno, 'produccion');
  assert.equal(cfg.url, URL_PROD);
  assert.ok(cfg.configClaudeDir.endsWith(path.join('horus-prod', 'claude-config')));
});

test('producción: rechaza URLs de PRUEBAS conocidas', () => {
  for (const u of ['http://192.168.11.230:3030', 'http://192.168.11.230:3070', 'http://localhost:3003', 'http://127.0.0.1:3003']) {
    assert.throws(() => cargarConfig(envProd(tmp(), { HILOS_SYNERLINK_URL: u, HILOS_CONFIRMAR_URL_PRODUCCION: u })), /URL de PRUEBAS/);
  }
});

test('producción: exige la URL confirmada e idéntica', () => {
  assert.throws(() => cargarConfig(envProd(tmp(), { HILOS_CONFIRMAR_URL_PRODUCCION: '' })), /exige HILOS_CONFIRMAR_URL_PRODUCCION/);
  assert.throws(() => cargarConfig(envProd(tmp(), { HILOS_CONFIRMAR_URL_PRODUCCION: 'http://192.168.10.5:3004' })), /no coincide/);
});

test('producción: nunca una carpeta de pruebas ni una ya usada sin sello', () => {
  const d = tmp();
  assert.throws(() => cargarConfig(envProd(d, { HILOS_DIR: path.join(d, 'horus-pruebas') })), /carpeta de pruebas/);
  const usada = path.join(d, 'horus-otra');
  mkdirSync(usada, { recursive: true });
  writeFileSync(path.join(usada, 'estado.json'), '{}');
  assert.throws(() => cargarConfig(envProd(d, { HILOS_DIR: usada })), /sin sello de producción/);
});

test('el sello separa los entornos: pruebas no arranca en carpeta de producción y viceversa', () => {
  const d = tmp();
  const cfg = cargarConfig(envProd(d));
  mkdirSync(cfg.hilosDir, { recursive: true });
  assert.equal(sellarEntorno(cfg), true);
  assert.equal(sellarEntorno(cfg), false); // idempotente
  const sello = JSON.parse(readFileSync(path.join(cfg.hilosDir, ARCHIVO_ENTORNO), 'utf8'));
  assert.equal(sello.entorno, 'produccion');
  assert.equal(sello.url, URL_PROD);
  // Ya sellada (y con rastros de uso), producción sigue arrancando…
  writeFileSync(path.join(cfg.hilosDir, 'estado.json'), '{}');
  assert.equal(cargarConfig(envProd(d)).entorno, 'produccion');
  // …pero no con otra URL, ni un puente de pruebas sobre ella.
  const otra = 'http://10.0.0.9:3003';
  assert.throws(() => cargarConfig(envProd(d, { HILOS_SYNERLINK_URL: otra, HILOS_CONFIRMAR_URL_PRODUCCION: otra })), /sellado para/);
  assert.throws(() => cargarConfig(envBase(d, { HILOS_DIR: cfg.hilosDir })), /es de produccion/);
});

test('pruebas: igual que en F1 (sin confirmación, sin sello, carpeta ya usada)', () => {
  const d = tmp();
  const dir = path.join(d, 'play-pruebas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'estado.json'), '{}');
  const cfg = cargarConfig(envBase(d, { HILOS_DIR: dir }));
  assert.equal(cfg.entorno, 'pruebas');
  assert.equal(sellarEntorno(cfg), false);
  assert.equal(existsSync(path.join(dir, ARCHIVO_ENTORNO)), false);
});

test('exige exactamente una credencial', () => {
  const d = tmp();
  assert.throws(() => cargarConfig(envBase(d, { HILOS_ANTHROPIC_API_KEY: '' })), /EXACTAMENTE/);
  assert.throws(() => cargarConfig(envBase(d, { HILOS_CLAUDE_CODE_OAUTH_TOKEN: 't' })), /EXACTAMENTE/);
  assert.throws(() => cargarConfig(envBase(d, { HILOS_TOKEN_ENV_AGENTE: '/x/.env' })), /EXACTAMENTE/);
});

test('token del propio agente: lee SOLO CLAUDE_CODE_OAUTH_TOKEN del .env del bot', () => {
  const d = tmp();
  const envBot = path.join(d, 'bot.env');
  writeFileSync(envBot, 'TELEGRAM_BOT_TOKEN=secreto\nexport CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat-prueba"\nOTRA=1\n');
  const cfg = cargarConfig(envBase(d, { HILOS_ANTHROPIC_API_KEY: '', HILOS_TOKEN_ENV_AGENTE: envBot }));
  assert.deepEqual(cfg.credencial, { tipo: 'oauth-token', valor: 'sk-ant-oat-prueba' });
  assert.ok(!JSON.stringify(cfg).includes('TELEGRAM'));
});

test('leerTokenDeEnv no filtra el contenido del archivo en sus errores', () => {
  assert.throws(() => leerTokenDeEnv('/x', () => 'TELEGRAM_BOT_TOKEN=secreto\n'), (e) => !String(e.message).includes('secreto'));
  assert.throws(() => leerTokenDeEnv('/no/existe'), /No se pudo leer/);
});

test('el tope de concurrencia no pasa de 2 en F1', () => {
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_MAX_CONCURRENCIA: '5' })), /entre 1 y 2/);
});

test('rechaza carpetas de bots como HILOS_DIR', () => {
  const home = '/Users/x';
  assert.throws(() => validarAislamiento('/Users/x/.play/claude-config/hilos', home));
  assert.throws(() => validarAislamiento('/Users/x/.horus/hilos', home));
  assert.throws(() => validarAislamiento('/Users/x/.claude/hilos', home));
  assert.throws(() => validarAislamiento('/Users/x', home));
  assert.equal(validarAislamiento('/Users/x/.puente-hilos/play-pruebas', home), '/Users/x/.puente-hilos/play-pruebas');
});

test('perfiles: sin comodines, sin cabeceras y solo de servidores declarados', () => {
  assert.throws(() => validarPerfiles({ a: { mcpServers: { s: { type: 'http', url: 'http://x' } }, herramientas: ['mcp__s__*'] } }), /comodín/);
  assert.throws(() => validarPerfiles({ a: { mcpServers: { s: { type: 'http', url: 'http://x', headers: { Authorization: 'x' } } } } }), /cabeceras/);
  assert.throws(() => validarPerfiles({ a: { mcpServers: {}, herramientas: ['mcp__otro__sap_query'] } }), /no declara/);
  assert.throws(() => validarPerfiles({ a: { mcpServers: { s: { type: 'stdio', command: 'bash' } } } }), /http/);
});

test('el ejemplo del repositorio es válido', async () => {
  const { readFileSync } = await import('node:fs');
  const ejemplo = JSON.parse(readFileSync(new URL('../config/perfiles.example.json', import.meta.url), 'utf8'));
  const perfiles = validarPerfiles(ejemplo);
  assert.deepEqual([...perfiles.keys()].sort(), ['comex-latam', 'farmalogica', 'gss', 'olp', 'sin-conectores']);
  assert.equal(perfiles.get('comex-latam').web, true);
});

test('HILOS_MODELO: modelo del hilo principal por agente (2026-10-20) y --model en el turno', async () => {
  assert.equal(cargarConfig(envProd(tmp())).modelo, null);
  assert.equal(cargarConfig(envProd(tmp(), { HILOS_MODELO: ' claude-opus-5-5 ' })).modelo, 'claude-opus-5-5');
  assert.equal(cargarConfig(envProd(tmp(), { HILOS_MODELO: 'opus' })).modelo, 'opus');
  for (const malo of ['claude opus', '--dangerously-skip-permissions', 'x;rm -rf /', '-p']) {
    assert.throws(() => cargarConfig(envProd(tmp(), { HILOS_MODELO: malo })), /HILOS_MODELO inválido/, malo);
  }
  const { armarArgumentos } = await import('../src/claude.mjs');
  const args = armarArgumentos({ perfil: { mcpServers: {}, herramientas: [], web: false }, sesion: { id: '11111111-2222-3333-4444-555555555555', nueva: false }, rutaMcp: '/m', rutaSistema: '/s', modelo: 'claude-opus-5-5' });
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5');
});
