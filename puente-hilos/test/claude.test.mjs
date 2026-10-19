import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { acumularEvento, armarArgumentos, armarEntorno, correrTurno, revisarInit } from '../src/claude.mjs';
import { HERRAMIENTAS_PROHIBIDAS } from '../src/config.mjs';

const SESION = { id: '11111111-2222-3333-4444-555555555555', nueva: false };
const PERFIL_SAP = {
  mcpServers: { 'sapbo-farmalogica': { type: 'http', url: 'http://x/mcp' } },
  herramientas: ['mcp__sapbo-farmalogica__sap_query'],
  web: false,
};
const base = { perfil: PERFIL_SAP, sesion: SESION, rutaMcp: '/h/mcp.json', rutaSistema: '/h/sistema.md', dirArchivos: '/h/archivos' };

function valorDe(args, bandera) {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : undefined;
}

test('modo restringido, dontAsk y sin permisos abiertos', () => {
  const args = armarArgumentos(base);
  assert.ok(args.includes('--restricted'));
  assert.equal(valorDe(args, '--permission-mode'), 'dontAsk');
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes('bypassPermissions'));
  assert.ok(!args.includes('--continue'));
});

test('solo los conectores del hilo y el plugin de Telegram apagado', () => {
  const args = armarArgumentos(base);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(valorDe(args, '--mcp-config'), '/h/mcp.json');
  const settings = JSON.parse(valorDe(args, '--settings'));
  assert.equal(settings.enabledPlugins['telegram@claude-plugins-official'], false);
  assert.equal(settings.disableAllHooks, true);
});

test('herramientas mínimas: sin Bash ni subagentes; sin web si el perfil no la pide; escritura solo en ./trabajo', () => {
  const args = armarArgumentos(base);
  const tools = valorDe(args, '--tools').split(',');
  for (const p of HERRAMIENTAS_PROHIBIDAS) assert.ok(!tools.includes(p), `no debe traer ${p}`);
  assert.ok(!tools.includes('WebSearch'));
  assert.ok(!tools.includes('WebFetch'));
  assert.ok(args.includes('Edit(./trabajo/**)'));
  assert.ok(!args.includes('Edit'));
  assert.ok(args.includes('mcp__sapbo-farmalogica__sap_query'));
  const i = args.indexOf('--disallowedTools');
  for (const p of HERRAMIENTAS_PROHIBIDAS) assert.ok(args.slice(i).includes(p));
});

test('WebSearch y WebFetch solo si el perfil lo pide (y Bash nunca)', () => {
  const args = armarArgumentos({ ...base, perfil: { ...PERFIL_SAP, web: true } });
  const tools = valorDe(args, '--tools').split(',');
  assert.ok(tools.includes('WebSearch') && tools.includes('WebFetch'));
  assert.ok(!tools.includes('Bash') && !tools.includes('Agent'));
  assert.ok(args.includes('WebFetch'));
});

test('sesión: --session-id la primera vez, --resume después', () => {
  const nueva = armarArgumentos({ ...base, sesion: { ...SESION, nueva: true } });
  assert.equal(valorDe(nueva, '--session-id'), SESION.id);
  assert.ok(!nueva.includes('--resume'));
  const vieja = armarArgumentos(base);
  assert.equal(valorDe(vieja, '--resume'), SESION.id);
  assert.throws(() => armarArgumentos({ ...base, sesion: { id: 'x; rm -rf /', nueva: true } }));
});

test('el hijo NO hereda el entorno del puente: solo config aislado y una credencial', () => {
  const env = armarEntorno({ path: '/usr/bin', home: '/Users/x', configClaudeDir: '/Users/x/.puente-hilos/p/claude-config', credencial: { tipo: 'api-key', valor: 'sk-test' } });
  // Los topes de subagentes van SIEMPRE (F2): sin equipo, tope 1 y Agent prohibida.
  assert.deepEqual(Object.keys(env).sort(), [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS',
    'CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS',
    'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH',
    'CLAUDE_CONFIG_DIR',
    'DISABLE_AUTOUPDATER',
    'HOME',
    'LANG',
    'PATH',
  ]);
  assert.ok(!('HILOS_SYNERLINK_KEY' in env));
  assert.equal(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, '1');
  assert.equal(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '1');
  const conToken = armarEntorno({ path: '/usr/bin', home: '/h', configClaudeDir: '/c', credencial: { tipo: 'oauth-token', valor: 't' } });
  assert.equal(conToken.CLAUDE_CODE_OAUTH_TOKEN, 't');
  assert.ok(!('ANTHROPIC_API_KEY' in conToken));
});

test('revisarInit detecta herramientas prohibidas, permisos abiertos y conectores ajenos', () => {
  assert.deepEqual(revisarInit({ tools: ['Read', 'mcp__sapbo-farmalogica__sap_query'], permissionMode: 'dontAsk', mcp_servers: [{ name: 'sapbo-farmalogica' }] }, PERFIL_SAP), []);
  const p = revisarInit({ tools: ['Bash'], permissionMode: 'bypassPermissions', mcp_servers: [{ name: 'kronos-synerlink' }] }, PERFIL_SAP);
  assert.equal(p.length, 3);
});

test('acumularEvento suma consumo, modelos y sesión', () => {
  let acc = {};
  acc = acumularEvento(acc, { type: 'system', subtype: 'init', session_id: 's1' });
  acc = acumularEvento(acc, { type: 'assistant', message: { model: 'claude-x', content: [{ type: 'tool_use', name: 'Read' }] } });
  acc = acumularEvento(acc, { type: 'assistant', parent_tool_use_id: 't', message: { model: 'claude-x', content: [] } });
  acc = acumularEvento(acc, { type: 'result', subtype: 'success', is_error: false, result: 'hola', session_id: 's1', usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } });
  assert.equal(acc.sessionId, 's1');
  assert.equal(acc.apiMessages, 2);
  assert.equal(acc.apiMessagesSubagents, 1);
  assert.equal(acc.ultimaHerramienta, 'Read');
  assert.deepEqual(acc.tokens, { input: 10, cacheCreation: 2, cacheRead: 3, output: 4 });
  assert.deepEqual(acc.resultado, { ok: true, texto: 'hola', subtipo: 'success' });
});

/** Proceso falso: escribe eventos stream-json y se cierra. */
function hijoFalso(eventos, { colgado = false } = {}) {
  const h = new EventEmitter();
  h.stdout = new PassThrough();
  h.stderr = new PassThrough();
  h.stdin = new PassThrough();
  h.matado = false;
  h.kill = () => {
    h.matado = true;
    setImmediate(() => h.emit('close', null));
  };
  setImmediate(() => {
    for (const e of eventos) h.stdout.write(`${JSON.stringify(e)}\n`);
    if (!colgado) setImmediate(() => h.emit('close', 0));
  });
  return h;
}

test('correrTurno aborta si el proceso arranca con una herramienta prohibida', async () => {
  let hijo;
  const r = await correrTurno({
    bin: 'claude', args: [], env: {}, cwd: '/', prompt: 'x', perfil: PERFIL_SAP, timeoutMs: 5000,
    spawnImpl: () => (hijo = hijoFalso([{ type: 'system', subtype: 'init', tools: ['Bash'], permissionMode: 'dontAsk' }], { colgado: true })),
  });
  assert.match(r.abortado, /arranque inseguro/);
  assert.ok(hijo.matado);
});

test('correrTurno corta por tiempo', async () => {
  const r = await correrTurno({
    bin: 'claude', args: [], env: {}, cwd: '/', prompt: 'x', perfil: PERFIL_SAP, timeoutMs: 30,
    spawnImpl: () => hijoFalso([], { colgado: true }),
  });
  assert.equal(r.abortado, 'tiempo agotado');
});

test('correrTurno devuelve el resultado de un turno normal', async () => {
  const r = await correrTurno({
    bin: 'claude', args: [], env: {}, cwd: '/', prompt: 'x', perfil: PERFIL_SAP, timeoutMs: 5000,
    spawnImpl: () => hijoFalso([
      { type: 'system', subtype: 'init', session_id: 's', tools: ['Read'], permissionMode: 'dontAsk', mcp_servers: [] },
      { type: 'result', subtype: 'success', is_error: false, result: 'Listo', usage: { input_tokens: 1, output_tokens: 1 } },
    ]),
  });
  assert.equal(r.abortado, null);
  assert.equal(r.resultado.texto, 'Listo');
});
