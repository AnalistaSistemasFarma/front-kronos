import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARACTERES_REF,
  permisosCodigo,
  ramaDeConversacion,
  sandboxCodigo,
  textoCodigo,
  textoPrePush,
  turnoAutorizado,
  validarReposPorProyecto,
} from '../src/codigo.mjs';
import { armarArgumentos, armarEntorno, revisarInit } from '../src/claude.mjs';
import { ocultarSecreto } from '../src/puente.mjs';

const JSON_OK = {
  operadoresPases: ['Nicolas.Rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'],
  repos: {
    sapsend: {
      github: 'gsslatam/sapsend',
      clon: '/h/repos/sapsend',
      ramaPruebas: 'testing',
      ramaProduccion: 'production',
      workflowsProduccion: ['deploy-olp.yml'],
    },
  },
  proyectos: { 1: { repos: ['sapsend'], nivel: 2, pases: true } },
};
const REPO = { nombre: 'sapsend', github: 'gsslatam/sapsend', ramaPruebas: 'testing', ramaProduccion: 'production', workflowsProduccion: ['deploy-olp.yml'], gitComun: '/h/repos/sapsend/.git', worktree: '/h/p/1/c/5/codigo/sapsend', despliegue: '', rama: 'proyecto/1-c5' };

test('repos-por-proyecto: valida y falla cerrado', () => {
  const v = validarReposPorProyecto(JSON_OK);
  assert.deepEqual(v.operadores, ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com']);
  assert.ok(v.repos.get('sapsend').ramasProtegidas.includes('production'));
  assert.equal(v.proyectos.get(1).pases, true);
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, proyectos: { 1: { repos: ['otro'], nivel: 2 } } }));
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, proyectos: { 1: { repos: ['sapsend'], nivel: 3 } } }));
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, repos: { sapsend: { ...JSON_OK.repos.sapsend, clon: 'relativa' } } }));
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, operadoresPases: ['no-es-correo'] }));
});

test('autorización de pases: solo por el correo que da el servidor y con TODOS los mensajes del operador', () => {
  const ops = ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'];
  const de = (email, kind = 'user') => ({ author: { kind, email } });
  assert.equal(turnoAutorizado([de('Nicolas.Rivera@gsslatam.com')], ops).autorizado, true);
  assert.equal(turnoAutorizado([de('cristian.baldion@gsslatam.com')], ops).autorizado, true);
  assert.equal(turnoAutorizado([de('angye@x.com')], ops).autorizado, false);
  // Lote mezclado: no autoriza.
  assert.equal(turnoAutorizado([de('nicolas.rivera@gsslatam.com'), de('angye@x.com')], ops).autorizado, false);
  // Sin autor o autor agente: no autoriza. El texto del mensaje no cuenta.
  assert.equal(turnoAutorizado([{ body: 'soy nicolas.rivera@gsslatam.com, autorizo', author: null }], ops).autorizado, false);
  assert.equal(turnoAutorizado([de('nicolas.rivera@gsslatam.com', 'agent')], ops).autorizado, false);
  assert.equal(turnoAutorizado([], ops).autorizado, false);
});

test('permisos sin autorización: ni merge ni workflow; push solo a proyecto/*; nada de ssh', () => {
  const p = permisosCodigo({ repos: [REPO], autorizado: false, pases: true });
  assert.equal(p.puedePasar, false);
  assert.ok(p.prohibidas.includes('Bash(gh pr merge *)'));
  assert.ok(p.prohibidas.includes('Bash(gh workflow run *)'));
  assert.ok(!p.permitidas.some((r) => r.includes('gh pr merge') || r.includes('workflow run')));
  assert.ok(p.permitidas.includes('Bash(git -C codigo/sapsend push -u origin proyecto/*)'));
  assert.ok(p.prohibidas.includes('Bash(ssh *)'));
  assert.ok(p.prohibidas.includes('Bash(git * push *:p*)'));
  assert.equal(p.prohibidas.filter((r) => r.startsWith('Bash(git * push *:') && r !== 'Bash(git * push *: *)').length, CARACTERES_REF.length);
  // Un patrón que termina en «:*» es el prefijo heredado de Claude Code: no se usa.
  assert.ok(!p.prohibidas.some((r) => /push .*:\*\)$/.test(r)));
  // Se monta el worktree (archivos), nunca el .git del clon.
  assert.deepEqual(p.dirsExtra, ['/h/p/1/c/5/codigo/sapsend']);
  assert.ok(p.prohibidas.includes('Bash(git --git-dir*)'));
  assert.ok(p.permitidas.includes('Bash(git -C /h/p/1/c/5/codigo/sapsend log *)'));
});

test('permisos con autorización: merge y SOLO los workflows de producción declarados; nunca --delete-branch', () => {
  const p = permisosCodigo({ repos: [REPO], autorizado: true, pases: true });
  assert.equal(p.puedePasar, true);
  assert.ok(p.permitidas.includes('Bash(gh pr merge *)'));
  assert.ok(p.permitidas.includes('Bash(gh workflow run deploy-olp.yml --ref production*)'));
  assert.ok(!p.permitidas.some((r) => r.includes('deploy-testing')));
  assert.ok(p.prohibidas.includes('Bash(gh pr merge * --delete-branch*)'));
  // Proyecto sin pases habilitados: aunque escriba Nicolás, no fusiona.
  assert.equal(permisosCodigo({ repos: [REPO], autorizado: true, pases: false }).puedePasar, false);
});

test('sandbox: red solo GitHub/npm, sin secretos, falla si no hay sandbox', () => {
  const s = sandboxCodigo({ worktrees: [REPO], homeReal: '/Users/x', homeCodigo: '/p/home-codigo', hilosDir: '/p', secretos: ['/p/github-token'] });
  assert.equal(s.enabled, true);
  assert.equal(s.failIfUnavailable, true);
  assert.equal(s.allowUnsandboxedCommands, false);
  assert.ok(!s.network.allowedDomains.some((d) => /192\.168|serfarma|localhost/.test(d)));
  for (const r of ['/p/.env', '/p/github-token', '/Users/x/.ssh', '/Users/x/.horus']) assert.ok(s.filesystem.denyRead.includes(r), r);
  assert.ok(s.filesystem.allowWrite.includes('/h/repos/sapsend/.git'));
});

test('argumentos del turno con código: Bash habilitado, sandbox en --settings y --add-dir del .git común', () => {
  const p = permisosCodigo({ repos: [REPO], autorizado: false, pases: true });
  const codigo = { ...p, hooks: hooksCodigo(), sandbox: sandboxCodigo({ worktrees: [REPO], homeReal: '/U', homeCodigo: '/p/hc', hilosDir: '/p' }) };
  const args = armarArgumentos({
    perfil: { mcpServers: {}, herramientas: [], web: false },
    sesion: { id: '11111111-2222-3333-4444-555555555555', nueva: false },
    rutaMcp: '/m',
    rutaSistema: '/s',
    codigo,
  });
  assert.ok(args[args.indexOf('--tools') + 1].split(',').includes('Bash'));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.equal(settings.sandbox.enabled, true);
  assert.ok(args.includes('/h/p/1/c/5/codigo/sapsend'));
  assert.ok(!args.includes('/h/repos/sapsend/.git'));
  assert.ok(args.includes('--restricted'));
  // Sin sandbox no se arma.
  assert.throws(() => armarArgumentos({ perfil: { mcpServers: {}, herramientas: [], web: false }, sesion: { id: '11111111-2222-3333-4444-555555555555', nueva: true }, rutaMcp: '/m', rutaSistema: '/s', codigo: { ...p, sandbox: { enabled: false } } }));
  // init con Bash: aceptado solo con código.
  assert.deepEqual(revisarInit({ tools: ['Bash'], permissionMode: 'dontAsk' }, { mcpServers: {} }, null, codigo), []);
  assert.ok(revisarInit({ tools: ['Bash'], permissionMode: 'dontAsk' }, { mcpServers: {} }).length > 0);
});

test('entorno: GH_TOKEN solo en turnos con código', () => {
  const cfg = { path: '/bin', home: '/U', configClaudeDir: '/c', credencial: { tipo: 'oauth-token', valor: 't' } };
  assert.equal(armarEntorno(cfg).GH_TOKEN, undefined);
  assert.equal(armarEntorno(cfg, null, { GH_TOKEN: 'g', HOME: '/hc' }).GH_TOKEN, 'g');
});

test('hook pre-push, rama de la conversación, texto y ocultar el token', () => {
  assert.match(textoPrePush(), /refs\/heads\/proyecto\/\*/);
  assert.equal(ramaDeConversacion(1, 123), 'proyecto/1-c123');
  const t = textoCodigo({ worktrees: [REPO], autorizado: false, puedePasar: false, autores: ['a@x.com'], operadores: ['nicolas.rivera@gsslatam.com'] });
  assert.match(t, /NO está autorizado/);
  assert.match(textoCodigo({ worktrees: [REPO], autorizado: true, puedePasar: true, autores: ['nicolas.rivera@gsslatam.com'], operadores: ['nicolas.rivera@gsslatam.com'] }), /🚀 PROD/);
  assert.equal(ocultarSecreto('x ghp_ABC y ghp_ABC', 'ghp_ABC'), 'x [token oculto] y [token oculto]');
});

import { armarAgentes, crearVigia } from '../src/equipo.mjs';
import { hooksCodigo } from '../src/codigo.mjs';
import { decidir, esGitLectura } from '../src/hook-subagentes.mjs';

test('subagentes con código: Bash solo para git de lectura y el worktree en su prompt', () => {
  const equipo = { miembros: [{ slug: 'analista-codigo', name: 'Analista', purpose: 'lee', instructions: '', tools: ['archivos'], model: null }] };
  const perfil = { mcpServers: {}, herramientas: [], web: false };
  const p = permisosCodigo({ repos: [REPO], autorizado: true, pases: true });
  const codigo = { ...p, worktrees: [REPO], hooks: hooksCodigo() };
  const a = armarAgentes({ equipo, perfil, agente: 'Orus', proyecto: { name: 'P', company: { companyName: 'GSS' } }, topes: { maxTurnosSubagente: 30 }, codigo })['analista-codigo'];
  assert.ok(a.tools.includes('Bash'));
  assert.ok(!a.disallowedTools.includes('Bash'));
  // Solo nombres de herramienta en disallowedTools (un patrón quitaría la herramienta entera).
  assert.ok(a.disallowedTools.every((t) => !t.includes('(')));
  assert.match(a.prompt, /codigo\/sapsend/);
  // Sin código, nada de Bash.
  const b = armarAgentes({ equipo, perfil, agente: 'Orus', proyecto: { name: 'P', company: { companyName: 'GSS' } }, topes: { maxTurnosSubagente: 30 } })['analista-codigo'];
  assert.ok(!b.tools.includes('Bash'));
  // El vigía acepta Bash en un subagente solo con código.
  const ev = (padre, name) => ({ type: 'assistant', parent_tool_use_id: padre, message: { content: [{ type: 'tool_use', id: 't2', name, input: {} }] } });
  const lanzar = { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'analista-codigo', description: 'x', prompt: 'y' } }] } };
  const v1 = crearVigia({ equipo, perfil, conCodigo: true });
  v1.procesar(lanzar);
  assert.deepEqual(v1.procesar(ev('t1', 'Bash')), []);
  const v2 = crearVigia({ equipo, perfil });
  v2.procesar(lanzar);
  assert.equal(v2.procesar(ev('t1', 'Bash')).length, 1);
});

test('hook de subagentes: solo git de lectura; el principal no se toca', () => {
  for (const c of ['git -C codigo/sapsend log --oneline -5', 'git -C codigo/sapsend ls-files | grep purchase | wc -l', 'git -C /x/codigo/sapsend show HEAD:README.md', 'git -C codigo/sapsend branch -a'])
    assert.equal(esGitLectura(c), true, c);
  for (const c of ['git -C codigo/sapsend commit -m x', 'git -C codigo/sapsend push origin proyecto/x', 'git -C codigo/sapsend log; rm -rf x', 'git -C codigo/sapsend log && npm test', 'cd codigo/sapsend && git log', 'git -C codigo/sapsend branch -D x', 'git -C codigo/sapsend diff --output=/tmp/x', 'git -C codigo/sapsend log | sh', 'node -e 1', 'git -C codigo/sapsend log > /tmp/x', 'git -C codigo/sapsend log $(id)'])
    assert.equal(esGitLectura(c), false, c);
  assert.equal(decidir({ tool_name: 'Bash', tool_input: { command: 'npm test' } }), null);
  assert.equal(decidir({ agent_id: 'a', agent_type: 's', tool_name: 'Bash', tool_input: { command: 'git -C codigo/sapsend log' } }), null);
  assert.equal(decidir({ agent_id: 'a', agent_type: 's', tool_name: 'Bash', tool_input: { command: 'npm test' } }).hookSpecificOutput.permissionDecision, 'deny');
});

test('bajo demanda: menciones con borde de palabra, por nombre o dueño/repo', async () => {
  const { reposMencionados } = await import('../src/codigo.mjs');
  const repos = [
    { nombre: 'sapsend', github: 'gsslatam/sapsend' },
    { nombre: 'sapsendmailer', github: 'NicolasRivera03/sapsendmailer' },
    { nombre: 'front-kronos', github: 'AnalistaSistemasFarma/front-kronos' },
    { nombre: 'mcp-sapbo', github: 'NicolasRivera03/mcp-sapbo' },
  ];
  assert.deepEqual(reposMencionados('Revise SAPSENDMAILER por favor', repos), ['sapsendmailer']);
  assert.deepEqual(reposMencionados('en sapsend, y luego `front-kronos`.', repos), ['sapsend', 'front-kronos']);
  assert.deepEqual(reposMencionados('https://github.com/NicolasRivera03/mcp-sapbo/pull/3', repos), ['mcp-sapbo']);
  assert.deepEqual(reposMencionados('el mcp-sapbo-olp no es un repo', repos), []);
  assert.deepEqual(reposMencionados('front-kronosx no', repos), []);
  assert.deepEqual(reposMencionados('', repos), []);
});

test('bajo demanda: qué se monta en el turno y registro de lo que pide Orus', async () => {
  const { mkdtempSync, mkdirSync: mk, readFileSync: rf } = await import('node:fs');
  const os = await import('node:os');
  const path = (await import('node:path')).default;
  const { reposDelTurno, registrarReposSolicitados, textoIndiceRepos, validarReposPorProyecto: v } = await import('../src/codigo.mjs');
  const base = {
    ...JSON_OK,
    repos: {
      ...JSON_OK.repos,
      'front-kronos': { github: 'AnalistaSistemasFarma/front-kronos', clon: '/h/repos/front-kronos', ramaPruebas: 'testing', ramaProduccion: 'main', descripcion: 'SynerLink' },
      'mcp-sapbo': { github: 'NicolasRivera03/mcp-sapbo', clon: '/h/repos/mcp-sapbo', ramaPruebas: 'main', ramaProduccion: 'main' },
    },
  };
  // Sin bajoDemanda: todos, como antes.
  const todos = v({ ...base, proyectos: { 1: { repos: ['sapsend', 'front-kronos', 'mcp-sapbo'], nivel: 2, pases: true } } });
  assert.equal(todos.proyectos.get(1).bajoDemanda, false);
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'bd-'));
  const rutas = { cwd, puente: path.join(cwd, '.puente') };
  assert.equal(reposDelTurno({ proyecto: todos.proyectos.get(1), repos: todos.repos, lote: [], rutas }).length, 3);
  assert.throws(() => v({ ...base, proyectos: { 1: { repos: ['sapsend'], nivel: 2, bajoDemanda: 'si' } } }));

  const bd = v({ ...base, proyectos: { 1: { repos: ['sapsend', 'front-kronos', 'mcp-sapbo'], nivel: 2, pases: true, bajoDemanda: true } } });
  const p = bd.proyectos.get(1);
  const elegir = (lote) => reposDelTurno({ proyecto: p, repos: bd.repos, lote, rutas }).map((r) => r.nombre);
  // Nada nombrado ni montado: nada.
  assert.deepEqual(elegir([{ body: 'hola, ¿qué tiene disponible?' }]), []);
  // Lo nombra la persona: se monta en ese turno.
  assert.deepEqual(elegir([{ body: 'revise front-kronos' }]), ['front-kronos']);
  // Ya montado en la conversación: sigue montado.
  mk(path.join(cwd, 'codigo', 'sapsend', '.git'), { recursive: true });
  assert.deepEqual(elegir([{ body: 'siga' }]), ['sapsend']);
  // Lo nombra Orus en su respuesta: se monta en el siguiente turno; se acumula; nombres ajenos no.
  const disponibles = p.repos.map((n) => bd.repos.get(n));
  // Nombrarlos en una lista NO los monta; solo la línea «Montar: …».
  assert.deepEqual(registrarReposSolicitados(rutas, '- `sapsend`\n- `front-kronos`\n- `mcp-sapbo`', disponibles), []);
  assert.deepEqual(registrarReposSolicitados(rutas, 'Para seguir:\nMontar: `mcp-sapbo`, otro-repo', disponibles), ['mcp-sapbo']);
  assert.deepEqual(registrarReposSolicitados(rutas, 'No montar nada: front-kronos', disponibles), []);
  assert.deepEqual(registrarReposSolicitados(rutas, 'nada que pedir', disponibles), []);
  assert.deepEqual(JSON.parse(rf(path.join(rutas.puente, 'repos-solicitados.json'), 'utf8')).repos, ['mcp-sapbo']);
  assert.deepEqual(elegir([{ body: 'siga' }]), ['sapsend', 'mcp-sapbo']);
  // Índice: todos los repos, con estado.
  const t = textoIndiceRepos({ disponibles, montados: [{ nombre: 'sapsend' }] });
  assert.match(t, /3 repositorios/);
  assert.match(t, /`sapsend` \| gsslatam\/sapsend \| ✅ montado/);
  assert.match(t, /`front-kronos` \| AnalistaSistemasFarma\/front-kronos \| disponible \(no montado\) \| SynerLink/);
});

test('prepararCodigoTurno bajo demanda: sin repos nombrados va sin código y con índice; con uno, solo ese', async () => {
  const { prepararCodigoTurno } = await import('../src/puente.mjs');
  const { validarReposPorProyecto: v } = await import('../src/codigo.mjs');
  const vinc = v({
    ...JSON_OK,
    repos: { ...JSON_OK.repos, 'front-kronos': { github: 'AnalistaSistemasFarma/front-kronos', clon: '/h/repos/front-kronos', ramaPruebas: 'testing', ramaProduccion: 'main' } },
    proyectos: { 1: { repos: ['sapsend', 'front-kronos'], nivel: 2, pases: true, bajoDemanda: true } },
  });
  const cfg = { rutaReposPorProyecto: '/x.json', githubTokenArchivo: '/t', hilosDir: '/h', home: '/home', path: '/bin' };
  const rutas = { cwd: '/no/existe/c5', puente: '/no/existe/c5/.puente' };
  let montados = null;
  const comun = { cfg, idProject: 1, idConversation: 5, rutas, agenteNombre: 'Orus', cargar: () => vinc, leerToken: () => 'tok', prepararHome: () => '/h/home-codigo' };
  const preparar = ({ repos }) => {
    montados = repos.map((r) => r.nombre);
    return repos.map((r) => ({ ...r, worktree: `/no/existe/c5/codigo/${r.nombre}`, rama: 'proyecto/1-c5', gitComun: `${r.clon}/.git` }));
  };
  const a = prepararCodigoTurno({ ...comun, lote: [{ body: 'hola', author: { kind: 'user', email: 'x@y.com' } }], preparar });
  assert.equal(a.soloIndice, true);
  assert.equal(montados, null);
  assert.match(a.bloque, /disponible \(no montado\)/);
  const b = prepararCodigoTurno({ ...comun, lote: [{ body: 'mire front-kronos', author: { kind: 'user', email: 'x@y.com' } }], preparar });
  assert.deepEqual(montados, ['front-kronos']);
  assert.deepEqual(b.dirsExtra, ['/no/existe/c5/codigo/front-kronos']);
  assert.match(b.bloque, /usted SÍ tiene el código/);
  assert.match(b.bloque, /`front-kronos` \| AnalistaSistemasFarma\/front-kronos \| ✅ montado/);
  assert.match(b.bloque, /`sapsend` \| gsslatam\/sapsend \| disponible/);
});

import { entornoCodigo, estadoDependencias, rutaCacheNpm } from '../src/codigo.mjs';

test('npm en el worktree (2026-10-20): caché compartida, npx sin descargas, Prisma y comandos del hilo principal', () => {
  // Reglas: el hilo principal puede correr npm/npx de pruebas, tipos y lint.
  const p = permisosCodigo({ repos: [REPO], autorizado: false, pases: true });
  for (const r of ['Bash(npm ci)', 'Bash(npm install *)', 'Bash(npm test)', 'Bash(npm run *)', 'Bash(npx vitest *)', 'Bash(npx tsc *)', 'Bash(npx eslint *)', 'Bash(cd codigo/* && npx vitest *)']) {
    assert.ok(p.permitidas.includes(r), r);
  }
  // Las prohibiciones de siempre siguen ganando.
  for (const r of ['Bash(npx -y *)', 'Bash(npm publish *)', 'Bash(npm config *)', 'Bash(curl *)', 'Bash(ssh *)']) assert.ok(p.prohibidas.includes(r), r);
  // Caché de npm compartida dentro de HILOS_DIR, escribible en el sandbox.
  assert.equal(rutaCacheNpm('/p'), '/p/cache-npm');
  const s = sandboxCodigo({ worktrees: [REPO], homeReal: '/U', homeCodigo: '/p/hc', hilosDir: '/p' });
  assert.ok(s.filesystem.allowWrite.includes('/p/cache-npm'));
  assert.ok(s.network.allowedDomains.includes('registry.npmjs.org'));
  assert.ok(s.network.allowedDomains.includes('binaries.prisma.sh'));
  assert.ok(s.filesystem.denyRead.includes('/p/.env'));
  const e = entornoCodigo({ token: 't', homeCodigo: '/p/hc', cacheNpm: '/p/cache-npm' });
  assert.equal(e.NPM_CONFIG_CACHE, '/p/cache-npm');
  assert.equal(e.NPM_CONFIG_YES, 'false'); // npx no baja «tsc@2.0.4» ni otros paquetes ajenos
  assert.equal(e.NPM_CONFIG_PREFER_OFFLINE, 'true');
  assert.equal(e.PUPPETEER_SKIP_DOWNLOAD, '1'); // sin esto `npm ci` de front-kronos fallaba en el sandbox
  // Estado de dependencias y texto del turno.
  assert.equal(estadoDependencias('/w', (r) => r === '/w/package.json'), 'faltan');
  assert.equal(estadoDependencias('/w', () => true), 'instaladas');
  assert.equal(estadoDependencias('/w', () => false), 'sin-package');
  const t = textoCodigo({ worktrees: [{ ...REPO, dependencias: 'faltan' }], autorizado: false, puedePasar: false, autores: ['a@x.com'], operadores: ['nicolas.rivera@gsslatam.com'] });
  assert.match(t, /SÍ puede ejecutar comandos con la herramienta Bash/);
  assert.match(t, /NO le pida a la persona que corra pruebas/);
  assert.match(t, /SIN instalar: antes de probar corra `cd \/h\/p\/1\/c\/5\/codigo\/sapsend && npm ci`/);
  assert.match(textoCodigo({ worktrees: [{ ...REPO, dependencias: 'instaladas' }], autorizado: false, puedePasar: false, autores: [], operadores: ['a@x.com'] }), /node_modules`\) instaladas/);
});

import { sembrarMotoresPrisma } from '../src/codigo.mjs';
import { mkdtempSync, mkdirSync as mk, existsSync as ex, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import pathMod from 'node:path';

test('motores de Prisma: se siembran en el HOME de código solo las versiones que faltan', () => {
  const real = mkdtempSync(pathMod.join(tmpdir(), 'hr-'));
  const hc = mkdtempSync(pathMod.join(tmpdir(), 'hc-'));
  const v1 = 'c0aafc03b8ef6cdced8654b9a817999e02457d6a';
  const dirO = pathMod.join(real, '.cache/prisma/master', v1, 'darwin-arm64');
  mk(dirO, { recursive: true });
  for (const a of ['libquery-engine', 'schema-engine']) writeFileSync(pathMod.join(dirO, a), a);
  mk(pathMod.join(real, '.cache/prisma/master', 'no-es-hash', 'x'), { recursive: true });
  // Carpeta a medias (descarga cortada): solo se completa lo que falta.
  const dirD = pathMod.join(hc, '.cache/prisma/master', v1, 'darwin-arm64');
  mk(dirD, { recursive: true });
  writeFileSync(pathMod.join(dirD, 'libquery-engine'), 'propio');
  assert.deepEqual(sembrarMotoresPrisma(real, hc), ['c0aafc03/darwin-arm64/schema-engine']);
  assert.equal(readFileSync(pathMod.join(dirD, 'libquery-engine'), 'utf8'), 'propio');
  assert.equal(readFileSync(pathMod.join(dirD, 'schema-engine'), 'utf8'), 'schema-engine');
  assert.ok(!ex(pathMod.join(hc, '.cache/prisma/master', 'no-es-hash')));
  assert.deepEqual(sembrarMotoresPrisma(real, hc), []); // idempotente
  assert.deepEqual(sembrarMotoresPrisma(null, hc), []);
});

import { copiarStubsPruebas } from '../src/codigo.mjs';

test('stubsPruebas: valida rutas y copia el stub de CI sin sobrescribir', () => {
  const base = { github: 'a/b', clon: '/h/r/b', ramaPruebas: 'testing', ramaProduccion: 'main' };
  const v = validarReposPorProyecto({ repos: { b: { ...base, stubsPruebas: { 'dbconfig.js': '.github/dbconfig.ci.stub.js' } } }, proyectos: {} });
  assert.deepEqual(v.repos.get('b').stubsPruebas, { 'dbconfig.js': '.github/dbconfig.ci.stub.js' });
  for (const malo of [{ '../x.js': 'a.js' }, { 'x.js': '/etc/passwd' }, { '.env': 'a.js' }, { 'x.js': '.env.production' }, { 'a//b': 'c' }]) {
    assert.throws(() => validarReposPorProyecto({ repos: { b: { ...base, stubsPruebas: malo } }, proyectos: {} }), /stubsPruebas/, JSON.stringify(malo));
  }
  const w = mkdtempSync(pathMod.join(tmpdir(), 'wt-'));
  mk(pathMod.join(w, '.github'));
  writeFileSync(pathMod.join(w, '.github/dbconfig.ci.stub.js'), 'module.exports={}');
  assert.deepEqual(copiarStubsPruebas(w, { 'dbconfig.js': '.github/dbconfig.ci.stub.js', 'no.js': '.github/no-existe.js' }), ['dbconfig.js']);
  assert.equal(readFileSync(pathMod.join(w, 'dbconfig.js'), 'utf8'), 'module.exports={}');
  writeFileSync(pathMod.join(w, 'dbconfig.js'), 'propio');
  assert.deepEqual(copiarStubsPruebas(w, { 'dbconfig.js': '.github/dbconfig.ci.stub.js' }), []);
  assert.equal(readFileSync(pathMod.join(w, 'dbconfig.js'), 'utf8'), 'propio');
  // prisma: solo generate/validate (nada de migrate/db push).
  const p = permisosCodigo({ repos: [REPO], autorizado: false, pases: true });
  assert.ok(p.permitidas.includes('Bash(npx prisma generate *)'));
  assert.ok(!p.permitidas.some((r) => /prisma (migrate|db)/.test(r)));
});
