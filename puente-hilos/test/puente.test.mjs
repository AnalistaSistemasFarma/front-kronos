import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crearPuente, verificarBandeja, verificarClaude } from '../src/puente.mjs';
import { Estado } from '../src/hilos.mjs';
import { validarPerfiles } from '../src/config.mjs';

test('no arranca con la llave del bot vivo (scope distinto de projects)', () => {
  assert.throws(() => verificarBandeja({ agent: { code: 'play' }, messages: [] }, 'play'), /scope/);
  assert.throws(() => verificarBandeja({ scope: 'projects', agent: { code: 'horus' } }, 'play'), /agente/);
  assert.doesNotThrow(() => verificarBandeja({ scope: 'projects', agent: { code: 'play' } }, 'play'));
});

test('no arranca con un claude que no soporta el modo restringido', () => {
  assert.throws(() => verificarClaude('claude', '--help --tools --session-id'), /restricted/);
});

function synerlinkFalso() {
  const llamadas = [];
  return {
    llamadas,
    estado: async (...a) => llamadas.push(['estado', ...a]),
    contexto: async (id) => ({
      project: {
        idProject: 7, name: 'Comex Latam', company: { companyName: 'ONE LATAM PHARMA' },
        profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: 'Solo comex.', version: 'v1', files: [],
      },
      conversation: { id, title: 'x' },
    }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    consumo: async (r) => llamadas.push(['consumo', r]),
    confirmar: async (ids) => llamadas.push(['confirmar', ids]),
    descargar: async () => Buffer.from(''),
  };
}

test('un turno: publica la respuesta, reporta consumo por hilo, confirma y deja el indicador en reposo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-'));
  const cfg = {
    hilosDir: dir, agente: 'play', agenteNombre: 'Play', maxConcurrencia: 2, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
  };
  const s = synerlinkFalso();
  const corridas = [];
  const puente = crearPuente({
    cfg, synerlink: s, estado: new Estado(dir),
    correr: async (opts) => {
      corridas.push(opts);
      return { resultado: { ok: true, texto: 'Respuesta' }, sessionId: 'sesion-1', tokens: { input: 5, cacheCreation: 0, cacheRead: 0, output: 3 }, modelos: ['m'], apiMessages: 1 };
    },
  });
  puente.recibir([
    { id: 1, idConversation: 40, body: 'hola', author: { name: 'Silvia' }, conversation: { kind: 'project' } },
    { id: 2, idConversation: 40, body: 'otra', author: { name: 'Angye' }, conversation: { kind: 'project' } },
    { id: 3, idConversation: 41, body: 'x', conversation: { kind: 'direct' } }, // nunca debe pasar
  ]);
  // Un duplicado de la bandeja (ack=false) no se vuelve a encolar.
  assert.equal(puente.recibir([{ id: 1, idConversation: 40, body: 'hola', conversation: { kind: 'project' } }]), 0);
  await puente.cola.vacia();

  assert.equal(corridas.length, 1);
  assert.equal(corridas[0].cwd, path.join(dir, 'proyectos', '7', 'conversaciones', '40'));
  assert.match(corridas[0].prompt, /Silvia[\s\S]*Angye/);
  assert.ok(corridas[0].args.includes('--session-id'), 'primera vez: sesión nueva');
  const sistema = readFileSync(path.join(corridas[0].cwd, '.puente', 'sistema.md'), 'utf8');
  assert.match(sistema, /Solo comex\./);
  assert.ok(existsSync(path.join(dir, 'proyectos', '7', 'CLAUDE.md')));
  assert.deepEqual(JSON.parse(readFileSync(path.join(corridas[0].cwd, '.puente', 'mcp.json'), 'utf8')), { mcpServers: {} });

  const tipos = s.llamadas.map((l) => l[0]);
  assert.ok(tipos.includes('responder'));
  const consumo = s.llamadas.find((l) => l[0] === 'consumo')[1];
  assert.equal(consumo.idConversation, 40);
  assert.deepEqual(s.llamadas.find((l) => l[0] === 'confirmar')[1], [1, 2]);
  assert.deepEqual(s.llamadas.at(-1).slice(0, 3), ['estado', 40, 'idle']);
  assert.ok(existsSync(path.join(dir, 'consumo.jsonl')));

  // Segundo turno del mismo hilo: --resume con la sesión guardada.
  puente.recibir([{ id: 4, idConversation: 40, body: 'sigo', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  const args2 = corridas[1].args;
  assert.equal(args2[args2.indexOf('--resume') + 1], corridas[0].args[corridas[0].args.indexOf('--session-id') + 1]);
});

test('perfil desconocido: no improvisa conectores, avisa en el hilo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-'));
  const s = synerlinkFalso();
  s.contexto = async () => ({ project: { idProject: 1, name: 'X', company: { companyName: 'Y' }, profile: { key: 'ryan', label: 'Ryan' }, files: [], version: 'v' } });
  let corrio = false;
  const puente = crearPuente({
    cfg: { hilosDir: dir, maxConcurrencia: 1, perfiles: validarPerfiles({}), timeoutTurnoMs: 1000 },
    synerlink: s, estado: new Estado(dir), correr: async () => { corrio = true; },
  });
  puente.recibir([{ id: 9, idConversation: 5, body: 'x', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.equal(corrio, false);
  assert.match(s.llamadas.find((l) => l[0] === 'responder')[2], /no está configurado/);
  assert.deepEqual(s.llamadas.find((l) => l[0] === 'confirmar')[1], [9]);
});
