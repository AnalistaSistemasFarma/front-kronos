import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cargarConfig, validarPerfiles } from '../src/config.mjs';
import { acumularEvento, armarArgumentos } from '../src/claude.mjs';
import { topesEfectivos } from '../src/equipo.mjs';
import { crearPuente } from '../src/puente.mjs';
import { Estado } from '../src/hilos.mjs';
import {
  archivosDelTurno,
  archivosModificadosDesde,
  crearSupervisor,
  duracionLegible,
  lineaCorta,
  PROMPT_CONTINUACION,
  textoAvisoProgreso,
  textoCorte,
  textoTiempoTurno,
} from '../src/progreso.mjs';

const tmp = (p = 'progreso-') => mkdtempSync(path.join(tmpdir(), p));

function envBase(dir, extra = {}) {
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({}));
  return {
    HILOS_ENTORNO: 'pruebas',
    HILOS_SYNERLINK_URL: 'http://pruebas.local:3070/',
    HILOS_SYNERLINK_KEY: 'k'.repeat(40),
    HILOS_AGENTE: 'horus',
    HILOS_DIR: path.join(dir, 'puente'),
    HILOS_PERFILES: perfiles,
    HILOS_ANTHROPIC_API_KEY: 'sk-test',
    ...extra,
  };
}

// ---------- Configuración: sin tope de gasto, 60 min y avisos ----------

test('config: por defecto 60 min de tope, avisos cada 10 min, sin continuación automática', () => {
  const cfg = cargarConfig(envBase(tmp()));
  assert.equal(cfg.timeoutTurnoMs, 60 * 60 * 1000);
  assert.equal(cfg.avisoProgresoMs, 10 * 60 * 1000);
  assert.equal(cfg.continuarAlAgotar, false);
  assert.equal(cfg.sinTopeGasto, false);
  assert.equal(cfg.presupuestoUsd, null);
});

test('config: HILOS_MAX_BUDGET_USD=0 u off = sin ningún tope de gasto; un número sigue siendo tope', () => {
  for (const v of ['0', 'off', 'OFF', '0.0']) {
    const cfg = cargarConfig(envBase(tmp(), { HILOS_MAX_BUDGET_USD: v }));
    assert.equal(cfg.sinTopeGasto, true, v);
    assert.equal(cfg.presupuestoUsd, null, v);
  }
  const conTope = cargarConfig(envBase(tmp(), { HILOS_MAX_BUDGET_USD: '5' }));
  assert.equal(conTope.sinTopeGasto, false);
  assert.equal(conTope.presupuestoUsd, 5);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_MAX_BUDGET_USD: '-1' })), /0\/off/);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_MAX_BUDGET_USD: 'mucho' })), /HILOS_MAX_BUDGET_USD/);
});

test('config: HILOS_AVISO_PROGRESO_MS (off/0 lo apaga, acotado), HILOS_CONTINUAR_AL_AGOTAR y el máximo de 60 min', () => {
  assert.equal(cargarConfig(envBase(tmp(), { HILOS_AVISO_PROGRESO_MS: 'off' })).avisoProgresoMs, 0);
  assert.equal(cargarConfig(envBase(tmp(), { HILOS_AVISO_PROGRESO_MS: '0' })).avisoProgresoMs, 0);
  assert.equal(cargarConfig(envBase(tmp(), { HILOS_AVISO_PROGRESO_MS: '300000' })).avisoProgresoMs, 300000);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_AVISO_PROGRESO_MS: '1000' })), /HILOS_AVISO_PROGRESO_MS/);
  assert.equal(cargarConfig(envBase(tmp(), { HILOS_CONTINUAR_AL_AGOTAR: 'si' })).continuarAlAgotar, true);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_CONTINUAR_AL_AGOTAR: 'tal vez' })), /HILOS_CONTINUAR_AL_AGOTAR/);
  assert.equal(cargarConfig(envBase(tmp(), { HILOS_TIMEOUT_TURNO_MS: '3600000' })).timeoutTurnoMs, 3600000);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_TIMEOUT_TURNO_MS: '3600001' })), /HILOS_TIMEOUT_TURNO_MS/);
});

test('tope de gasto apagado: ni el turno solo ni el turno con equipo llevan --max-budget-usd', () => {
  const topes = topesEfectivos({}, { sinTopeGasto: true, presupuestoUsd: null, subagentesPresupuestoUsd: 3 });
  assert.equal(topes.presupuestoUsd, null);
  // Con tope configurado, como antes.
  assert.equal(topesEfectivos({}, { presupuestoUsd: null, subagentesPresupuestoUsd: 3 }).presupuestoUsd, 3);
  const perfil = validarPerfiles({}).get('sin-conectores');
  const base = { perfil, sesion: { id: '11111111-1111-4111-8111-111111111111', nueva: true }, rutaMcp: '/h/mcp.json', rutaSistema: '/h/s.md', dirArchivos: null, modelo: null };
  assert.ok(!armarArgumentos({ ...base, presupuestoUsd: topes.presupuestoUsd }).includes('--max-budget-usd'));
  assert.ok(!armarArgumentos({ ...base, presupuestoUsd: null }).includes('--max-budget-usd'));
  const con = armarArgumentos({ ...base, presupuestoUsd: 3 });
  assert.equal(con[con.indexOf('--max-budget-usd') + 1], '3');
});

// ---------- Piezas puras ----------

test('acumularEvento: último texto del hilo PRINCIPAL y archivos tocados por Write/Edit', () => {
  let acc = {};
  acc = acumularEvento(acc, { type: 'assistant', message: { content: [{ type: 'text', text: 'Reviso la vista de compras.' }] } });
  acc = acumularEvento(acc, { type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'texto de un subagente' }, { type: 'tool_use', name: 'Write', input: { file_path: '/h/trabajo/sub.md' } }] } });
  acc = acumularEvento(acc, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'trabajo/informe.md' } }] } });
  assert.equal(acc.ultimoTexto, 'Reviso la vista de compras.');
  assert.deepEqual(acc.archivosTocados, ['/h/trabajo/sub.md', 'trabajo/informe.md']);
  assert.equal(acc.ultimaHerramienta, 'Edit');
});

test('textos: aviso breve con una línea de avance, corte útil sin «pregunta más acotada»', () => {
  assert.equal(duracionLegible(10 * 60000), '10 min');
  assert.equal(duracionLegible(65 * 60000), '1 h 5 min');
  assert.equal(lineaCorta('Primero.\n\nAhora `armo` el **informe** de compras.'), 'Ahora armo el informe de compras.');

  const aviso = textoAvisoProgreso({ transcurridoMs: 10 * 60000, topeMs: 60 * 60000, actividad: 'Consultando SAP…', ultimoTexto: 'Cruzo las órdenes con las facturas.' });
  assert.match(aviso, /^⏳ Sigo trabajando en su pedido \(lleva 10 min; el máximo por turno es 1 h\)\. Le aviso al terminar\./);
  assert.match(aviso, /_Lo último: «Cruzo las órdenes con las facturas\.»_/);
  assert.match(textoAvisoProgreso({ transcurridoMs: 20 * 60000, actividad: 'Consultando SAP…' }), /_Ahora: Consultando SAP…_/);
  assert.equal(textoAvisoProgreso({ transcurridoMs: 60000, actividad: 'Pensando…' }).split('\n').length, 1);

  const corte = textoCorte({ motivo: 'tiempo', transcurridoMs: 60 * 60000, topeMs: 60 * 60000, ultimoTexto: 'Ya armé el borrador.', archivos: ['trabajo/a.md', 'trabajo/b.csv'] });
  assert.match(corte, /Se cumplió el tiempo máximo de este turno \(1 h\)/);
  assert.match(corte, /Último avance: «Ya armé el borrador\.»/);
  assert.match(corte, /`trabajo\/a\.md`, `trabajo\/b\.csv`/);
  assert.match(corte, /la sesión de esta conversación lo conserva/);
  assert.match(corte, /\*\*«continúa»\*\*/);
  assert.doesNotMatch(corte, /acotada/);
  assert.match(textoCorte({ motivo: 'tiempo', transcurridoMs: 1, topeMs: 60000 }), /No alcancé a dejar texto ni archivos visibles/);
  assert.match(textoCorte({ motivo: 'gasto', transcurridoMs: 120000, presupuestoUsd: 3 }), /tope de gasto de este pedido \(3 USD\)/);
  const muchos = textoCorte({ motivo: 'tiempo', transcurridoMs: 1, topeMs: 1, archivos: Array.from({ length: 13 }, (_, i) => `trabajo/f${i}.md`) });
  assert.match(muchos, /y 3 más/);
  assert.match(textoTiempoTurno({ topeMs: 3600000, avisoMs: 600000 }), /máximo de 1 h[\s\S]*cada 10 min[\s\S]*«continúa»/);
});

test('archivos del turno: solo lo modificado desde el inicio, sin ocultos ni propuestas, y lo tocado dentro del hilo', () => {
  const cwd = tmp('hilo-');
  const trabajo = path.join(cwd, 'trabajo');
  mkdirSync(path.join(trabajo, 'salida'), { recursive: true });
  writeFileSync(path.join(trabajo, 'viejo.md'), 'x');
  const antes = Date.now() / 1000 - 3600;
  utimesSync(path.join(trabajo, 'viejo.md'), antes, antes);
  writeFileSync(path.join(trabajo, 'salida', 'nuevo.csv'), 'x');
  writeFileSync(path.join(trabajo, '.oculto'), 'x');
  writeFileSync(path.join(trabajo, 'propuestas-cronograma.json'), '[]');
  const desde = Date.now() - 60_000;
  const esc = archivosModificadosDesde(trabajo, desde, { base: cwd, excluir: ['propuestas-cronograma.json'] });
  assert.deepEqual(esc, [path.join('trabajo', 'salida', 'nuevo.csv')]);
  const todos = archivosDelTurno({ cwd, escaneados: esc, tocados: [path.join(cwd, 'codigo', 'repo', 'a.ts'), '/etc/passwd', path.join(cwd, '.puente', 'x')] });
  assert.deepEqual(todos, [path.join('codigo', 'repo', 'a.ts'), path.join('trabajo', 'salida', 'nuevo.csv')]);
});

test('supervisor con temporizador simulado: avisa cada intervalo, late el indicador y se detiene', async () => {
  const programados = [];
  let t = 0;
  const avisos = [];
  let latidos = 0;
  const sup = crearSupervisor({
    intervaloAvisoMs: 600_000,
    latidoMs: 180_000,
    ahora: () => t,
    programar: (fn, ms) => (programados.push({ fn, ms, activo: true }), programados.length - 1),
    cancelar: (i) => (programados[i].activo = false),
    alAviso: async (ms) => avisos.push(ms),
    alLatido: async () => (latidos += 1),
  });
  assert.deepEqual(programados.map((p) => p.ms), [600_000, 180_000]);
  t = 600_000;
  programados[0].fn();
  programados[1].fn();
  t = 1_200_000;
  programados[0].fn();
  await sup.detener();
  assert.deepEqual(avisos, [600_000, 1_200_000]);
  assert.equal(latidos, 1);
  assert.ok(programados.every((p) => !p.activo));
  programados[0].fn(); // tras detener: no hace nada
  await new Promise((r) => setImmediate(r));
  assert.equal(avisos.length, 2);
});

// ---------- El puente de punta a punta (temporizador simulado de Node) ----------

function synerlinkFalso() {
  const llamadas = [];
  return {
    llamadas,
    estado: async (...a) => llamadas.push(['estado', ...a]),
    contexto: async (id) => ({
      project: { idProject: 3, name: 'SGD', company: { companyName: 'GSS' }, profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v1', files: [] },
      conversation: { id, title: 'x' },
    }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    avisar: async (...a) => llamadas.push(['avisar', ...a]),
    consumo: async (r) => llamadas.push(['consumo', r]),
    confirmar: async (ids) => llamadas.push(['confirmar', ids]),
    descargar: async () => Buffer.from(''),
  };
}

function cfgBase(dir, extra = {}) {
  return {
    hilosDir: dir, agente: 'horus', agenteNombre: 'Orus', maxConcurrencia: 1, timeoutTurnoMs: 60 * 60 * 1000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
    avisoProgresoMs: 10 * 60 * 1000, sinTopeGasto: true, presupuestoUsd: null, ...extra,
  };
}

const vueltas = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

test('turno largo: aviso de progreso a los 10 y 20 min SIN apagar el indicador; la respuesta final sale aparte', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() });
  const dir = tmp('puente-prog-');
  const s = synerlinkFalso();
  let arrancar;
  const arranco = new Promise((r) => (arrancar = r));
  let terminar;
  const corridas = [];
  const puente = crearPuente({
    cfg: cfgBase(dir),
    synerlink: s,
    estado: new Estado(dir),
    correr: (opts) => {
      corridas.push(opts);
      // El modelo escribe un texto y usa una herramienta: eso alimenta el aviso.
      opts.alEvento({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reviso las 40 solicitudes de compra.' }, { type: 'tool_use', name: 'Read', input: {} }] } }, acumularEvento({}, { type: 'assistant', message: { content: [{ type: 'text', text: 'Reviso las 40 solicitudes de compra.' }, { type: 'tool_use', name: 'Read', input: {} }] } }));
      arrancar();
      return new Promise((r) => (terminar = r));
    },
  });
  puente.recibir([{ id: 1, idConversation: 129, body: 'haga el análisis completo', author: { kind: 'user', name: 'Ana', email: 'ana@gsslatam.com' }, conversation: { kind: 'project' } }]);
  await arranco;
  t.mock.timers.tick(10 * 60 * 1000);
  await vueltas();
  t.mock.timers.tick(10 * 60 * 1000);
  await vueltas();
  const avisos = s.llamadas.filter((l) => l[0] === 'avisar');
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0][1], 129);
  assert.match(avisos[0][2], /Sigo trabajando en su pedido \(lleva 10 min; el máximo por turno es 1 h\)/);
  assert.match(avisos[0][2], /Lo último: «Reviso las 40 solicitudes de compra\.»/);
  assert.match(avisos[1][2], /lleva 20 min/);
  // El aviso deja el indicador «trabajando» (nunca idle) con la etiqueta del momento.
  assert.equal(avisos[0][3], 'tool');
  assert.equal(avisos[0][4], 'Leyendo archivos del proyecto…');
  // El latido (cada 3 min) también refrescó el indicador sin apagarlo.
  const latidos = s.llamadas.filter((l) => l[0] === 'estado' && l[2] === 'tool' && l[3] === 'Leyendo archivos del proyecto…');
  assert.ok(latidos.length >= 6, `latidos: ${latidos.length}`);
  assert.ok(!s.llamadas.some((l) => l[0] === 'estado' && l[2] === 'idle'), 'nada lo dejó en reposo mientras trabajaba');
  assert.ok(!s.llamadas.some((l) => l[0] === 'responder'), 'el aviso no reemplaza la respuesta final');

  terminar({ resultado: { ok: true, texto: 'Listo: el análisis completo.' }, sessionId: 's', tokens: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 }, modelos: ['m'], apiMessages: 1, costoUsd: 7.5 });
  await puente.cola.vacia();
  // Sin tope de gasto: el turno no llevó --max-budget-usd, y el costo quedó registrado.
  assert.ok(!corridas[0].args.includes('--max-budget-usd'));
  assert.equal(s.llamadas.find((l) => l[0] === 'responder')[2], 'Listo: el análisis completo.');
  assert.deepEqual(s.llamadas.at(-1).slice(0, 3), ['estado', 129, 'idle']);
  // Después de la respuesta, ningún aviso ni latido más.
  const n = s.llamadas.length;
  t.mock.timers.tick(30 * 60 * 1000);
  await vueltas();
  assert.equal(s.llamadas.length, n);
});

test('tiempo agotado: mensaje con lo que alcanzó a hacer y «continúa»; la sesión queda para --resume', async () => {
  const dir = tmp('puente-corte-');
  const s = synerlinkFalso();
  const estado = new Estado(dir);
  const corridas = [];
  const puente = crearPuente({
    cfg: cfgBase(dir, { avisoProgresoMs: 0 }),
    synerlink: s,
    estado,
    correr: async (opts) => {
      corridas.push(opts);
      writeFileSync(path.join(opts.cwd, 'trabajo', 'borrador-sgd.md'), '# borrador');
      const ev = { type: 'assistant', message: { content: [{ type: 'text', text: 'Ya tengo el borrador de la matriz; sigo con los anexos.' }] } };
      opts.alEvento(ev, acumularEvento({}, ev));
      return { abortado: 'tiempo agotado', init: { session_id: 'x' }, codigo: null, stderr: '' };
    },
  });
  puente.recibir([{ id: 1, idConversation: 129, body: 'arme la matriz', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  const cuerpo = s.llamadas.find((l) => l[0] === 'responder')[2];
  assert.match(cuerpo, /Se cumplió el tiempo máximo de este turno \(1 h\)/);
  assert.match(cuerpo, /Último avance: «Ya tengo el borrador de la matriz; sigo con los anexos\.»/);
  assert.match(cuerpo, /`trabajo\/borrador-sgd\.md`/);
  assert.match(cuerpo, /«continúa»/);
  assert.doesNotMatch(cuerpo, /acotada/);
  // Era la PRIMERA vez del hilo (--session-id): igual queda marcada para retomar con --resume.
  assert.ok(corridas[0].args.includes('--session-id'));
  puente.recibir([{ id: 2, idConversation: 129, body: 'continúa', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  const args2 = corridas[1].args;
  assert.equal(args2[args2.indexOf('--resume') + 1], corridas[0].args[corridas[0].args.indexOf('--session-id') + 1]);
});

test('continuación automática (HILOS_CONTINUAR_AL_AGOTAR=si): una sola vez, sobre la misma sesión, y avisa', async () => {
  const dir = tmp('puente-cont-');
  const s = synerlinkFalso();
  const corridas = [];
  const puente = crearPuente({
    cfg: cfgBase(dir, { avisoProgresoMs: 0, continuarAlAgotar: true }),
    synerlink: s,
    estado: new Estado(dir),
    correr: async (opts) => {
      corridas.push(opts);
      if (corridas.length === 1) return { abortado: 'tiempo agotado', init: {}, codigo: null, stderr: '' };
      return { resultado: { ok: true, texto: 'Terminé en la continuación.' }, sessionId: 's', tokens: null };
    },
  });
  puente.recibir([{ id: 1, idConversation: 7, body: 'tarea grande', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.equal(corridas.length, 2);
  assert.equal(corridas[1].prompt, PROMPT_CONTINUACION);
  const id = corridas[0].args[corridas[0].args.indexOf('--session-id') + 1];
  assert.equal(corridas[1].args[corridas[1].args.indexOf('--resume') + 1], id);
  const aviso = s.llamadas.find((l) => l[0] === 'avisar');
  assert.match(aviso[2], /Continúo automáticamente una vez más/);
  assert.notEqual(aviso[3], 'idle');
  assert.equal(s.llamadas.find((l) => l[0] === 'responder')[2], 'Terminé en la continuación.');

  // Si la continuación también se agota, se rinde con el mensaje de corte (no hay una tercera).
  const s2 = synerlinkFalso();
  const c2 = [];
  const p2 = crearPuente({
    cfg: cfgBase(tmp('puente-cont2-'), { avisoProgresoMs: 0, continuarAlAgotar: true }),
    synerlink: s2,
    estado: new Estado(tmp('estado-')),
    correr: async (opts) => (c2.push(opts), { abortado: 'tiempo agotado', init: {}, codigo: null, stderr: '' }),
  });
  p2.recibir([{ id: 1, idConversation: 8, body: 'x', conversation: { kind: 'project' } }]);
  await p2.cola.vacia();
  assert.equal(c2.length, 2);
  assert.match(s2.llamadas.find((l) => l[0] === 'responder')[2], /también en la continuación automática[\s\S]*«continúa»/);
});

test('sin continuación automática por defecto, y tope de gasto (si se configura) con el mensaje útil', async () => {
  const dir = tmp('puente-gasto-');
  const s = synerlinkFalso();
  const corridas = [];
  const puente = crearPuente({
    cfg: cfgBase(dir, { avisoProgresoMs: 0, sinTopeGasto: false, presupuestoUsd: 2 }),
    synerlink: s,
    estado: new Estado(dir),
    correr: async (opts) => {
      corridas.push(opts);
      return { resultado: { ok: false, texto: '', subtipo: 'error_max_budget_usd' }, sessionId: 's', tokens: null };
    },
  });
  puente.recibir([{ id: 1, idConversation: 123, body: 'x', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.equal(corridas.length, 1);
  assert.equal(corridas[0].args[corridas[0].args.indexOf('--max-budget-usd') + 1], '2');
  const cuerpo = s.llamadas.find((l) => l[0] === 'responder')[2];
  assert.match(cuerpo, /tope de gasto de este pedido \(2 USD\)[\s\S]*«continúa»/);
  assert.doesNotMatch(cuerpo, /acotada/);
});
