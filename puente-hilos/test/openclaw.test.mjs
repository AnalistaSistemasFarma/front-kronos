import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cargarConfig, validarPerfiles } from '../src/config.mjs';
import {
  armarArgumentosOpenclaw,
  armarMensajeOpenclaw,
  claveSesion,
  correrOpenclaw,
  entornoOpenclaw,
  esperarAnuncio,
  leerSalidaOpenclaw,
  recogerOutbox,
  textoEncabezadoOpenclaw,
} from '../src/openclaw.mjs';
import { comandoOpenclaw, crearAtenderOpenclaw } from '../src/atender-openclaw.mjs';
import { crearPuente, verificarOpenclaw } from '../src/puente.mjs';
import { Estado, rutasDelHilo } from '../src/hilos.mjs';
import { anunciosPendientes } from '../src/openclaw/seguimiento.mjs';
import { crearArchivador } from '../src/archivar-proyecto.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'puente-oc-'));

// ── Sesión y argumentos ─────────────────────────────────────────────────────
test('clave de sesión: por conversación y generación; nunca el espacio del chat', () => {
  const k = claveSesion({ prefijo: 'proyecto-pruebas-', idConversation: 48, sessionId: '6e42cdc9-903a-4d3d-86ec-ffab4bab4494' });
  assert.equal(k, 'proyecto-pruebas-c48-6e42cdc9');
  assert.ok(!k.startsWith('synerlink'));
  assert.throws(() => claveSesion({ prefijo: 'p-', idConversation: 0, sessionId: 'abcdef1234' }), /idConversation/);
  assert.throws(() => claveSesion({ prefijo: 'p-', idConversation: 3, sessionId: 'xx' }), /sesión/);
});

test('argumentos: --profile va antes del subcomando; --local y --timeout opcionales; nunca --model ni --thinking', () => {
  const a = armarArgumentosOpenclaw({ perfil: 'lunaris', agente: 'main', clave: 'k', archivoMensaje: '/m.txt', timeoutS: 3720, local: true });
  assert.deepEqual(a.slice(0, 3), ['--profile', 'lunaris', 'agent']);
  assert.ok(a.includes('--local'));
  assert.deepEqual(a.slice(a.indexOf('--timeout'), a.indexOf('--timeout') + 2), ['--timeout', '3720']);
  const b = armarArgumentosOpenclaw({ agente: 'duo', clave: 'proyecto-pruebas-c1-abcdef12', archivoMensaje: '/m.txt' });
  assert.equal(b[0], 'agent');
  assert.ok(!b.includes('--local'));
  for (const x of ['--model', '--thinking', '--deliver', '--channel']) assert.ok(!b.includes(x) && !a.includes(x));
  assert.throws(() => armarArgumentosOpenclaw({ agente: '../x', clave: 'k', archivoMensaje: '/m' }), /agente/);
});

test('entorno de openclaw: sin la llave de SynerLink ni variables del puente', () => {
  const e = entornoOpenclaw({ PATH: '/usr/bin', HOME: '/h', HILOS_SYNERLINK_KEY: 'secreta', SYNERLINK_AGENT_KEY: 'otra', X: '1' }, '/opt/homebrew/bin/openclaw');
  assert.equal(e.HILOS_SYNERLINK_KEY, undefined);
  assert.equal(e.SYNERLINK_AGENT_KEY, undefined);
  assert.equal(e.X, '1');
  assert.ok(e.PATH.startsWith('/opt/homebrew/bin:'));
});

// ── Salida de openclaw ──────────────────────────────────────────────────────
const salidaGateway = {
  runId: 'r1',
  status: 'ok',
  summary: 'completed',
  result: {
    payloads: [{ text: 'Listo.', mediaUrl: '/x/trabajo/a.csv', mediaUrls: ['/x/trabajo/a.csv'] }],
    meta: {
      finalAssistantVisibleText: 'Listo.',
      agentMeta: { sessionId: 's1', provider: 'anthropic', model: 'claude-opus-5-5', usage: { input: 6, output: 407, cacheRead: 25640, cacheWrite: 26158, total: 52211 }, costUsd: 0.144, terminalReceipt: { effective: { provider: 'anthropic', model: 'claude-opus-5-5' }, successfulToolNames: ['read', 'write'] } },
      toolSummary: { calls: 2, tools: ['read', 'write'] },
    },
  },
};

test('salida por el Gateway: texto, medios de payloads como MEDIA:, consumo y modelo', () => {
  const s = leerSalidaOpenclaw(salidaGateway);
  assert.equal(s.ok, true);
  assert.equal(s.texto, 'Listo.\n\nMEDIA:/x/trabajo/a.csv');
  assert.deepEqual(s.tokens, { input: 6, cacheCreation: 26158, cacheRead: 25640, output: 407 });
  assert.deepEqual(s.modelos, ['anthropic/claude-opus-5-5']);
  assert.equal(s.costoUsd, 0.144);
  assert.equal(s.cedio, false);
});

test('salida con --local (sin result) y MEDIA ya presente en el texto: no se duplica', () => {
  const s = leerSalidaOpenclaw({ payloads: [{ text: 'x', mediaUrl: 'trabajo/b.csv' }], meta: { finalAssistantVisibleText: 'Hecho\nMEDIA:trabajo/b.csv' } });
  assert.equal(s.ok, true);
  assert.equal(s.texto, 'Hecho\nMEDIA:trabajo/b.csv');
});

test('salida: status distinto de ok, abortada o vacía → no ok; cedió el turno → cedio', () => {
  assert.equal(leerSalidaOpenclaw({ status: 'error', summary: 'boom' }).ok, false);
  assert.equal(leerSalidaOpenclaw({ status: 'ok', result: { meta: { aborted: true } } }).ok, false);
  assert.equal(leerSalidaOpenclaw(null).ok, false);
  const y = leerSalidaOpenclaw({ status: 'ok', result: { payloads: [], meta: { yielded: true, toolSummary: { tools: ['sessions_spawn', 'sessions_yield'] } } } });
  assert.equal(y.cedio, true);
  assert.equal(y.lanzo, true);
  assert.equal(y.texto, '');
});

// ── Proceso ─────────────────────────────────────────────────────────────────
function hijoFalso({ stdout = '', codigo = 0, demoraMs = 0 } = {}) {
  const h = new EventEmitter();
  h.stdout = new EventEmitter();
  h.stderr = new EventEmitter();
  h.matado = [];
  h.kill = (s) => {
    h.matado.push(s);
    setImmediate(() => h.emit('close', null));
  };
  setTimeout(() => {
    if (h.matado.length) return;
    if (stdout) h.stdout.emit('data', Buffer.from(stdout));
    h.emit('close', codigo);
  }, demoraMs);
  return h;
}

test('correrOpenclaw: devuelve el JSON y no pasa el stdin', async () => {
  let opciones;
  const r = await correrOpenclaw({
    bin: '/oc', args: ['agent'], env: {}, cwd: '/', timeoutMs: 1000,
    spawnImpl: (b, a, o) => { opciones = o; return hijoFalso({ stdout: 'aviso\n' + JSON.stringify(salidaGateway) }); },
  });
  assert.equal(r.codigo, 0);
  assert.equal(r.abortado, null);
  assert.equal(r.salida.status, 'ok');
  assert.equal(opciones.stdio[0], 'ignore');
});

test('correrOpenclaw: al vencer el tope mata el CLI y aborta el turno en el Gateway', async () => {
  let abortos = 0;
  let hijo;
  const r = await correrOpenclaw({
    bin: '/oc', args: [], env: {}, cwd: '/', timeoutMs: 30,
    alAbortar: async () => { abortos += 1; },
    spawnImpl: () => (hijo = hijoFalso({ demoraMs: 10_000 })),
  });
  assert.equal(r.abortado, 'tiempo agotado');
  assert.ok(hijo.matado.includes('SIGTERM'));
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(abortos, 1);
});

test('esperarAnuncio: devuelve el texto del turno announce cuando la sesión ya no corre', async () => {
  let t = 1000;
  const lecturas = [
    { messages: [], activo: true, subagentesActivos: true, runEnCurso: 'x' },
    { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Resultado final' }], __openclaw: { runId: 'announce:requester-settle:1', recordTimestampMs: 2000 } }], activo: false, subagentesActivos: false, runEnCurso: '' },
  ];
  const texto = await esperarAnuncio({ clave: 'agent:duo:k', desdeMs: 1500, hastaMs: 99_999, leer: async () => lecturas.shift(), anunciosPendientes, ahora: () => t, dormir: async (ms) => { t += ms; }, intervaloMs: 10 });
  assert.equal(texto, 'Resultado final');
  const nada = await esperarAnuncio({ clave: 'k', desdeMs: 0, hastaMs: 1050, leer: async () => ({ messages: [], activo: true }), anunciosPendientes, ahora: () => t, dormir: async (ms) => { t += ms || 1; }, intervaloMs: 10 });
  assert.equal(nada, null);
});

// ── Outbox ──────────────────────────────────────────────────────────────────
test('recogerOutbox: copia a ./trabajo lo del outbox; deja igual lo de afuera, los enlaces y los ocultos', () => {
  const d = tmp();
  const outbox = path.join(d, 'ws', 'outbox');
  const trabajo = path.join(d, 'conv', 'trabajo');
  mkdirSync(outbox, { recursive: true });
  mkdirSync(trabajo, { recursive: true });
  writeFileSync(path.join(outbox, 'informe.csv'), 'a;b\n1;2\n');
  writeFileSync(path.join(outbox, '.oculto.csv'), 'x');
  writeFileSync(path.join(d, 'secreto.csv'), 'no');
  symlinkSync(path.join(d, 'secreto.csv'), path.join(outbox, 'enlace.csv'));
  const texto = ['Listo', 'MEDIA:outbox/informe.csv', `MEDIA:${path.join(outbox, 'enlace.csv')}`, 'MEDIA:outbox/.oculto.csv', `MEDIA:${path.join(d, 'secreto.csv')}`, 'MEDIA:outbox/../secreto.csv'].join('\n');
  const r = recogerOutbox(texto, { outbox, trabajo }).split('\n');
  assert.equal(r[1], `MEDIA:${path.join(trabajo, 'outbox', 'informe.csv')}`);
  assert.equal(readFileSync(path.join(trabajo, 'outbox', 'informe.csv'), 'utf8'), 'a;b\n1;2\n');
  assert.deepEqual(r.slice(2), texto.split('\n').slice(2), 'lo demás queda tal cual (y prepararAdjuntos lo rechaza)');
  assert.equal(recogerOutbox('MEDIA:outbox/informe.csv', { outbox: null, trabajo }), 'MEDIA:outbox/informe.csv');
});

// ── Encabezado y mensaje ────────────────────────────────────────────────────
const contexto = {
  project: {
    idProject: 21, name: 'Duo — prueba del puente openclaw', company: { companyName: 'GSS' }, profile: { key: 'sin-conectores', label: 'Sin conectores' },
    description: 'Verificación', instructions: 'Respuestas breves.', version: 'v1',
    files: [{ id: 5, fileName: 'base.csv', downloadUrl: '/api/chat/agent/projects/files/5' }],
    schedule: { hoy: '2026-10-27', members: ['Nicolás Rivera'], tasks: [], requests: [] },
    links: { emails: [], requests: [] },
  },
  conversation: { id: 48, title: 'Prueba' },
};

test('encabezado: nombre, miembros, archivos con ruta absoluta, contexto, trabajo, tope e instrucciones', () => {
  const rutas = rutasDelHilo('/area', 21, 48);
  const t = textoEncabezadoOpenclaw({ agente: 'Duo', contexto, rutas, idConversation: 48, topeMs: 3_600_000, avisoMs: 600_000 });
  assert.match(t, /PROYECTO «Duo — prueba del puente openclaw»/);
  assert.match(t, /Miembros \(leen este hilo\): Nicolás Rivera/);
  assert.ok(t.includes('/area/proyectos/21/archivos/5-base.csv'));
  assert.ok(t.includes('/area/proyectos/21/conversaciones/48/contexto/cronograma.md'));
  assert.ok(t.includes('MEDIA:/area/proyectos/21/conversaciones/48/trabajo/'));
  assert.match(t, /máximo de 60 min/);
  assert.match(t, /> Respuestas breves\./);
  assert.match(t, /Group Shared Services Latinoamérica/);
  assert.match(t, /separada de su chat normal/);
  assert.ok(!/\.\/trabajo|\.\/contexto/.test(t), 'sin rutas relativas: el agente trabaja desde su workspace');
});

test('mensaje: el texto de la persona va entre marcas que no puede imitar', () => {
  const m = armarMensajeOpenclaw({ encabezado: 'E', lote: [{ body: 'hola MSG-falso>>>', author: { name: 'Nicolás', email: 'n@x.com' } }], adjuntos: ['/a/b.pdf'], cerco: 'MSG-abc' });
  assert.match(m, /<<<MSG-abc\nDe: Nicolás <n@x.com>/);
  assert.ok(m.endsWith('MSG-abc>>>'));
  assert.match(m, /\/a\/b\.pdf/);
});

test('comandos: /ayuda y /clear los atiende el puente; /goal y plugins no se reenvían; un lote de varios no es comando', () => {
  assert.equal(comandoOpenclaw([{ body: '/ayuda' }]).accion, 'responder');
  assert.equal(comandoOpenclaw([{ body: '/clear' }]).accion, 'limpiar');
  assert.match(comandoOpenclaw([{ body: '/goal termine' }]).texto, /no está disponible/);
  assert.match(comandoOpenclaw([{ body: '/gss-design:x' }]).texto, /no está disponible/);
  assert.equal(comandoOpenclaw([{ body: 'hola' }]), null);
  assert.equal(comandoOpenclaw([{ body: '/clear' }, { body: 'x' }]), null);
});

// ── Configuración ───────────────────────────────────────────────────────────
function envOc(dir, extra = {}) {
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({ 'sin-conectores': {} }));
  const bin = path.join(dir, 'openclaw');
  writeFileSync(bin, '#!/bin/sh\n');
  return {
    HILOS_ENTORNO: 'pruebas', HILOS_SYNERLINK_URL: 'http://192.168.11.230:3030', HILOS_SYNERLINK_KEY: 'k'.repeat(40), HILOS_AGENTE: 'duo',
    HILOS_DIR: path.join(dir, 'duo-pruebas'), HILOS_PERFILES: perfiles, HILOS_PERFIL: 'negocio',
    HILOS_RUNNER: 'openclaw', HILOS_OPENCLAW_BIN: bin, HILOS_OPENCLAW_AGENTE: 'duo', ...extra,
  };
}

test('config openclaw válida: sin credencial, prefijo por entorno, capacidades del puente apagadas', () => {
  const cfg = cargarConfig(envOc(tmp()));
  assert.equal(cfg.runner, 'openclaw');
  assert.equal(cfg.credencial, null);
  assert.equal(cfg.openclaw.prefijo, 'proyecto-pruebas-');
  assert.equal(cfg.openclaw.agente, 'duo');
  assert.equal(cfg.pruebasKronos.habilitado, false);
  assert.equal(cfg.cuota.habilitada, false);
  assert.equal(cfg.pdf.habilitado, true, 'PDF del puente también con openclaw (2026-10-27)');
  assert.deepEqual(cfg.openclaw.recursos, []);
  assert.equal(cfg.subagentes, false);
  assert.equal(cfg.areaDir, cfg.hilosDir);
  assert.equal(cfg.maxConcurrencia, 2);
});

test('config openclaw: --local fuerza un hilo a la vez; área y outbox absolutos', () => {
  const d = tmp();
  const cfg = cargarConfig(envOc(d, { HILOS_OPENCLAW_LOCAL: 'si', HILOS_OPENCLAW_PERFIL: 'lunaris', HILOS_OPENCLAW_AGENTE: 'main', HILOS_OPENCLAW_OUTBOX: path.join(d, 'ws', 'outbox'), HILOS_OPENCLAW_AREA: path.join(d, 'area') }));
  assert.equal(cfg.maxConcurrencia, 1);
  assert.equal(cfg.openclaw.perfil, 'lunaris');
  assert.equal(cfg.areaDir, path.join(d, 'area'));
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_OPENCLAW_OUTBOX: 'rel/outbox' })), /absoluta/);
});

test('config openclaw: falla cerrado si se intenta sumar capacidades o mezclar sesiones', () => {
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_ANTHROPIC_API_KEY: 'sk' })), /no se define credencial/);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_PERFIL: 'desarrollo' })), /negocio/);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_PERFIL: '' })), /negocio/);
  for (const v of ['HILOS_AUTORES_ORUS_COMPLETO', 'HILOS_MODELO', 'HILOS_MEMORIA_DIR', 'HILOS_PLUGIN_DIRS']) {
    assert.throws(() => cargarConfig(envOc(tmp(), { [v]: v.endsWith('ORUS_COMPLETO') ? 'a@b.co' : v === 'HILOS_MODELO' ? 'opus' : '/abs' })), /no suma capacidades|quite/, v);
  }
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_PRUEBAS_KRONOS: 'si' })), /quedan apagados/);
  assert.doesNotThrow(() => cargarConfig(envOc(tmp(), { HILOS_PDF: 'si' })));
  assert.equal(cargarConfig(envOc(tmp(), { HILOS_PDF: 'no' })).pdf.habilitado, false);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_OPENCLAW_RECURSOS: 'rel/x' })), /absolutas/);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_OPENCLAW_RECURSOS: '/no/existe/gss-design' })), /no existe/);
  assert.doesNotThrow(() => cargarConfig(envOc(tmp(), { HILOS_PRUEBAS_KRONOS: 'no', HILOS_CUOTA: 'no' })));
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_OPENCLAW_SESION_PREFIJO: 'synerlink-testing-' })), /synerlink/);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_OPENCLAW_SESION_PREFIJO: 'proyecto-' })), /entorno/);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_OPENCLAW_AGENTE: '' })), /HILOS_OPENCLAW_AGENTE/);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_OPENCLAW_BIN: '/no/existe/openclaw' })), /no existe/);
  const d = tmp();
  const e = envOc(d);
  writeFileSync(e.HILOS_PERFILES, JSON.stringify({ olp: { mcpServers: { s: { type: 'http', url: 'http://x/mcp' } }, herramientas: ['mcp__s__q'] } }));
  assert.throws(() => cargarConfig(e), /no llevan conectores/);
  assert.throws(() => cargarConfig(envOc(tmp(), { HILOS_RUNNER: 'codex' })), /HILOS_RUNNER/);
});

test('config claude: sin HILOS_RUNNER todo sigue igual (exige credencial)', () => {
  const d = tmp();
  const e = envOc(d, { HILOS_RUNNER: '' });
  assert.throws(() => cargarConfig(e), /EXACTAMENTE una credencial/);
});

test('verificarOpenclaw: exige las banderas que usa el runner', () => {
  assert.throws(() => verificarOpenclaw('/oc', '--agent --session-key --json'), /--message-file/);
  assert.doesNotThrow(() => verificarOpenclaw('/oc', '--agent --session-key --json --timeout --message-file'));
});

// ── Turno completo (con SynerLink y openclaw falsos) ────────────────────────
function synerlinkFalso() {
  const llamadas = [];
  return {
    llamadas,
    estado: async (...a) => llamadas.push(['estado', ...a]),
    avisar: async (...a) => llamadas.push(['avisar', ...a]),
    contexto: async () => contexto,
    responder: async (...a) => llamadas.push(['responder', ...a]),
    responderConArchivos: async (id, body, archivos) => llamadas.push(['responderConArchivos', id, body, archivos.map((x) => x.nombre)]),
    archivarEnProyecto: async (id, archivos) => {
      llamadas.push(['archivar', id, archivos.map((x) => x.nombre)]);
      return { archived: archivos.map((x, i) => ({ id: i + 1, fileName: x.nombre })) };
    },
    proponer: async (id, items) => {
      llamadas.push(['proponer', id, items]);
      return { creadas: items.map((_, i) => i + 1), rechazadas: [] };
    },
    consumo: async (r) => llamadas.push(['consumo', r]),
    confirmar: async (ids) => llamadas.push(['confirmar', ids]),
    entregarSugerencia: async (...a) => llamadas.push(['sugerencia', ...a]),
    descargar: async (u) => Buffer.from(`contenido de ${u}`),
  };
}

function cfgOc(dir, extra = {}) {
  return {
    hilosDir: dir, areaDir: dir, agente: 'duo', agenteNombre: 'Duo', enfoque: null, maxConcurrencia: 2, timeoutTurnoMs: 60_000, avisoProgresoMs: 0,
    perfiles: validarPerfiles({}), runner: 'openclaw', perfilAgente: 'negocio', pdf: { habilitado: false },
    openclaw: { bin: '/opt/homebrew/bin/openclaw', agente: 'duo', perfil: null, local: false, actividad: false, prefijo: 'proyecto-pruebas-', outbox: null, area: dir },
    ...extra,
  };
}

test('turno openclaw: contexto en el mensaje, sesión propia, adjunta + archiva, propuestas, consumo y ack al final', async () => {
  const dir = tmp();
  const s = synerlinkFalso();
  const corridas = [];
  const puente = crearPuente({
    cfg: cfgOc(dir),
    synerlink: s,
    estado: new Estado(dir),
    fabricaOpenclaw: (o) =>
      crearAtenderOpenclaw({
        ...o,
        archivador: o.archivador,
        correr: async (op) => {
          const mensaje = readFileSync(op.args[op.args.indexOf('--message-file') + 1], 'utf8');
          corridas.push({ ...op, mensaje });
          const rutas = rutasDelHilo(dir, 21, 48);
          writeFileSync(path.join(rutas.trabajo, 'resumen.csv'), 'a;b\n1;2\n');
          writeFileSync(rutas.propuestas, JSON.stringify([{ kind: 'tarea_crear', tarea: { title: 'Revisar' } }]));
          return { codigo: 0, abortado: null, stderr: '', salida: { ...salidaGateway, result: { ...salidaGateway.result, payloads: [{ text: 'Listo.', mediaUrl: path.join(rutas.trabajo, 'resumen.csv') }], meta: { ...salidaGateway.result.meta, finalAssistantVisibleText: 'Aquí está el resumen.' } } } };
        },
      }),
  });
  puente.recibir([{ id: 501, idConversation: 48, body: 'Hágame el resumen', author: { name: 'Nicolás Rivera', email: 'nicolas.rivera@gsslatam.com' }, attachments: [{ fileName: 'base.xlsx', downloadUrl: '/api/chat/attachments/9' }], conversation: { kind: 'project' } }]);
  await puente.cola.vacia();

  assert.equal(corridas.length, 1);
  const c = corridas[0];
  assert.ok(c.args.includes('--session-key'));
  const clave = c.args[c.args.indexOf('--session-key') + 1];
  assert.match(clave, /^proyecto-pruebas-c48-[0-9a-f]{8}$/);
  assert.equal(c.args[c.args.indexOf('--agent') + 1], 'duo');
  assert.equal(c.timeoutMs, 60_000);
  assert.match(c.mensaje, /PROYECTO «Duo — prueba del puente openclaw»/);
  assert.match(c.mensaje, /Hágame el resumen/);
  assert.ok(c.mensaje.includes(path.join(dir, 'proyectos', '21', 'conversaciones', '48', 'adjuntos', '501-base.xlsx')));
  assert.ok(existsSync(path.join(dir, 'proyectos', '21', 'archivos', '5-base.csv')), 'archivos del proyecto bajados');
  assert.ok(existsSync(path.join(dir, 'proyectos', '21', 'conversaciones', '48', 'contexto', 'cronograma.md')));
  assert.ok(!existsSync(path.join(dir, 'proyectos', '21', 'conversaciones', '48', '.puente', 'mcp.json')), 'openclaw no recibe mcp.json');
  assert.equal(c.env.HILOS_SYNERLINK_KEY, undefined);

  const tipos = s.llamadas.map((l) => l[0]);
  const resp = s.llamadas.find((l) => l[0] === 'responderConArchivos');
  assert.ok(resp, 'responde con el adjunto');
  assert.deepEqual(resp[3], ['resumen.csv']);
  assert.match(resp[2], /Aquí está el resumen\./);
  assert.match(resp[2], /📌 Dejé 1 propuesta/);
  assert.match(resp[2], /📁 Quedó archivado/);
  assert.ok(!/MEDIA:/.test(resp[2]));
  assert.deepEqual(s.llamadas.find((l) => l[0] === 'archivar')[2], ['resumen.csv']);
  const consumo = s.llamadas.find((l) => l[0] === 'consumo')[1];
  assert.equal(consumo.idConversation, 48);
  assert.deepEqual(consumo.models, ['anthropic/claude-opus-5-5']);
  assert.ok(tipos.lastIndexOf('confirmar') > tipos.indexOf('responderConArchivos'), 'ack al final');
  assert.deepEqual(s.llamadas.at(-1), ['estado', 48, 'idle', null, []]);
  assert.equal(puente.enProceso.size, 0);
  const local = readFileSync(path.join(dir, 'consumo.jsonl'), 'utf8');
  assert.match(local, /"runner":"openclaw"/);
  assert.ok(!existsSync(c.args[c.args.indexOf('--message-file') + 1]), 'el archivo del mensaje se borra');

  // Segundo turno: MISMA clave (la sesión ya existe). /clear → clave nueva.
  puente.recibir([{ id: 502, idConversation: 48, body: 'sigamos', author: { name: 'N' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.equal(corridas[1].args[corridas[1].args.indexOf('--session-key') + 1], clave);
  puente.recibir([{ id: 503, idConversation: 48, body: '/clear', author: { name: 'N' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.equal(corridas.length, 2, '/clear no corre el modelo');
  puente.recibir([{ id: 504, idConversation: 48, body: 'de nuevo', author: { name: 'N' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.notEqual(corridas[2].args[corridas[2].args.indexOf('--session-key') + 1], clave);
});

test('turno openclaw cortado por tiempo: mensaje de corte, sesión conservada; error sin salida: aviso claro', async () => {
  const dir = tmp();
  const s = synerlinkFalso();
  const estado = new Estado(dir);
  const { atender } = crearAtenderOpenclaw({
    cfg: cfgOc(dir), synerlink: s, estado,
    correr: async () => ({ codigo: null, abortado: 'tiempo agotado', stderr: '', salida: null }),
  });
  await atender('48', [{ id: 1, body: 'tarea larga', author: { name: 'N' } }]);
  const r = s.llamadas.find((l) => l[0] === 'responder');
  assert.match(r[2], /Se cumplió el tiempo máximo/);
  assert.match(r[2], /continúa/);
  assert.equal(estado.sesionDe(48).nueva, false, 'la sesión queda iniciada para «continúa»');

  const s2 = synerlinkFalso();
  const { atender: a2 } = crearAtenderOpenclaw({ cfg: cfgOc(tmp()), synerlink: s2, estado: new Estado(tmp()), correr: async () => ({ codigo: 1, abortado: null, stderr: 'gateway closed', salida: null }) });
  await a2('48', [{ id: 2, body: 'x', author: { name: 'N' } }]);
  assert.match(s2.llamadas.find((l) => l[0] === 'responder')[2], /error del asistente/);
  assert.ok(s2.llamadas.some((l) => l[0] === 'confirmar'));
});

test('turno openclaw que cede el turno: espera el resultado dentro del mismo turno', async () => {
  const dir = tmp();
  const s = synerlinkFalso();
  const { atender } = crearAtenderOpenclaw({
    cfg: cfgOc(dir), synerlink: s, estado: new Estado(dir),
    correr: async () => ({ codigo: 0, abortado: null, stderr: '', salida: { status: 'ok', result: { payloads: [], meta: { yielded: true } } } }),
    leerSesionGateway: async () => ({ messages: [{ role: 'assistant', content: 'Terminé en segundo plano.', __openclaw: { runId: 'announce:x', recordTimestampMs: Date.now() + 1000 } }], activo: false, subagentesActivos: false, runEnCurso: '' }),
    anunciosPendientes,
  });
  await atender('48', [{ id: 1, body: 'investigue', author: { name: 'N' } }]);
  assert.match(s.llamadas.find((l) => l[0] === 'responder')[2], /Terminé en segundo plano\./);
});

test('turno openclaw: perfil de conectores desconocido → no corre; «Sugerir equipo» → error claro', async () => {
  const dir = tmp();
  const s = synerlinkFalso();
  s.contexto = async () => ({ ...contexto, project: { ...contexto.project, profile: { key: 'olp', label: 'OLP' } } });
  let corrio = false;
  const { atender, sugerirEquipo } = crearAtenderOpenclaw({ cfg: cfgOc(dir), synerlink: s, estado: new Estado(dir), correr: async () => { corrio = true; return {}; } });
  await atender('48', [{ id: 1, body: 'x', author: { name: 'N' } }]);
  assert.equal(corrio, false);
  assert.match(s.llamadas.find((l) => l[0] === 'responder')[2], /no está configurado/);
  await sugerirEquipo({ idRequest: 7 });
  assert.match(s.llamadas.find((l) => l[0] === 'sugerencia')[2].error, /openclaw/);
});

test('turno openclaw con PDF: convierte el HTML de ./trabajo (lecturas: hilo + recursos), adjunta el PDF y lo archiva', async () => {
  const dir = tmp();
  const recursos = path.join(dir, 'gss-design', 'recursos');
  mkdirSync(recursos, { recursive: true });
  const s = synerlinkFalso();
  const conversiones = [];
  let encabezado = '';
  const cfg = cfgOc(dir, { pdf: { habilitado: true, timeoutMs: 1000 } });
  cfg.openclaw = { ...cfg.openclaw, recursos: [recursos] };
  const { atender } = crearAtenderOpenclaw({
    cfg, synerlink: s, estado: new Estado(dir), chrome: '/chrome-falso', archivador: crearArchivador({ synerlink: s }),
    convertirPdf: async (o) => { conversiones.push(o); return { ok: true, datos: Buffer.from('%PDF-1.7 prueba'), ms: 5 }; },
    correr: async (op) => {
      encabezado = readFileSync(op.args[op.args.indexOf('--message-file') + 1], 'utf8');
      const rutas = rutasDelHilo(dir, 21, 48);
      writeFileSync(path.join(rutas.trabajo, 'informe.html'), '<html><body>x</body></html>');
      return { codigo: 0, abortado: null, stderr: '', salida: { status: 'ok', result: { payloads: [], meta: { finalAssistantVisibleText: `Le adjunto el informe.\nPDF:${path.join(rutas.trabajo, 'informe.html')}` } } } };
    },
  });
  await atender('48', [{ id: 1, body: 'informe en PDF', author: { name: 'N' } }]);
  assert.match(encabezado, /Documentos en PDF/);
  assert.ok(encabezado.includes(recursos));
  assert.match(encabezado, /Group Shared Services Latinoamérica \(gss-design\)/);
  assert.equal(conversiones.length, 1);
  assert.ok(conversiones[0].lecturas.includes(recursos));
  assert.equal(conversiones[0].chrome, '/chrome-falso');
  const r = s.llamadas.find((l) => l[0] === 'responderConArchivos');
  assert.deepEqual(r[3], ['informe.pdf']);
  assert.ok(!/PDF:|MEDIA:/.test(r[2]));
  assert.deepEqual(s.llamadas.find((l) => l[0] === 'archivar')[2], ['informe.pdf']);
});

test('turno openclaw con PDF sin Chrome: el encabezado lo dice y no se convierte', async () => {
  const dir = tmp();
  const s = synerlinkFalso();
  let encabezado = '';
  const { atender } = crearAtenderOpenclaw({
    cfg: cfgOc(dir, { pdf: { habilitado: true } }), synerlink: s, estado: new Estado(dir), chrome: null,
    correr: async (op) => { encabezado = readFileSync(op.args[op.args.indexOf('--message-file') + 1], 'utf8'); return { codigo: 0, abortado: null, stderr: '', salida: { status: 'ok', result: { payloads: [{ text: 'ok' }], meta: {} } } }; },
  });
  await atender('48', [{ id: 1, body: 'x', author: { name: 'N' } }]);
  assert.match(encabezado, /no puede convertir HTML a PDF/);
});
