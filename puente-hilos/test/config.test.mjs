import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cargarConfig, leerTokenDeEnv, validarAislamiento, validarPerfiles } from '../src/config.mjs';

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

test('F1 solo PRUEBAS', () => {
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_ENTORNO: 'produccion' })), /PRUEBAS/);
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
