import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { destinoRefspec, entornoGuardia, repoDeUrl, revisarConfigGit, validarGh, validarGit } from '../src/openclaw/guardia.mjs';
import { instalarGuardia, prepararCodigoOpenclaw, quitarGuardia, textoCodigoOpenclaw, tokenListo } from '../src/openclaw/codigo.mjs';

const RAIZ = '/h/proyectos';
const WT = '/h/proyectos/5/conversaciones/9/codigo/front-kronos';
const REPOS = { 'AnalistaSistemasFarma/front-kronos': { base: 'testing' } };

test('guardia git: subcomandos de trabajo dentro de la raíz; push solo a proyecto/* por origin', () => {
  assert.equal(validarGit(['-C', WT, 'status'], { raiz: RAIZ, cwd: '/' }).ok, true);
  assert.equal(validarGit(['status'], { raiz: RAIZ, cwd: WT }).ok, true);
  assert.equal(validarGit(['-C', WT, 'commit', '-m', 'x'], { raiz: RAIZ, cwd: '/' }).ok, true);
  assert.equal(validarGit(['-C', WT, 'grep', '-i', 'foo'], { raiz: RAIZ, cwd: '/' }).ok, true);
  assert.equal(validarGit(['-C', WT, 'ls-files', '-o'], { raiz: RAIZ, cwd: '/' }).ok, true);
  assert.equal(validarGit(['-C', WT, 'push', '-u', 'origin', 'proyecto/5-c9'], { raiz: RAIZ, cwd: '/' }).ok, true);
  assert.equal(validarGit(['-C', WT, 'push', 'origin', 'HEAD:refs/heads/proyecto/5-c9'], { raiz: RAIZ, cwd: '/' }).ok, true);
  assert.equal(validarGit(['-C', WT, 'push'], { raiz: RAIZ, cwd: '/' }).ok, true, 'sin refspec: lo frena el pre-push');
  // Fuera de la raíz, también con ..
  assert.equal(validarGit(['-C', '/Users/x/otro', 'status'], { raiz: RAIZ, cwd: '/' }).ok, false);
  assert.equal(validarGit(['-C', `${WT}/../../../../../../etc`, 'status'], { raiz: RAIZ, cwd: '/' }).ok, false);
  assert.equal(validarGit(['status'], { raiz: RAIZ, cwd: '/tmp' }).ok, false);
  // Push prohibidos
  for (const a of [
    ['push', 'origin', 'testing'],
    ['push', 'origin', 'HEAD:main'],
    ['push', 'origin', '+proyecto/5-c9'],
    ['push', 'origin', ':proyecto/5-c9'],
    ['push', '--force', 'origin', 'proyecto/5-c9'],
    ['push', '-f', 'origin', 'proyecto/5-c9'],
    ['push', '--force-with-lease', 'origin', 'proyecto/5-c9'],
    ['push', '--delete', 'origin', 'proyecto/5-c9'],
    ['push', '--no-verify', 'origin', 'proyecto/5-c9'],
    ['push', '--mirror'],
    ['push', 'https://evil.example/x.git', 'proyecto/5-c9'],
    ['push', 'origin', 'HEAD:refs/tags/v1'],
  ]) {
    assert.equal(validarGit(['-C', WT, ...a], { raiz: RAIZ, cwd: '/' }).ok, false, a.join(' '));
  }
  // Subcomandos y opciones que ejecutan programas o cambian de repo
  for (const a of [
    ['config', 'core.fsmonitor', 'x'],
    ['remote', 'add', 'x', 'y'],
    ['worktree', 'add', 'x'],
    ['submodule', 'foreach', 'x'],
    ['difftool'],
    ['clone', 'x'],
    ['rebase', '-x', 'sh', 'testing'],
    ['rebase', '--exec=sh', 'testing'],
    ['rebase', '-i', 'testing'],
    ['grep', '-Osh', 'x'],
    ['grep', '--open-files-in-pager=sh', 'x'],
    ['diff', '--ext-diff'],
    ['log', '--output=/tmp/x'],
    ['fetch', '--upload-pack=sh', 'origin'],
    ['fetch', 'https://evil.example/x.git'],
    ['merge', '-s', 'evil', 'x'],
    ['tag', 'v1'],
    ['tag', '-d', 'v1'],
    ['add', '-p'],
  ]) {
    assert.equal(validarGit(['-C', WT, ...a], { raiz: RAIZ, cwd: '/' }).ok, false, a.join(' '));
  }
  for (const g of [['-c', 'core.pager=sh', 'status'], ['--git-dir=/x', 'status'], ['--exec-path=/x', 'status'], ['--work-tree=/x', 'status']]) {
    assert.equal(validarGit(g, { raiz: RAIZ, cwd: WT }).ok, false, g.join(' '));
  }
  assert.equal(validarGit(['-C', WT, 'tag', '-l'], { raiz: RAIZ, cwd: '/' }).ok, true);
  assert.equal(validarGit(['-C', WT, 'branch', '-D', 'vieja'], { raiz: RAIZ, cwd: '/' }).ok, true, 'borrar ramas LOCALES sí');
});

test('guardia: refspecs', () => {
  assert.deepEqual(destinoRefspec('proyecto/a'), { destino: 'proyecto/a' });
  assert.deepEqual(destinoRefspec('HEAD:refs/heads/proyecto/a'), { destino: 'proyecto/a' });
  assert.ok(destinoRefspec('+x').error);
  assert.ok(destinoRefspec(':x').error);
  assert.ok(destinoRefspec('HEAD:refs/tags/x').error);
});

test('guardia gh: PR solo hacia testing; merge, api, auth y workflow run negados', () => {
  const ok = (a, o = {}) => validarGh(a, { repos: REPOS, repoCwd: 'AnalistaSistemasFarma/front-kronos', ...o });
  const c = ok(['pr', 'create', '--base', 'testing', '--title', 't', '--body', 'b']);
  assert.equal(c.ok, true);
  assert.deepEqual(c.args.slice(0, 4), ['pr', 'create', '--repo', 'AnalistaSistemasFarma/front-kronos']);
  assert.equal(ok(['pr', 'create', '-B', 'testing', '--draft', '--title', 't', '--body', 'b']).ok, true);
  assert.equal(ok(['pr', 'create', '--base=testing', '--title', 't', '--body', 'b']).ok, true);
  assert.equal(ok(['pr', 'create', '--title', 't', '--body', 'b']).ok, false, 'sin --base no (gh usaría la rama por defecto: main)');
  assert.equal(ok(['pr', 'create', '--base', 'main', '--title', 't']).ok, false);
  assert.equal(ok(['pr', 'create', '--base', 'testing', '--base', 'main']).ok, false);
  assert.equal(ok(['pr', 'create', '--base', 'testing', '--web']).ok, false);
  assert.equal(ok(['pr', 'edit', '12', '--base', 'main']).ok, false);
  assert.equal(ok(['pr', 'edit', '12', '--title', 'x']).ok, true);
  assert.match(ok(['pr', 'merge', '12', '--merge', '--admin']).motivo, /prohibido/);
  for (const a of [['api', 'repos/x'], ['auth', 'token'], ['workflow', 'run', 'main.yml'], ['repo', 'delete', 'x'], ['secret', 'list'], ['pr', 'close', '1'], ['extension', 'install', 'x'], ['alias', 'set', 'x', 'y']]) {
    assert.equal(ok(a).ok, false, a.join(' '));
  }
  assert.equal(ok(['pr', 'list', '--repo', 'otro/repo']).ok, false);
  assert.equal(validarGh(['pr', 'list'], { repos: REPOS, repoCwd: null }).ok, false, 'sin repo conocido no');
  assert.equal(ok(['pr', 'checks', '12']).ok, true);
  assert.equal(ok(['pr', 'create', '--base', 'testing', '--body-file', '-']).ok, false);
  assert.deepEqual(ok(['pr', 'create', '--base', 'testing', '--body-file', 'cuerpo.md']).archivos, ['cuerpo.md']);
});

test('guardia: la configuración del repo no puede ejecutar programas', () => {
  const base = 'local\tcore.repositoryformatversion=0\nlocal\tremote.origin.url=https://github.com/AnalistaSistemasFarma/front-kronos.git\nlocal\tremote.origin.fetch=+refs/heads/*:refs/remotes/origin/*\nlocal\tcredential.helper=\nglobal\tuser.name=Kepler\ncommand\tcore.hookspath=/x\n';
  assert.equal(revisarConfigGit(base, { repos: Object.keys(REPOS) }), null);
  for (const extra of ['local\tcore.fsmonitor=sh -c x', 'local\talias.st=!sh', 'local\tfilter.x.clean=sh', 'local\tcore.hookspath=/tmp', 'local\tinclude.path=/tmp/x', 'global\tcore.pager=sh', 'local\tcredential.helper=!sh', 'local\tdiff.x.textconv=sh', 'local\tremote.origin.pushurl=https://evil']) {
    assert.ok(revisarConfigGit(base + extra, { repos: Object.keys(REPOS) }), extra);
  }
  assert.ok(revisarConfigGit(base.replace('AnalistaSistemasFarma/front-kronos', 'otro/repo'), { repos: Object.keys(REPOS) }));
  assert.equal(repoDeUrl('https://github.com/AnalistaSistemasFarma/front-kronos.git'), 'AnalistaSistemasFarma/front-kronos');
  assert.equal(repoDeUrl('git@github.com:a/b.git'), null);
});

test('guardia: entorno sin herencia y con la configuración forzada', () => {
  const env = entornoGuardia({ hooks: '/g/hooks', home: '/g/home', ghConfig: '/g/gh' }, 'ghp_x');
  assert.equal(env.GH_TOKEN, 'ghp_x');
  assert.equal(env.HOME, '/g/home');
  const pares = Object.fromEntries(Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [`${env[`GIT_CONFIG_KEY_${i}`]}#${i}`, env[`GIT_CONFIG_VALUE_${i}`]]));
  assert.ok(Object.entries(pares).some(([k, v]) => k.startsWith('core.hooksPath') && v === '/g/hooks'));
  assert.ok(Object.entries(pares).some(([k, v]) => k.startsWith('core.fsmonitor') && v === 'false'));
  assert.equal(entornoGuardia({ hooks: 'h', home: 'h', ghConfig: 'g' }, null).GH_TOKEN, undefined);
});

test('instalarGuardia: todo de solo lectura; el envoltorio ejecuta la guardia y niega fuera de la raíz', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'guardia-'));
  const raiz = path.join(d, 'proyectos');
  mkdirSync(raiz);
  const r = instalarGuardia({ hilosDir: d, raiz, repos: REPOS, tokenArchivo: path.join(d, 'token'), gitBin: 'git', ghBin: 'gh' });
  for (const x of [r.dir, r.bin, r.hooks, r.home, r.ghConfig]) assert.equal(statSync(x).mode & 0o777, 0o555, x);
  assert.equal(statSync(r.conf).mode & 0o777, 0o444);
  assert.equal(statSync(r.script).mode & 0o777, 0o444);
  assert.equal(statSync(r.git).mode & 0o777, 0o555);
  assert.match(readFileSync(path.join(r.hooks, 'pre-push'), 'utf8'), /proyecto\//);
  assert.throws(() => writeFileSync(r.conf, '{}'), /EACCES|EPERM/);
  // Idempotente (reinstalar no falla).
  instalarGuardia({ hilosDir: d, raiz, repos: REPOS, tokenArchivo: path.join(d, 'token'), gitBin: 'git', ghBin: 'gh' });
  const fuera = spawnSync(r.git, ['-C', tmpdir(), 'status'], { encoding: 'utf8' });
  assert.equal(fuera.status, 126);
  assert.match(fuera.stderr, /solo se permite dentro/);
  const merge = spawnSync(r.gh, ['pr', 'merge', '1'], { cwd: raiz, encoding: 'utf8' });
  assert.equal(merge.status, 126);
  assert.match(merge.stderr, /prohibido/);
  quitarGuardia(d);
});

test('código openclaw: worktree vía politica, sin token no hay fetch, encabezado con reglas', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'oc-codigo-'));
  const llamadas = [];
  const json = {
    operadoresPases: [],
    repos: { 'front-kronos': { github: 'AnalistaSistemasFarma/front-kronos', clon: '/c/front-kronos', ramaPruebas: 'testing', ramaProduccion: 'main' } },
    proyectos: { 7: { repos: ['front-kronos'], nivel: 2, pases: false } },
  };
  const r = prepararCodigoOpenclaw({
    cfg: { hilosDir: d, areaDir: d, githubTokenArchivo: null, agente: 'kepler', agenteNombre: 'Kepler' },
    jsonCodigo: json,
    rutas: { cwd: path.join(d, 'proyectos/7/conversaciones/3') },
    idProject: 7,
    idConversation: 3,
    instalar: (o) => {
      llamadas.push(o);
      return { git: '/g/bin/git', gh: '/g/bin/gh', home: '/g/home' };
    },
    preparar: ({ repos, envGit, ejecutarGit }) => {
      assert.equal(envGit.GH_TOKEN, undefined);
      assert.equal(ejecutarGit(['fetch', '--prune', 'origin'], {}), '', 'sin token, fetch se omite');
      return repos.map((x) => ({ ...x, worktree: `/w/${x.nombre}`, rama: 'proyecto/7-c3' }));
    },
  });
  assert.equal(r.tokenListo, false);
  assert.deepEqual(llamadas[0].repos, REPOS);
  assert.equal(llamadas[0].raiz, path.join(d, 'proyectos'));
  assert.match(r.bloque, /proyecto\/7-c3/);
  assert.match(r.bloque, /--base testing/);
  assert.match(r.bloque, /Todavía no hay token/);
  assert.equal(prepararCodigoOpenclaw({ cfg: { hilosDir: d }, jsonCodigo: null }), null);
  assert.doesNotMatch(textoCodigoOpenclaw({ worktrees: [], guardia: { git: 'g', gh: 'h' }, tokenListo: true }), /Todavía no hay token/);
  assert.equal(tokenListo(null), false);
  const t = path.join(d, 'tok');
  writeFileSync(t, 'ghp_' + 'a'.repeat(36), { mode: 0o644 });
  assert.equal(tokenListo(t), false, 'permisos 644 no');
});

import { fueraDeAlcance, globARegex } from '../src/openclaw/guardia.mjs';
import { leerRutasPermitidas } from '../src/openclaw/codigo.mjs';

test('alcance por rutas (Kepler: solo dashboards)', () => {
  const R = ['app/(hub)/process/dashboards/**', 'app/api/dashboards/**', 'lib/dashboards/**', 'components/Header.tsx', 'prisma/manual/*-dashboard-*.sql'];
  assert.deepEqual(
    fueraDeAlcance(['app/(hub)/process/dashboards/page.tsx', 'app/(hub)/process/dashboards/v/x.tsx', 'app/api/dashboards/v/route.ts', 'lib/dashboards/a.ts', 'components/Header.tsx', 'prisma/manual/2026-11-06-dashboard-permisos.sql', ''], R),
    []
  );
  assert.deepEqual(
    fueraDeAlcance(['package.json', 'components/Otro.tsx', 'lib/dashboardsX/a.ts', 'prisma/manual/x.sql', 'prisma/manual/s/a-dashboard-b.sql', 'app/(hub)/process/otro/page.tsx'], R),
    ['package.json', 'components/Otro.tsx', 'lib/dashboardsX/a.ts', 'prisma/manual/x.sql', 'prisma/manual/s/a-dashboard-b.sql', 'app/(hub)/process/otro/page.tsx']
  );
  assert.deepEqual(fueraDeAlcance(['package.json'], null), [], 'sin lista = sin restricción');
  assert.ok(globARegex('a/(b)/*.ts').test('a/(b)/c.ts'));
  assert.equal(leerRutasPermitidas(null), null);
  assert.deepEqual(leerRutasPermitidas('/x', () => JSON.stringify({ rutas: R })), R);
  for (const malo of [{}, { rutas: [] }, { rutas: ['/etc/**'] }, { rutas: ['../x'] }]) assert.throws(() => leerRutasPermitidas('/x', () => JSON.stringify(malo)), /RUTAS_PERMITIDAS/);
  assert.match(textoCodigoOpenclaw({ worktrees: [], guardia: { git: 'g', gh: 'h' }, tokenListo: true, rutasPermitidas: R }), /Alcance.*lib\/dashboards/);
});

import { motivoNoFusionar } from '../src/openclaw/guardia.mjs';
import { leerAlcance } from '../src/openclaw/codigo.mjs';

test('fusión a testing (Kepler): solo `pr merge <n> --merge --admin` y con todas las condiciones', () => {
  const ok = (a, o = {}) => validarGh(a, { repos: REPOS, repoCwd: 'AnalistaSistemasFarma/front-kronos', mergePruebas: true, ...o });
  const v = ok(['pr', 'merge', '12', '--merge', '--admin']);
  assert.equal(v.ok, true);
  assert.deepEqual(v.merge, { numero: 12, base: 'testing' });
  assert.equal(ok(['pr', 'merge', '12', '--admin', '--merge']).ok, true);
  for (const a of [['pr', 'merge', '12', '--merge', '--admin', '--delete-branch'], ['pr', 'merge', '12', '--squash', '--admin'], ['pr', 'merge', '12', '--rebase', '--admin'], ['pr', 'merge', '12', '--merge'], ['pr', 'merge', '--merge', '--admin'], ['pr', 'merge', '12', '--merge', '--admin', '--auto']]) {
    assert.equal(ok(a).ok, false, a.join(' '));
  }
  assert.equal(ok(['pr', 'merge', '12', '--merge', '--admin'], { mergePruebas: false }).ok, false, 'sin la bandera, prohibido');
  assert.equal(ok(['pr', 'merge', '12', '--merge', '--admin'], { repoCwd: null }).ok, false, 'fuera del worktree no');
  const R = ['app/(hub)/process/dashboards/**', 'lib/dashboards/**'];
  const CH = ['Front — tsc, lint, build, tests', 'MCP — build y tests'];
  const verde = [{ name: CH[0], conclusion: 'SUCCESS' }, { name: CH[1], conclusion: 'SUCCESS' }, { name: 'otro', conclusion: 'SKIPPED' }];
  const pr = { state: 'OPEN', baseRefName: 'testing', headRefName: 'proyecto/22-c166', isDraft: false, files: [{ path: 'lib/dashboards/a.ts' }], statusCheckRollup: verde };
  const o = { base: 'testing', rutasPermitidas: R, checksRequeridos: CH };
  assert.equal(motivoNoFusionar(pr, o), null);
  assert.match(motivoNoFusionar({ ...pr, baseRefName: 'main' }, o), /solo se fusiona a testing/);
  assert.match(motivoNoFusionar({ ...pr, headRefName: 'feat/x' }, o), /no es proyecto/);
  assert.match(motivoNoFusionar({ ...pr, isDraft: true }, o), /borrador/);
  assert.match(motivoNoFusionar({ ...pr, files: [{ path: 'lib/dashboards/a.ts' }, { path: 'package.json' }] }, o), /fuera de alcance: package.json/);
  assert.match(motivoNoFusionar({ ...pr, statusCheckRollup: [verde[0]] }, o), /falta el check/);
  assert.match(motivoNoFusionar({ ...pr, statusCheckRollup: [verde[0], { name: CH[1], status: 'IN_PROGRESS', conclusion: '' }] }, o), /no está en verde/);
  assert.match(motivoNoFusionar({ ...pr, state: 'MERGED' }, o), /no está abierto/);
  assert.match(motivoNoFusionar(pr, { ...o, rutasPermitidas: null }), /no hay rutas/);
  assert.deepEqual(leerAlcance('/x', () => JSON.stringify({ rutas: R, mergePruebas: true, checksRequeridos: CH })), { rutas: R, mergePruebas: true, checksRequeridos: CH });
  assert.throws(() => leerAlcance('/x', () => JSON.stringify({ rutas: R, mergePruebas: true })), /exige checksRequeridos/);
  assert.match(textoCodigoOpenclaw({ worktrees: [], guardia: { git: 'g', gh: 'h' }, tokenListo: true, rutasPermitidas: R, mergePruebas: true }), /--merge --admin.*Nicolás Rivera y Horus/s);
});

test('guardia gh: sin esperas bloqueantes (--watch, run watch); la consulta simple sí', () => {
  const o = { repos: REPOS, repoCwd: Object.keys(REPOS)[0] };
  assert.equal(validarGh(['pr', 'checks', '932'], o).ok, true);
  for (const a of [['pr', 'checks', '932', '--watch'], ['pr', 'checks', '932', '--watch', '--interval', '25'], ['pr', 'checks', '932', '--watch=true'], ['run', 'watch', '123']]) {
    const v = validarGh(a, o);
    assert.equal(v.ok, false, a.join(' '));
    assert.match(v.motivo, /sin --watch/);
  }
});
