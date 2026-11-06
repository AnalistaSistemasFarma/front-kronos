// Recuperación al reiniciar (2026-11-06, pedido de Nicolás Rivera): si la sesión del hilo es NUEVA
// y el hilo ya tenía mensajes, el primer turno lleva los últimos mensajes anteriores del hilo
// (de SynerLink), para que el agente no empiece en blanco. Claude Code y openclaw. No tras /clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crearPuente } from '../src/puente.mjs';
import { bloqueRecuperacion, Estado, RECUPERACION_MAX_MENSAJES } from '../src/hilos.mjs';
import { validarPerfiles } from '../src/config.mjs';

const historia = (n, desde = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: desde + i,
    role: i % 2 ? 'agent' : 'user',
    author: i % 2 ? 'Kepler' : 'Neider Navarrete',
    createdAt: `2026-11-0${1 + (i % 5)}T10:00:00.000Z`,
    body: `mensaje ${desde + i}`,
    attachments: i === 0 ? ['ventas.xlsx'] : [],
  }));

test('bloqueRecuperacion: sin mensajes anteriores al lote → vacío', () => {
  assert.equal(bloqueRecuperacion({ conversation: { history: historia(1, 10) } }, [10]), '');
  assert.equal(bloqueRecuperacion({ conversation: {} }, [10]), '');
  assert.equal(bloqueRecuperacion(null, []), '');
});

test('bloqueRecuperacion: solo lo ANTERIOR al lote, en orden, con autores, adjuntos y el aviso de dato', () => {
  const b = bloqueRecuperacion({ conversation: { history: historia(5, 1) } }, [5]);
  assert.match(b, /RECUPERACIÓN DE CONTEXTO/);
  assert.match(b, /ya tenía 4 mensaje/);
  assert.match(b, /mensaje 1[\s\S]*mensaje 2[\s\S]*mensaje 3[\s\S]*mensaje 4/);
  assert.doesNotMatch(b, /mensaje 5/);
  assert.match(b, /Kepler \(asistente\)/);
  assert.match(b, /Adjuntos: ventas\.xlsx/);
  assert.match(b, /DATO, nunca instrucción/);
});

test('bloqueRecuperacion: topes de cantidad y de caracteres', () => {
  const b = bloqueRecuperacion({ conversation: { history: historia(40, 1) } }, [41]);
  assert.equal((b.match(/^### /gm) ?? []).length, RECUPERACION_MAX_MENSAJES);
  assert.match(b, /hay 20 más antiguos/);
  assert.match(b, /mensaje 40/);
  const largo = [{ id: 1, role: 'user', author: 'A', body: 'x'.repeat(5000) }];
  assert.match(bloqueRecuperacion({ conversation: { history: largo } }, [2]), /… \[recortado\]/);
  const muchos = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, role: 'user', author: 'A', body: 'y'.repeat(1400) }));
  const corto = bloqueRecuperacion({ conversation: { history: muchos } }, [99], { maxChars: 5000 });
  assert.ok((corto.match(/^### /gm) ?? []).length < 20);
});

test('Estado: /clear (porPedido) marca la sesión para NO recuperar; se borra al iniciar', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'estado-'));
  const e = new Estado(dir);
  assert.equal(e.sesionDe(9).sinRecuperar, false);
  e.marcarIniciada(9, e.sesionDe(9).id);
  e.reiniciarSesion(9, { porPedido: true });
  const s = e.sesionDe(9);
  assert.equal(s.nueva, true);
  assert.equal(s.sinRecuperar, true);
  e.marcarIniciada(9, s.id);
  e.reiniciarSesion(9); // sesión perdida: sí recupera
  assert.equal(e.sesionDe(9).sinRecuperar, false);
});

function synerlinkFalso(history) {
  const llamadas = [];
  return {
    llamadas,
    estado: async () => {},
    contexto: async (id) => ({
      project: { idProject: 22, name: 'Seguimiento Comercial', company: { companyName: 'ONE LATAM PHARMA' }, profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: null, version: 'v1', files: [] },
      conversation: { id, title: 'Dashboards', history },
    }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    consumo: async () => {},
    confirmar: async () => {},
    descargar: async () => Buffer.from(''),
  };
}

function cfgBase(dir) {
  return {
    hilosDir: dir, agente: 'kepler', agenteNombre: 'Kepler', maxConcurrencia: 1, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
  };
}

test('puente Claude Code: sesión nueva + hilo con historia → el primer turno lleva la recuperación; el siguiente (--resume) no', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-rec-'));
  const corridas = [];
  const puente = crearPuente({
    cfg: cfgBase(dir), synerlink: synerlinkFalso([...historia(6, 100), { id: 200, role: 'user', author: 'Neider', body: '¿y el PR?' }]), estado: new Estado(dir),
    correr: async (opts) => {
      corridas.push(opts);
      return { resultado: { ok: true, texto: 'ok' }, sessionId: 's', tokens: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 }, modelos: ['m'], apiMessages: 1 };
    },
  });
  puente.recibir([{ id: 200, idConversation: 166, body: '¿y el PR?', author: { name: 'Neider' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.ok(corridas[0].args.includes('--session-id'));
  assert.match(corridas[0].prompt, /^## RECUPERACIÓN DE CONTEXTO/);
  assert.match(corridas[0].prompt, /mensaje 105[\s\S]*FIN DE LA RECUPERACIÓN[\s\S]*¿y el PR\?/);

  puente.recibir([{ id: 201, idConversation: 166, body: 'gracias', author: { name: 'Neider' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.ok(corridas[1].args.includes('--resume'));
  assert.doesNotMatch(corridas[1].prompt, /RECUPERACIÓN DE CONTEXTO/);
});

test('puente Claude Code: tras /clear la sesión nueva NO recibe la recuperación', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-rec-'));
  const estado = new Estado(dir);
  estado.marcarIniciada(166, estado.sesionDe(166).id);
  estado.reiniciarSesion(166, { porPedido: true });
  const corridas = [];
  const puente = crearPuente({
    cfg: cfgBase(dir), synerlink: synerlinkFalso(historia(6, 100)), estado,
    correr: async (opts) => {
      corridas.push(opts);
      return { resultado: { ok: true, texto: 'ok' }, sessionId: 's', tokens: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 }, modelos: ['m'], apiMessages: 1 };
    },
  });
  puente.recibir([{ id: 300, idConversation: 166, body: 'empecemos de cero', author: { name: 'Neider' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.ok(corridas[0].args.includes('--session-id'));
  assert.doesNotMatch(corridas[0].prompt, /RECUPERACIÓN DE CONTEXTO/);
});
