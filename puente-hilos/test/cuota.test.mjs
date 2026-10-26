import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cambioRelevante, crearMedidorCuota, cuotaDeCabeceras, cuotaDeEvento, MODELO_SONDA, PAUSA_404_MS, sondearCuota } from '../src/cuota.mjs';
import { cargarConfig } from '../src/config.mjs';
import { crearClienteSynerLink } from '../src/synerlink.mjs';

const T0 = new Date('2026-10-22T12:00:00.000Z');

/** El evento tal como lo emitió Claude Code 2.1.299 el 2026-10-22 (verificado con haiku). */
const EVENTO = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1792684200,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    overageDisabledReason: 'org_level_disabled',
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.22, resetsAt: 1792684200 },
      seven_day: { utilization: 0.4, resetsAt: 1792879200 },
    },
  },
  uuid: 'a43e0c45-ed80-4ac9-80a6-8361d6cb5493',
  session_id: '18f1aeee-92cb-4453-940c-8e6b2e8b9617',
};

test('cuotaDeEvento: lee las dos ventanas del rate_limit_event del stream', () => {
  const e = cuotaDeEvento(EVENTO, T0);
  assert.deepEqual(e, {
    utilizacion7d: 40,
    reset7d: new Date(1792879200 * 1000).toISOString(),
    utilizacion5h: 22,
    reset5h: new Date(1792684200 * 1000).toISOString(),
    overage: 'rejected',
    medidoEn: T0.toISOString(),
    fuente: 'turno',
  });
});

test('cuotaDeEvento: ignora otros eventos y eventos sin ventanas', () => {
  assert.equal(cuotaDeEvento({ type: 'assistant' }, T0), null);
  assert.equal(cuotaDeEvento({ type: 'rate_limit_event' }, T0), null);
  assert.equal(cuotaDeEvento({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, T0), null);
});

test('cuotaDeEvento: sin unifiedWindows usa la ventana que trae el evento', () => {
  const e = cuotaDeEvento({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'seven_day', utilization: 0.995, resetsAt: 1792879200 } }, T0);
  assert.equal(e.utilizacion7d, 99.5);
  assert.equal(e.utilizacion5h, null);
});

test('cuotaDeCabeceras: lee los encabezados unified (Headers y objeto plano)', () => {
  const h = new Headers({
    'anthropic-ratelimit-unified-7d-utilization': '0.99',
    'anthropic-ratelimit-unified-7d-reset': '1792879200',
    'anthropic-ratelimit-unified-5h-utilization': '0.19',
    'anthropic-ratelimit-unified-5h-reset': '1792684200',
    'anthropic-ratelimit-unified-overage-status': 'rejected',
  });
  const e = cuotaDeCabeceras(h, T0);
  assert.equal(e.utilizacion7d, 99);
  assert.equal(e.utilizacion5h, 19);
  assert.equal(e.overage, 'rejected');
  assert.equal(e.fuente, 'sonda');
  assert.equal(cuotaDeCabeceras({}, T0), null);
  assert.equal(cuotaDeCabeceras({ 'anthropic-ratelimit-unified-5h-utilization': '0.5' }, T0).utilizacion5h, 50);
});

test('sondearCuota: llamada mínima con haiku y max_tokens 1, Bearer del token y sin filtrarlo', async () => {
  let pedido;
  const fetchImpl = async (url, init) => {
    pedido = { url, init };
    return new Response('{}', {
      status: 200,
      headers: { 'anthropic-ratelimit-unified-7d-utilization': '0.4', 'anthropic-ratelimit-unified-5h-utilization': '0.22' },
    });
  };
  const e = await sondearCuota({ credencial: { tipo: 'oauth-token', valor: 'sk-ant-oat-secreto' }, fetchImpl, ahora: () => T0 });
  assert.equal(pedido.url, 'https://api.anthropic.com/v1/messages');
  const cuerpo = JSON.parse(pedido.init.body);
  assert.equal(cuerpo.model, MODELO_SONDA);
  assert.equal(cuerpo.max_tokens, 1);
  assert.equal(pedido.init.headers.Authorization, 'Bearer sk-ant-oat-secreto');
  assert.equal(pedido.init.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(e.utilizacion7d, 40);
  assert.ok(!JSON.stringify(e).includes('secreto'));
});

test('sondearCuota: con llave de API no sondea; sin encabezados lanza sin el token', async () => {
  let llamadas = 0;
  const f = async () => {
    llamadas += 1;
    return new Response('{}', { status: 401 });
  };
  assert.equal(await sondearCuota({ credencial: { tipo: 'api-key', valor: 'sk-ant-api' }, fetchImpl: f }), null);
  assert.equal(llamadas, 0);
  await assert.rejects(sondearCuota({ credencial: { tipo: 'oauth-token', valor: 'sk-ant-oat-secreto' }, fetchImpl: f }), (err) => {
    assert.match(err.message, /HTTP 401/);
    assert.ok(!err.message.includes('secreto'));
    return true;
  });
});

test('cambioRelevante: un punto, un reinicio o el excedente', () => {
  const a = { utilizacion7d: 40, utilizacion5h: 22, reset7d: 'x', reset5h: 'y', overage: 'rejected' };
  assert.equal(cambioRelevante(null, a), true);
  assert.equal(cambioRelevante(a, { ...a, utilizacion5h: 22.5 }), false);
  assert.equal(cambioRelevante(a, { ...a, utilizacion5h: 23 }), true);
  assert.equal(cambioRelevante(a, { ...a, reset5h: 'z' }), true);
  assert.equal(cambioRelevante(a, { ...a, overage: 'allowed' }), true);
});

function reloj(inicio = T0.getTime()) {
  let t = inicio;
  return { ahora: () => new Date(t), avanzar: (ms) => (t += ms) };
}

test('medidor: durante el turno publica lo del stream, sin repetir antes de 60 s si no cambia', async () => {
  const r = reloj();
  const publicados = [];
  const m = crearMedidorCuota({ credencial: { tipo: 'oauth-token', valor: 't' }, publicar: async (e) => publicados.push(e), ahora: r.ahora, sondear: async () => assert.fail('no debe sondear') });
  assert.equal(m.registrarEvento({ type: 'assistant' }), false);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(publicados.length, 1);
  r.avanzar(61_000);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(publicados.length, 2);
  assert.equal(publicados[0].fuente, 'turno');
});

test('medidor: sondea solo sin turnos y cuando la medición tiene el intervalo', async () => {
  const r = reloj();
  let ocupado = true;
  let sondas = 0;
  const publicados = [];
  const m = crearMedidorCuota({
    credencial: { tipo: 'oauth-token', valor: 't' },
    publicar: async (e) => publicados.push(e),
    ocupado: () => ocupado,
    intervaloMs: 300_000,
    ahora: r.ahora,
    sondear: async () => {
      sondas += 1;
      return { utilizacion7d: 40, reset7d: null, utilizacion5h: 22, reset5h: null, overage: null, medidoEn: r.ahora().toISOString(), fuente: 'sonda' };
    },
  });
  assert.equal(await m.revisar(), null); // ocupado
  ocupado = false;
  assert.ok(await m.revisar()); // nunca había medido
  assert.equal(await m.revisar(), null); // recién medido
  r.avanzar(299_000);
  assert.equal(await m.revisar(), null);
  r.avanzar(1_000);
  assert.ok(await m.revisar());
  assert.equal(sondas, 2);
  assert.equal(publicados.length, 2); // la sonda publica siempre
  // Un evento de turno cuenta como medición: no hay sonda justo después.
  r.avanzar(400_000);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(await m.revisar(), null);
  assert.equal(sondas, 2);
});

test('medidor: intervalo 0 = solo lo del stream; un 404 pausa 5 min sin tumbar nada', async () => {
  const r = reloj();
  const sinSonda = crearMedidorCuota({ credencial: { tipo: 'oauth-token', valor: 't' }, publicar: async () => {}, intervaloMs: 0, sondear: async () => assert.fail('no') });
  assert.equal(await sinSonda.revisar({ forzar: true }), null);

  let intentos = 0;
  const logs = [];
  const m = crearMedidorCuota({
    credencial: { tipo: 'oauth-token', valor: 't' },
    publicar: async () => {
      intentos += 1;
      throw Object.assign(new Error('HTTP 404'), { status: 404 });
    },
    ahora: r.ahora,
    log: (...p) => logs.push(p.join(' ')),
  });
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  r.avanzar(120_000);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(intentos, 1);
  assert.equal(logs.length, 1);
  assert.equal(PAUSA_404_MS, 5 * 60 * 1000);
  r.avanzar(PAUSA_404_MS - 120_000 - 1);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(intentos, 1); // aún en pausa
  r.avanzar(1);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(intentos, 2);
  assert.equal(logs.length, 1); // el aviso del 404 no se repite
});

test('medidor: registra en el log la primera publicación exitosa y la primera tras un fallo', async () => {
  const r = reloj();
  let falla = false;
  const logs = [];
  const m = crearMedidorCuota({
    credencial: { tipo: 'oauth-token', valor: 't' },
    publicar: async () => {
      if (falla) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    },
    ahora: r.ahora,
    log: (...p) => logs.push(p.join(' ')),
  });
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /cuota publicada en SynerLink: semanal 40 %, 5 h 22 % \(turno/);
  r.avanzar(61_000);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(logs.length, 1); // los siguientes envíos no llenan el log
  falla = true;
  r.avanzar(61_000);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(logs.length, 2);
  assert.match(logs[1], /404/);
  falla = false;
  r.avanzar(PAUSA_404_MS);
  m.registrarEvento(EVENTO);
  await new Promise((res) => setImmediate(res));
  assert.equal(logs.length, 3);
  assert.match(logs[2], /cuota publicada en SynerLink/);
});

test('medidor: una sonda que falla no se reintenta en cada vuelta', async () => {
  const r = reloj();
  let sondas = 0;
  const m = crearMedidorCuota({
    credencial: { tipo: 'oauth-token', valor: 't' },
    publicar: async () => {},
    ahora: r.ahora,
    sondear: async () => {
      sondas += 1;
      throw new Error('red caída');
    },
  });
  assert.equal(await m.revisar(), null);
  assert.equal(await m.revisar(), null);
  assert.equal(sondas, 1);
});

test('cliente: POST /api/chat/agent/quota con la llave del agente', async () => {
  let visto;
  const cliente = crearClienteSynerLink({
    url: 'http://x',
    llave: 'k'.repeat(40),
    fetchImpl: async (url, init) => {
      visto = { url, init };
      return new Response('{"ok":true}', { status: 200 });
    },
  });
  await cliente.cuota({ utilizacion7d: 40 });
  assert.equal(visto.url, 'http://x/api/chat/agent/quota');
  assert.equal(visto.init.method, 'POST');
  assert.equal(visto.init.headers.Authorization, `Bearer ${'k'.repeat(40)}`);
  assert.deepEqual(JSON.parse(visto.init.body), { utilizacion7d: 40 });
});

test('config: HILOS_CUOTA y HILOS_CUOTA_INTERVALO_MS', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-hilos-'));
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({ farmalogica: { mcpServers: { s: { type: 'http', url: 'http://x/mcp' } }, herramientas: ['mcp__s__sap_query'] } }));
  const base = {
    HILOS_ENTORNO: 'pruebas',
    HILOS_SYNERLINK_URL: 'http://pruebas.local:3070/',
    HILOS_SYNERLINK_KEY: 'k'.repeat(40),
    HILOS_AGENTE: 'Play',
    HILOS_DIR: path.join(dir, 'puente'),
    HILOS_PERFILES: perfiles,
    HILOS_ANTHROPIC_API_KEY: 'sk-test',
  };
  assert.deepEqual(cargarConfig(base).cuota, { habilitada: true, intervaloMs: 300_000 });
  assert.deepEqual(cargarConfig({ ...base, HILOS_CUOTA: 'no' }).cuota, { habilitada: false, intervaloMs: 300_000 });
  assert.equal(cargarConfig({ ...base, HILOS_CUOTA_INTERVALO_MS: '0' }).cuota.intervaloMs, 0);
  assert.equal(cargarConfig({ ...base, HILOS_CUOTA_INTERVALO_MS: '600000' }).cuota.intervaloMs, 600_000);
  assert.throws(() => cargarConfig({ ...base, HILOS_CUOTA: 'tal-vez' }), /HILOS_CUOTA/);
  assert.throws(() => cargarConfig({ ...base, HILOS_CUOTA_INTERVALO_MS: '5000' }), /HILOS_CUOTA_INTERVALO_MS/);
});

test('puente: el rate_limit_event del turno va al medidor y no mueve el indicador', async () => {
  const { crearPuente } = await import('../src/puente.mjs');
  const { Estado } = await import('../src/hilos.mjs');
  const { validarPerfiles } = await import('../src/config.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-'));
  const cfg = {
    hilosDir: dir, agente: 'play', agenteNombre: 'Play', maxConcurrencia: 2, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
  };
  const llamadas = [];
  const synerlink = {
    estado: async (...a) => llamadas.push(['estado', ...a]),
    contexto: async (id) => ({
      project: { idProject: 7, name: 'P', company: { companyName: 'C' }, profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v1', files: [] },
      conversation: { id, title: 'x' },
    }),
    responder: async () => {},
    proponer: async () => ({ creadas: [], rechazadas: [] }),
    consumo: async () => {},
    confirmar: async () => {},
    descargar: async () => Buffer.from(''),
  };
  const eventos = [];
  const medidor = { registrarEvento: (e) => eventos.push(e) };
  const puente = crearPuente({
    cfg, synerlink, estado: new Estado(dir), medidor,
    correr: async (opts) => {
      opts.alEvento(EVENTO, { ultimaHerramienta: 'Read' });
      return { resultado: { ok: true, texto: 'ok' }, sessionId: 's', tokens: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 }, modelos: ['m'], apiMessages: 1 };
    },
  });
  puente.recibir([{ id: 1, idConversation: 40, body: 'hola', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].type, 'rate_limit_event');
  assert.ok(!llamadas.some((l) => l[0] === 'estado' && l[2] === 'tool'), 'el evento de cuota no cambia la etiqueta');
});
