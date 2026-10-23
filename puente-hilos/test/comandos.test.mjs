import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analizarComando,
  catalogoPlugins,
  encabezadoObjetivo,
  estadoObjetivoSesion,
  neutralizarEjecucion,
  resolverComando,
  rutaTranscripcion,
  skillsDePlugins,
  textoAyuda,
  textoObjetivo,
} from '../src/comandos.mjs';
import { armarArgumentos, correrTurno, esRevisionObjetivo } from '../src/claude.mjs';
import { Estado } from '../src/hilos.mjs';
import { crearPuente, loteDeOperador } from '../src/puente.mjs';
import { validarPerfiles } from '../src/config.mjs';
import { limpiarFrontmatter, sanearSkillMd } from '../scripts/plugin-skills-orus.mjs';

const msj = (body, extra = {}) => ({ id: 1, idConversation: 40, body, author: { kind: 'user', name: 'Silvia', email: 'silvia@gsslatam.com' }, conversation: { kind: 'project' }, ...extra });
const CATALOGO = {
  skills: new Map([
    ['gss-design', { plugin: 'gss-design', descripcion: 'Marca GSS.' }],
    ['abogado-del-diablo', { plugin: 'orus', descripcion: 'Critica a fondo.' }],
  ]),
  excluidas: new Map([['cambiar-auth-token', 'opera la infraestructura de los agentes']]),
};

test('analizarComando: solo un mensaje que EMPIEZA por /nombre; una ruta no es comando', () => {
  assert.deepEqual(analizarComando('  /goal  que quede el PDF '), { nombre: 'goal', plugin: null, completo: 'goal', args: 'que quede el PDF' });
  assert.deepEqual(analizarComando('/gss-design:gss-design haga X'), { nombre: 'gss-design', plugin: 'gss-design', completo: 'gss-design:gss-design', args: 'haga X' });
  assert.equal(analizarComando('/Users/horus/x.txt léalo'), null);
  assert.equal(analizarComando('hola /goal x'), null);
  assert.equal(analizarComando('/ hola'), null);
  assert.equal(analizarComando(null), null);
});

test('neutraliza la sintaxis !`comando` (no se ejecuta nada al cargar una skill)', () => {
  assert.equal(neutralizarEjecucion('a !`rm -rf /` b'), 'a ! `rm -rf /` b');
});

test('resolverComando: /ayuda, /clear y mensaje normal', () => {
  assert.equal(resolverComando({ lote: [msj('hola')] }), null);
  const ayuda = resolverComando({ lote: [msj('/ayuda')], catalogo: CATALOGO });
  assert.equal(ayuda.accion, 'responder');
  assert.match(ayuda.texto, /\/goal/);
  assert.match(ayuda.texto, /\/abogado-del-diablo`: Critica a fondo/);
  assert.match(ayuda.texto, /cambiar-auth-token`: opera la infraestructura/);
  assert.equal(resolverComando({ lote: [msj('/comandos')] }).accion, 'responder');
  assert.deepEqual(resolverComando({ lote: [msj('/clear')] }), { accion: 'limpiar' });
  assert.deepEqual(resolverComando({ lote: [msj('/nueva')] }), { accion: 'limpiar' });
});

test('resolverComando: /goal ver, fijar, quitar y tope', () => {
  assert.deepEqual(resolverComando({ lote: [msj('/goal')] }), { accion: 'objetivo-ver' });
  assert.deepEqual(resolverComando({ lote: [msj('/goal clear')] }), { accion: 'nativo', nombre: 'goal', prompt: '/goal clear', objetivo: { quitar: true } });
  assert.equal(resolverComando({ lote: [msj('/goal quitar')] }).objetivo.quitar, true);
  const f = resolverComando({ lote: [msj('/goal el informe\n queda en PDF !`curl x`')] });
  assert.equal(f.accion, 'nativo');
  assert.equal(f.prompt, '/goal el informe queda en PDF ! `curl x`');
  assert.equal(f.objetivo.fijar, 'el informe queda en PDF ! `curl x`');
  assert.match(resolverComando({ lote: [msj(`/goal ${'x'.repeat(2100)}`)] }).texto, /muy larga/);
});

test('resolverComando: integrados nativos, solo operadores y no disponibles', () => {
  assert.deepEqual(resolverComando({ lote: [msj('/compact deje lo de SAP')] }), { accion: 'nativo', nombre: 'compact', prompt: '/compact deje lo de SAP' });
  assert.equal(resolverComando({ lote: [msj('/context')] }).prompt, '/context');
  const usage = resolverComando({ lote: [msj('/usage')] });
  assert.equal(usage.accion, 'responder');
  assert.match(usage.texto, /no está disponible en los hilos de proyecto porque muestra costos/);
  assert.equal(resolverComando({ lote: [msj('/usage')], operador: true }).prompt, '/usage');
  for (const c of ['/model opus', '/config', '/login', '/resume', '/permissions', '/mcp', '/init', '/schedule a diario', '/loop 5m x', '/engram:memory', '/telegram:access']) {
    const r = resolverComando({ lote: [msj(c)] });
    assert.equal(r.accion, 'responder', c);
    assert.match(r.texto, /no está disponible en los hilos de proyecto porque/, c);
  }
});

test('resolverComando: skills de plugins (con o sin prefijo), incluidas, excluidas y desconocidas', () => {
  assert.equal(resolverComando({ lote: [msj('/gss-design haga la portada')], catalogo: CATALOGO }).prompt, '/gss-design:gss-design haga la portada');
  assert.equal(resolverComando({ lote: [msj('/orus:abogado-del-diablo mi plan')], catalogo: CATALOGO }).prompt, '/orus:abogado-del-diablo mi plan');
  // El prefijo de OTRO plugin no vale.
  assert.equal(resolverComando({ lote: [msj('/otro:abogado-del-diablo x')], catalogo: CATALOGO }).accion, 'responder');
  // Los adjuntos del mensaje van en los argumentos de la skill.
  const conAdj = resolverComando({ lote: [msj('/abogado-del-diablo revise')], catalogo: CATALOGO, adjuntos: ['./adjuntos/1-plan.pdf'] });
  assert.match(conAdj.prompt, /^\/orus:abogado-del-diablo revise\n\nAdjuntos de este mensaje \(léalos con Read\): \.\/adjuntos\/1-plan\.pdf$/);
  assert.equal(resolverComando({ lote: [msj('/dataviz')] }).prompt, '/dataviz');
  const excl = resolverComando({ lote: [msj('/cambiar-auth-token')], catalogo: CATALOGO });
  assert.match(excl.texto, /\/cambiar-auth-token\*\* no está disponible en los hilos de proyecto porque opera la infraestructura/);
  assert.match(resolverComando({ lote: [msj('/inventado')], catalogo: CATALOGO }).texto, /No reconozco el comando/);
});

test('resolverComando: un comando junto con otros mensajes no se ejecuta (nota y turno normal)', () => {
  const r = resolverComando({ lote: [msj('hola'), msj('/goal algo', { id: 2 })] });
  assert.equal(r.accion, 'aviso');
  assert.match(r.texto, /\/goal llegó junto con otros mensajes/);
});

test('catalogoPlugins y skillsDePlugins leen las skills y excluidas.json de los plugins', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plug-'));
  const p = path.join(dir, 'orus');
  mkdirSync(path.join(p, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'orus' }));
  mkdirSync(path.join(p, 'skills', 'informe-x'), { recursive: true });
  writeFileSync(path.join(p, 'skills', 'informe-x', 'SKILL.md'), '---\nname: informe-x\ndescription: >-\n  Genera el informe X. Con detalles\n  largos.\n---\nCuerpo');
  writeFileSync(path.join(p, 'excluidas.json'), JSON.stringify([{ nombre: 'cambiar-auth-token', motivo: 'infra' }]));
  const c = catalogoPlugins([p]);
  assert.deepEqual(c.skills.get('informe-x'), { plugin: 'orus', descripcion: 'Genera el informe X.' });
  assert.equal(c.excluidas.get('cambiar-auth-token'), 'infra');
  assert.deepEqual(skillsDePlugins([p, path.join(dir, 'no-existe')]), [path.join(p, 'skills')]);
});

test('objetivo: textos del encabezado y lectura de goal_status en la transcripción', () => {
  const o = { condicion: 'quede el PDF', autor: 'Silvia', fijado: '2026-10-22T16:00:00Z' };
  assert.match(textoObjetivo(o), /Objetivo activo[\s\S]*Silvia el 2026-10-22: «quede el PDF»/);
  assert.equal(textoObjetivo(null), '');
  assert.match(encabezadoObjetivo(o), /^🎯 Objetivo activo de esta conversación \(\/goal\): «quede el PDF»/);
  const lineas = (...a) => a.map((x) => JSON.stringify({ type: 'attachment', attachment: { type: 'goal_status', ...x } })).join('\n');
  assert.deepEqual(estadoObjetivoSesion('x', () => lineas({ met: false, sentinel: true, condition: 'c' }, { met: true, condition: 'c', reason: 'ok' })), { met: true, fallido: false, condicion: 'c', motivo: 'ok' });
  assert.equal(estadoObjetivoSesion('x', () => lineas({ met: false, failed: true, condition: 'c' })).fallido, true);
  assert.equal(estadoObjetivoSesion('x', () => '{"type":"user"}'), null);
  assert.equal(estadoObjetivoSesion(null), null);
  assert.equal(estadoObjetivoSesion('x', () => { throw new Error('no'); }), null);
});

test('rutaTranscripcion: la ruta de Claude Code y, si no está, la busca por id', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cfg-'));
  const id = '11111111-2222-3333-4444-555555555555';
  const cwd = '/Users/horus/.puente-hilos/x/proyectos/7/conversaciones/40';
  mkdirSync(path.join(dir, 'projects', '-Users-horus--puente-hilos-x-proyectos-7-conversaciones-40'), { recursive: true });
  writeFileSync(path.join(dir, 'projects', '-Users-horus--puente-hilos-x-proyectos-7-conversaciones-40', `${id}.jsonl`), '');
  assert.equal(rutaTranscripcion(dir, cwd, id), path.join(dir, 'projects', '-Users-horus--puente-hilos-x-proyectos-7-conversaciones-40', `${id}.jsonl`));
  mkdirSync(path.join(dir, 'projects', 'acortada-123'), { recursive: true });
  const id2 = '99999999-2222-3333-4444-555555555555';
  writeFileSync(path.join(dir, 'projects', 'acortada-123', `${id2}.jsonl`), '');
  assert.equal(rutaTranscripcion(dir, '/otra/ruta', id2), path.join(dir, 'projects', 'acortada-123', `${id2}.jsonl`));
  assert.equal(rutaTranscripcion(dir, cwd, '00000000-0000-0000-0000-000000000000'), null);
});

test('armarArgumentos: hooks SOLO en turnos con objetivo, y sin ningún hook propio', () => {
  const base = { perfil: { mcpServers: {}, herramientas: [], web: false }, sesion: { id: '11111111-2222-3333-4444-555555555555', nueva: true }, rutaMcp: '/m', rutaSistema: '/s' };
  const settings = (a) => JSON.parse(a[a.indexOf('--settings') + 1]);
  assert.equal(settings(armarArgumentos(base)).disableAllHooks, true);
  const con = settings(armarArgumentos({ ...base, objetivo: true }));
  assert.equal(con.disableAllHooks, false);
  assert.deepEqual(con.hooks, {});
  assert.equal(con.permissions.disableBypassPermissionsMode, 'disable');
  assert.equal(con.enabledPlugins['telegram@claude-plugins-official'], false);
});

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

test('correrTurno: el evaluador de /goal no hace girar el turno sin fin', async () => {
  const fb = { type: 'user', message: { role: 'user', content: 'Stop hook feedback: [x]: insufficient evidence' } };
  assert.equal(esRevisionObjetivo(fb), true);
  assert.equal(esRevisionObjetivo({ ...fb, parent_tool_use_id: 't' }), false);
  assert.equal(esRevisionObjetivo({ type: 'user', message: { content: [{ type: 'text', text: 'Stop hook feedback: y' }] } }), true);
  assert.equal(esRevisionObjetivo({ type: 'user', message: { content: 'hola' } }), false);
  const init = { type: 'system', subtype: 'init', tools: ['Read'], permissionMode: 'dontAsk', mcp_servers: [] };
  let hijo;
  const r = await correrTurno({
    bin: 'claude', args: [], env: {}, cwd: '/', prompt: 'x', perfil: { mcpServers: {}, herramientas: [] }, timeoutMs: 5000, maxRevisionesObjetivo: 3,
    spawnImpl: () => (hijo = hijoFalso([init, fb, fb, fb], { colgado: true })),
  });
  assert.equal(r.abortado, 'objetivo sin cumplir tras 3 revisiones');
  assert.ok(hijo.matado);
  // Sin objetivo (tope 0), la devolución no corta nada.
  const r2 = await correrTurno({
    bin: 'claude', args: [], env: {}, cwd: '/', prompt: 'x', perfil: { mcpServers: {}, herramientas: [] }, timeoutMs: 5000,
    spawnImpl: () => hijoFalso([init, fb, fb, fb, { type: 'result', subtype: 'success', is_error: false, result: 'ok' }]),
  });
  assert.equal(r2.abortado, null);
});

test('Estado: objetivo por conversación y /clear recuerda la sesión anterior', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'est-'));
  const e = new Estado(dir);
  const s = e.sesionDe(40);
  e.marcarIniciada(40, s.id);
  e.fijarObjetivo(40, 'quede el PDF', 'Silvia');
  assert.equal(new Estado(dir).objetivoDe(40).condicion, 'quede el PDF');
  e.quitarObjetivo(40);
  assert.equal(e.objetivoDe(40), null);
  assert.equal(e.sesionDe(40).id, s.id);
  e.fijarObjetivo(40, 'otro', null);
  e.reiniciarSesion(40);
  assert.equal(e.objetivoDe(40), null);
  assert.equal(e.datos.conversaciones[40].sesionAnterior, s.id);
  assert.notEqual(e.sesionDe(40).id, s.id);
});

test('loteDeOperador: solo si TODOS los mensajes son de operadores; falla cerrado', () => {
  const cfg = { rutaReposPorProyecto: '/x.json' };
  const cargar = () => ({ operadores: ['nicolas.rivera@gsslatam.com'] });
  const nico = { author: { kind: 'user', email: 'Nicolas.Rivera@gsslatam.com' } };
  assert.equal(loteDeOperador(cfg, [nico], cargar), true);
  assert.equal(loteDeOperador(cfg, [nico, msj('x')], cargar), false);
  assert.equal(loteDeOperador({}, [nico], cargar), false);
  assert.equal(loteDeOperador(cfg, [nico], () => { throw new Error('roto'); }), false);
});

test('plugin de skills del Orus: frontmatter con lista blanca y sin ejecución al cargar', () => {
  const md = '---\nname: x\ndescription: >-\n  Hace X.\nallowed-tools:\n  - Bash\n  - Task\nhooks:\n  PreToolUse: []\nmodel: opus\ncontext: fork\nuser-invocable: true\n---\nCorra !`git status` y siga.';
  assert.equal(limpiarFrontmatter(md.split('---\n')[1]).trim(), 'name: x\ndescription: >-\n  Hace X.\nuser-invocable: true');
  const limpio = sanearSkillMd(md);
  assert.doesNotMatch(limpio, /allowed-tools|hooks|model:|context:|Bash|Task/);
  assert.match(limpio, /Corra ! `git status` y siga\./);
});

// ---------- Integración con el puente (turno completo con `correr` falso) ----------

function synerlinkFalso() {
  const llamadas = [];
  return {
    llamadas,
    estado: async (...a) => llamadas.push(['estado', ...a]),
    contexto: async (id) => ({
      project: { idProject: 7, name: 'Comex', company: { companyName: 'OLP' }, profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v1', files: [] },
      conversation: { id, title: 'x' },
    }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    proponer: async () => ({ creadas: [], rechazadas: [] }),
    consumo: async () => {},
    confirmar: async (ids) => llamadas.push(['confirmar', ids]),
    descargar: async () => Buffer.from(''),
  };
}

function puenteDePrueba({ resultado = 'Respuesta', transcripcion = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-cmd-'));
  const cfg = {
    hilosDir: dir, agente: 'horus', agenteNombre: 'Orus', maxConcurrencia: 1, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude', pluginDirs: [],
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
  };
  const s = synerlinkFalso();
  const corridas = [];
  const estado = new Estado(dir);
  const puente = crearPuente({
    cfg, synerlink: s, estado,
    correr: async (opts) => {
      corridas.push(opts);
      // La transcripción que deja Claude Code (para saber si el objetivo se cumplió).
      if (transcripcion) {
        const id = opts.args[opts.args.indexOf(opts.args.includes('--session-id') ? '--session-id' : '--resume') + 1];
        const d = path.join(cfg.configClaudeDir, 'projects', opts.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
        mkdirSync(d, { recursive: true });
        writeFileSync(path.join(d, `${id}.jsonl`), transcripcion());
      }
      return { init: {}, resultado: { ok: true, texto: typeof resultado === 'function' ? resultado(opts) : resultado }, tokens: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 }, modelos: ['m'], apiMessages: 1 };
    },
  });
  const turno = async (body, extra = {}) => {
    puente.recibir([{ ...msj(body), id: Math.floor(Math.random() * 1e9), ...extra }]);
    await puente.cola.vacia();
    return s.llamadas.filter((l) => l[0] === 'responder').at(-1)?.[2];
  };
  return { dir, cfg, s, corridas, estado, turno };
}

test('puente: /ayuda y un comando no disponible se responden SIN correr el modelo', async () => {
  const p = puenteDePrueba();
  assert.match(await p.turno('/ayuda'), /Comandos disponibles en los hilos de proyecto/);
  assert.match(await p.turno('/model opus'), /no está disponible en los hilos de proyecto/);
  assert.equal(p.corridas.length, 0);
  assert.equal(p.s.llamadas.filter((l) => l[0] === 'confirmar').length, 2);
});

test('puente: un mensaje normal sigue igual (sin hooks, con encabezado de autor)', async () => {
  const p = puenteDePrueba();
  await p.turno('hola');
  assert.match(p.corridas[0].prompt, /^\*\*Silvia\*\* escribió:\nhola$/);
  assert.equal(JSON.parse(p.corridas[0].args[p.corridas[0].args.indexOf('--settings') + 1]).disableAllHooks, true);
  assert.equal(p.corridas[0].maxRevisionesObjetivo, 0);
});

test('puente: /goal se guarda por conversación, va en el encabezado de cada turno y se quita al cumplirse', async () => {
  let cumplido = false;
  const p = puenteDePrueba({
    transcripcion: () => JSON.stringify({ type: 'attachment', attachment: { type: 'goal_status', met: cumplido, condition: 'quede el PDF' } }),
  });
  const r1 = await p.turno('/goal quede el PDF');
  const c1 = p.corridas[0];
  assert.equal(c1.prompt, '/goal quede el PDF');
  assert.equal(JSON.parse(c1.args[c1.args.indexOf('--settings') + 1]).disableAllHooks, false);
  assert.equal(c1.maxRevisionesObjetivo, 3);
  assert.match(r1, /Objetivo activo\*\* \(\/goal\): «quede el PDF»/);
  assert.equal(p.estado.objetivoDe(40).condicion, 'quede el PDF');
  assert.match(readFileSync(path.join(c1.cwd, '.puente', 'sistema.md'), 'utf8'), /## Objetivo activo de esta conversación \(\/goal\)/);

  // Siguiente mensaje normal: encabezado con el objetivo, hooks prendidos; el evaluador lo da por cumplido.
  cumplido = true;
  const r2 = await p.turno('ya lo adjunté');
  const c2 = p.corridas[1];
  assert.match(c2.prompt, /^🎯 Objetivo activo de esta conversación \(\/goal\): «quede el PDF»\n\n---\n\n\*\*Silvia\*\* escribió:\nya lo adjunté$/);
  assert.equal(JSON.parse(c2.args[c2.args.indexOf('--settings') + 1]).disableAllHooks, false);
  assert.match(r2, /Objetivo cumplido/);
  assert.equal(p.estado.objetivoDe(40), null);

  // Ya sin objetivo: el turno vuelve a ir sin hooks.
  await p.turno('gracias');
  assert.equal(JSON.parse(p.corridas[2].args[p.corridas[2].args.indexOf('--settings') + 1]).disableAllHooks, true);
  assert.match(await p.turno('/goal'), /no tiene un objetivo activo/);
});

test('puente: /goal clear quita el objetivo y /clear arranca memoria nueva', async () => {
  const p = puenteDePrueba({ transcripcion: () => '' });
  await p.turno('/goal algo');
  assert.ok(p.estado.objetivoDe(40));
  assert.match(await p.turno('/goal clear'), /quité el objetivo/);
  assert.equal(p.corridas.at(-1).prompt, '/goal clear');
  assert.equal(p.estado.objetivoDe(40), null);
  const antes = p.estado.sesionDe(40).id;
  assert.match(await p.turno('/clear'), /memoria nueva/);
  assert.notEqual(p.estado.sesionDe(40).id, antes);
});

test('puente: /compact en un hilo sin conversación no corre; con conversación corre tal cual', async () => {
  const p = puenteDePrueba({ resultado: '' });
  assert.match(await p.turno('/compact'), /todavía no tiene conversación/);
  assert.equal(p.corridas.length, 0);
  await p.turno('hola');
  assert.match(await p.turno('/compact'), /compacté la memoria/);
  assert.equal(p.corridas.at(-1).prompt, '/compact');
});

test('puente: /code-review sin código montado no corre nada', async () => {
  const p = puenteDePrueba();
  assert.match(await p.turno('/code-review'), /necesita el código del proyecto montado/);
  assert.equal(p.corridas.length, 0);
});

test('puente: un comando junto con otro mensaje va como turno normal con una nota', async () => {
  const p = puenteDePrueba({ resultado: 'ok' });
  // Dos mensajes de la misma conversación en el mismo lote.
  p.s.llamadas.length = 0;
  const { corridas } = p;
  const s = p.s;
  const puente = crearPuente({ cfg: p.cfg, synerlink: s, estado: p.estado, correr: async (o) => { corridas.push(o); return { init: {}, resultado: { ok: true, texto: 'ok' } }; } });
  puente.recibir([msj('hola'), { ...msj('/goal algo'), id: 2 }]);
  await puente.cola.vacia();
  assert.equal(corridas.length, 1);
  assert.match(corridas[0].prompt, /Silvia\*\* escribió:\nhola[\s\S]*\/goal algo/);
  assert.match(s.llamadas.find((l) => l[0] === 'responder')[2], /^_Nota: \/goal llegó junto con otros mensajes/);
  assert.equal(p.estado.objetivoDe(40), null);
});
