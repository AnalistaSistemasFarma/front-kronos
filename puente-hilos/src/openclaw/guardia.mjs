#!/usr/bin/env node
/**
 * GUARDIA de git y gh para los agentes de OPENCLAW con código (2026-11-06).
 *
 * Pedido de Nicolás Rivera (2026-11-06 11:36 COT, Kepler): «ponle todo lo necesario para
 * trabajar»: desarrollar en front-kronos, abrir PR SOLO hacia `testing`, sin fusionar ni
 * desplegar. Con Claude Code eso lo hacen el sandbox y las reglas de Bash (codigo.mjs); con
 * openclaw el agente ejecuta por el Gateway, así que la barrera técnica es ESTE archivo:
 *
 *   - openclaw solo le deja ejecutar `<dir>/bin/git` y `<dir>/bin/gh` (exec-approvals.json,
 *     security=allowlist), que llaman aquí con la configuración `guardia.json` de al lado;
 *   - la carpeta es de solo lectura (0555/0444): el agente no puede cambiar ni este archivo
 *     ni la configuración con sus herramientas de archivos.
 *
 * Reglas (todo falla cerrado):
 *   git  solo dentro de la raíz de los hilos (`-C` o la carpeta actual), solo subcomandos de
 *        trabajo, push solo a `origin` y a ramas `proyecto/*` (sin forzar ni borrar), sin `-c`,
 *        `--git-dir`, `--exec-path`…; antes de cada llamada se revisa que la configuración del
 *        repo no traiga nada que ejecute programas (fsmonitor, alias, filtros, hooksPath…).
 *   gh   solo `pr create|view|list|diff|checks|status|comment|edit|ready`, `run list|view`,
 *        `repo view`, `issue view|list`, `workflow list|view`; `pr create` EXIGE `--base` igual
 *        a la rama de pruebas del repo (testing); `pr merge`, `api`, `auth`, `workflow run`… NO.
 *
 * Este archivo se copia tal cual a la carpeta de solo lectura: no importa nada fuera de node:*.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREFIJO_RAMA = 'proyecto/';

/** Subcomandos de git permitidos. */
export const GIT_PERMITIDOS = new Set([
  'status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'grep', 'blame', 'shortlog', 'describe',
  'merge-base', 'cat-file', 'ls-tree', 'checkout', 'switch', 'add', 'commit', 'restore', 'stash', 'fetch', 'pull',
  'merge', 'rebase', 'reset', 'rm', 'mv', 'cherry-pick', 'revert', 'push', 'tag', 'show-ref', 'reflog',
]);

/** Opciones que ejecutan programas, escriben fuera o cambian de repo (en cualquier subcomando). */
const GIT_OPCIONES_PROHIBIDAS = [
  /^--exec(=|$)/, /^--open-files-in-pager/, /^--ext-diff$/, /^--output(=|$)/, /^--upload-pack/, /^--receive-pack/,
  /^--git-dir/, /^--work-tree/, /^--exec-path/, /^--config-env/, /^--template(=|$)/, /^--recurse-submodules/,
  /^--no-verify$/, /^--tool(=|$)/, /^--extcmd/,
];

/** Opciones prohibidas según el subcomando (ejecutan programas o esperan a una persona). */
const INTERACTIVAS = ['-i', '--interactive', '-p', '--patch', '-e', '--edit'];
const GIT_PROHIBIDAS_POR_SUB = {
  rebase: ['-x', '-i', '--interactive', '-s', '--strategy', '--edit-todo'],
  merge: ['-s', '--strategy', '-e', '--edit'],
  pull: ['-s', '--strategy', '-e', '--edit'],
  'cherry-pick': ['-s', '--strategy', '-e', '--edit'],
  revert: ['-s', '--strategy', '-e', '--edit'],
  grep: ['-O'],
  add: INTERACTIVAS,
  commit: ['--interactive', '-p', '--patch', '-e', '--edit'],
  checkout: INTERACTIVAS,
  reset: INTERACTIVAS,
  restore: INTERACTIVAS,
  stash: ['-p', '--patch'],
};

/** Opciones de push permitidas (allowlist; lo demás se niega). */
const PUSH_PERMITIDAS = new Set(['-u', '--set-upstream', '--dry-run', '-n', '--porcelain', '-q', '--quiet', '-v', '--verbose', '--progress', '--no-progress']);

/** Claves de configuración de git aceptadas (lo demás se niega: alias, filtros, fsmonitor, hooksPath…). */
const CONFIG_PERMITIDA = [
  /^core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|safecrlf|quotepath)$/,
  /^remote\.origin\.(fetch|gh-resolved)$/,
  /^branch\.[^\s]+\.(remote|merge|rebase|gh-merge-base|vscode-merge-base)$/,
  /^user\.(name|email)$/,
  /^extensions\.worktreeconfig$/,
  /^(init\.defaultbranch|pull\.rebase|pull\.ff|push\.default|push\.autosetupremote|fetch\.prune|gc\.auto|advice\.[a-z]+|color\.ui|safe\.directory)$/,
];
const AYUDANTE_CREDENCIAL = '!f(){ test -n "$GH_TOKEN" && { echo username=x-access-token; echo "password=$GH_TOKEN"; }; }; f';

/** Subcomandos de gh permitidos («grupo acción»). */
export const GH_PERMITIDOS = new Set([
  'pr create', 'pr view', 'pr list', 'pr diff', 'pr checks', 'pr status', 'pr comment', 'pr edit', 'pr ready',
  'run list', 'run view', 'repo view', 'issue view', 'issue list', 'workflow list', 'workflow view',
]);

function dentroDe(raiz, ruta) {
  const r = path.resolve(raiz);
  const p = path.resolve(ruta);
  return p === r || p.startsWith(r + path.sep);
}

/** Ruta real (resuelve enlaces) o la normalizada si no existe. */
function real(ruta) {
  try {
    return realpathSync(ruta);
  } catch {
    return path.resolve(ruta);
  }
}

/** Destino de un refspec de push (sin «refs/heads/»), o null si no se puede saber. */
export function destinoRefspec(spec) {
  if (spec.startsWith('+')) return { error: 'push forzado (+)' };
  const i = spec.lastIndexOf(':');
  const src = i >= 0 ? spec.slice(0, i) : spec;
  const dst = i >= 0 ? spec.slice(i + 1) : spec;
  if (i >= 0 && src === '') return { error: 'borrar ramas remotas' };
  const limpio = dst.replace(/^refs\/heads\//, '');
  if (/^refs\//.test(limpio)) return { error: `destino ${dst}` };
  return { destino: limpio };
}

/**
 * Valida una llamada a git. Devuelve { ok, motivo, dir, args } donde `dir` es la carpeta en la que
 * corre (la de `-C` o la actual) y `args` lo que se le pasa al git real.
 */
export function validarGit(argv, { raiz, cwd }) {
  const args = [...argv];
  let dir = cwd;
  const salida = [];
  while (args.length && args[0].startsWith('-')) {
    const o = args.shift();
    if (o === '-C') {
      const d = args.shift();
      if (!d) return { ok: false, motivo: '-C sin carpeta.' };
      dir = path.resolve(dir, d);
    } else if (o === '--no-pager') {
      salida.push(o);
    } else return { ok: false, motivo: `opción global no permitida: ${o}` };
  }
  if (!dentroDe(real(raiz), real(dir))) return { ok: false, motivo: `git solo se permite dentro de los hilos del proyecto (${raiz}); carpeta pedida: ${dir}.` };
  const sub = args[0];
  if (!sub) return { ok: false, motivo: 'falta el subcomando.' };
  if (!GIT_PERMITIDOS.has(sub)) return { ok: false, motivo: `git ${sub} no está permitido.` };
  const resto = args.slice(1);
  const fin = resto.indexOf('--');
  const opciones = fin >= 0 ? resto.slice(0, fin) : resto;
  const porSub = GIT_PROHIBIDAS_POR_SUB[sub] ?? [];
  for (const a of opciones) {
    const base = a.split('=')[0];
    if (GIT_OPCIONES_PROHIBIDAS.some((re) => re.test(a)) || porSub.includes(base) || (sub === 'grep' && /^-O/.test(a)) || (sub === 'rebase' && /^-x/.test(a))) {
      return { ok: false, motivo: `opción no permitida en git ${sub}: ${a}` };
    }
  }
  if (sub === 'tag' && opciones.some((a) => a.startsWith('-') && a !== '-l' && a !== '--list')) return { ok: false, motivo: 'git tag solo para listar (-l).' };
  if (sub === 'tag' && opciones.length > 0 && !opciones.includes('-l') && !opciones.includes('--list')) return { ok: false, motivo: 'git tag solo para listar (-l).' };
  if (sub === 'push' || sub === 'fetch' || sub === 'pull') {
    const pos = opciones.filter((a) => !a.startsWith('-'));
    if (sub === 'push') {
      const malas = opciones.filter((a) => a.startsWith('-') && !PUSH_PERMITIDAS.has(a));
      if (malas.length) return { ok: false, motivo: `opción de push no permitida: ${malas.join(' ')}` };
    }
    if (pos.length && pos[0] !== 'origin') return { ok: false, motivo: `${sub} solo hacia el remoto origin.` };
    if (sub === 'push') {
      for (const spec of pos.slice(1)) {
        const d = destinoRefspec(spec);
        if (d.error) return { ok: false, motivo: `push no permitido: ${d.error}.` };
        if (!d.destino.startsWith(PREFIJO_RAMA)) return { ok: false, motivo: `push solo a ramas ${PREFIJO_RAMA}* (pedido: ${d.destino}).` };
      }
    }
  }
  return { ok: true, dir, args: [...salida, ...args] };
}

/** Revisa la salida de `git config --list --show-scope`. Devuelve el motivo si algo no es aceptable. */
export function revisarConfigGit(texto, { repos }) {
  const urls = new Set();
  for (const g of repos) {
    urls.add(`https://github.com/${g}`.toLowerCase());
    urls.add(`https://github.com/${g}.git`.toLowerCase());
  }
  for (const linea of String(texto).split('\n')) {
    if (!linea.trim()) continue;
    const t = linea.indexOf('\t');
    const scope = t >= 0 ? linea.slice(0, t) : '';
    const kv = t >= 0 ? linea.slice(t + 1) : linea;
    const eq = kv.indexOf('=');
    const clave = (eq >= 0 ? kv.slice(0, eq) : kv).toLowerCase();
    const valor = eq >= 0 ? kv.slice(eq + 1) : '';
    if (scope === 'command') continue; // lo que pone esta guardia (GIT_CONFIG_COUNT)
    if (clave === 'remote.origin.url') {
      if (!urls.has(valor.toLowerCase())) return `remote.origin.url no es un repositorio permitido (${valor}).`;
      continue;
    }
    if (clave === 'credential.helper') {
      if (valor === '' || valor === AYUDANTE_CREDENCIAL) continue;
      return 'credential.helper no permitido.';
    }
    if (!CONFIG_PERMITIDA.some((re) => re.test(clave))) return `configuración de git no permitida: ${clave} (${scope || 'sin alcance'}).`;
  }
  return null;
}

/** Busca un valor (--opcion valor | --opcion=valor | -x valor). */
export function valorOpcionPublica(args, largos, cortos = []) {
  return valorOpcion(args, largos, cortos);
}

function valorOpcion(args, largos, cortos = []) {
  const vals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    for (const l of largos) {
      if (a === l) vals.push(args[i + 1] ?? '');
      else if (a.startsWith(`${l}=`)) vals.push(a.slice(l.length + 1));
    }
    for (const c of cortos) {
      if (a === c) vals.push(args[i + 1] ?? '');
      else if (a.startsWith(c) && a.length > c.length && !a.startsWith('--')) vals.push(a.slice(c.length));
    }
  }
  return vals;
}

/**
 * Valida una llamada a gh. `repoCwd` es el repo («dueño/repo») del worktree en el que corre.
 * Devuelve { ok, motivo, args, repo, archivos } (archivos = --body-file a revisar).
 */
export function validarGh(argv, { repos, repoCwd = null }) {
  const args = [...argv];
  if (args.length < 2) return { ok: false, motivo: 'uso: gh <grupo> <acción> …' };
  const clave = `${args[0]} ${args[1]}`;
  if (clave === 'pr merge') return { ok: false, motivo: 'gh pr merge está prohibido: los pases los hace Tecnología (deje el PR abierto hacia testing).' };
  if (!GH_PERMITIDOS.has(clave)) return { ok: false, motivo: `gh ${clave} no está permitido.` };
  const resto = args.slice(2);
  if (resto.some((a) => a === '--web' || a === '-w')) return { ok: false, motivo: 'gh --web no está permitido.' };
  const repoOpc = valorOpcion(resto, ['--repo'], ['-R']);
  const repo = repoOpc[0] ?? repoCwd;
  if (!repo) return { ok: false, motivo: 'no sé de qué repositorio es: use --repo dueño/repo o corra gh dentro del worktree.' };
  const conf = Object.entries(repos).find(([g]) => g.toLowerCase() === repo.toLowerCase());
  if (!conf || repoOpc.some((r) => r.toLowerCase() !== repo.toLowerCase())) return { ok: false, motivo: `repositorio no permitido: ${repo}.` };
  const base = conf[1].base;
  const bases = valorOpcion(resto, ['--base'], ['-B']);
  if (clave === 'pr create') {
    if (bases.length !== 1 || bases[0] !== base) return { ok: false, motivo: `gh pr create exige --base ${base} (los PR van SOLO a ${base}).` };
  }
  if (clave === 'pr edit' && bases.some((b) => b !== base)) return { ok: false, motivo: `la base del PR solo puede ser ${base}.` };
  const archivos = valorOpcion(resto, ['--body-file'], ['-F']).filter((f) => f && f !== '-');
  if (valorOpcion(resto, ['--body-file'], ['-F']).some((f) => f === '-')) return { ok: false, motivo: '--body-file - (stdin) no está permitido: use un archivo.' };
  const conRepo = repoOpc.length ? resto : ['--repo', conf[0], ...resto];
  // `repo view` recibe el repositorio como argumento, no con --repo.
  const finales = clave === 'repo view' ? [args[0], args[1], conf[0], ...resto.filter((a, i) => !(a === '--repo' || a === '-R' || resto[i - 1] === '--repo' || resto[i - 1] === '-R') && a.toLowerCase() !== conf[0].toLowerCase())] : [args[0], args[1], ...conRepo];
  return { ok: true, args: finales, repo: conf[0], archivos };
}

/** Glob simple (`**` cualquier ruta, `*` dentro de una carpeta) → RegExp anclada. */
export function globARegex(glob) {
  let r = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      r += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') r += '[^/]*';
    else r += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  // eslint-disable-next-line security/detect-non-literal-regexp -- patrón armado aquí, escapado
  return new RegExp(`^${r}$`);
}

/** Archivos fuera del alcance permitido (lista vacía = todo bien). Sin lista = sin restricción. */
export function fueraDeAlcance(archivos, rutasPermitidas) {
  if (!Array.isArray(rutasPermitidas)) return [];
  const res = rutasPermitidas.map(globARegex);
  return archivos.filter((f) => f && !res.some((re) => re.test(f)));
}

export const MENSAJE_ALCANCE = 'solo puede modificar dashboards; pida a Nicolás Rivera cualquier cambio fuera de ese alcance';

/** «dueño/repo» a partir de la URL de origin. */
export function repoDeUrl(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(\.git)?$/i.exec(String(url ?? '').trim());
  return m ? m[1] : null;
}

/** Entorno de los programas reales: sin heredar nada del Gateway salvo lo mínimo. */
export function entornoGuardia(conf, token) {
  const pares = [
    ['core.hooksPath', conf.hooks],
    ['core.fsmonitor', 'false'],
    ['core.pager', 'cat'],
    ['core.editor', 'true'],
    ['sequence.editor', 'true'],
    ['credential.helper', ''],
    ['credential.helper', AYUDANTE_CREDENCIAL],
    ['protocol.file.allow', 'never'],
    ['protocol.ext.allow', 'never'],
  ];
  const env = {
    PATH: conf.path ?? '/opt/homebrew/bin:/usr/bin:/bin',
    HOME: conf.home,
    LANG: 'en_US.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    GH_PAGER: 'cat',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    GH_HOST: 'github.com',
    GH_CONFIG_DIR: conf.ghConfig,
    NO_COLOR: '1',
    GIT_CONFIG_COUNT: String(pares.length),
  };
  pares.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  if (token) env.GH_TOKEN = token;
  return env;
}

function leerToken(ruta) {
  try {
    const t = readFileSync(ruta, 'utf8').trim();
    return /^[A-Za-z0-9_]{20,255}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

function fallar(motivo) {
  process.stderr.write(`guardia (puente de hilos): ${motivo}\n`);
  process.exit(126);
}

function principal() {
  const dirGuardia = path.dirname(fileURLToPath(import.meta.url));
  const conf = JSON.parse(readFileSync(path.join(dirGuardia, 'guardia.json'), 'utf8'));
  const [herramienta, ...argv] = process.argv.slice(2);
  const token = leerToken(conf.tokenArchivo);
  const env = entornoGuardia(conf, token);
  const cwd = process.cwd();
  const repos = Object.keys(conf.repos ?? {});
  const revisar = (dir) => {
    let texto;
    try {
      texto = execFileSync(conf.git, ['-C', dir, 'config', '--list', '--show-scope'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
    } catch (e) {
      fallar(`no pude leer la configuración del repo en ${dir}: ${String(e.stderr ?? e.message).trim().slice(0, 300)}`);
    }
    const m = revisarConfigGit(texto, { repos });
    if (m) fallar(m);
  };
  // Alcance por rutas (2026-11-06, Kepler: «no se puede pasar de eso»): lo que se empuja o se
  // propone en un PR, comparado contra origin/<rama de pruebas>, solo puede tocar rutasPermitidas.
  const revisarAlcance = (dir, ref, base) => {
    if (!Array.isArray(conf.rutasPermitidas)) return;
    let salida = '';
    try {
      salida = execFileSync(conf.git, ['-C', dir, 'diff', '--name-only', `origin/${base}...${ref}`], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    } catch (e) {
      fallar(`no pude comparar ${ref} con origin/${base}: ${String(e.stderr ?? e.message).trim().slice(0, 300)}`);
    }
    const fuera = fueraDeAlcance(salida.split('\n').map((x) => x.trim()), conf.rutasPermitidas);
    if (fuera.length) fallar(`${conf.agente ?? 'este agente'} ${MENSAJE_ALCANCE}. Archivos fuera de alcance: ${fuera.slice(0, 15).join(', ')}${fuera.length > 15 ? '…' : ''}`);
  };
  const baseDe = (dir) => {
    try {
      const r = repoDeUrl(execFileSync(conf.git, ['-C', dir, 'config', '--get', 'remote.origin.url'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }));
      const c = Object.entries(conf.repos ?? {}).find(([g]) => g.toLowerCase() === String(r).toLowerCase());
      if (c) return c[1].base;
    } catch {}
    return fallar('no sé cuál es la rama de pruebas de este repositorio.');
  };
  if (herramienta === 'git') {
    const v = validarGit(argv, { raiz: conf.raiz, cwd });
    if (!v.ok) fallar(v.motivo);
    revisar(v.dir);
    if (['push', 'fetch', 'pull'].includes(v.args.find((a) => !a.startsWith('-'))) && !token) fallar('todavía no hay token de GitHub configurado para este agente: puede trabajar y hacer commits, pero no push, fetch ni PR. Avísele a Tecnología.');
    if (v.args.find((a) => !a.startsWith('-')) === 'push' && Array.isArray(conf.rutasPermitidas)) {
      const pos = v.args.slice(v.args.indexOf('push') + 1).filter((a) => !a.startsWith('-'));
      const fuentes = pos.slice(1).map((sp) => (sp.includes(':') ? sp.slice(0, sp.lastIndexOf(':')) : sp));
      const base = baseDe(v.dir);
      for (const ref of fuentes.length ? fuentes : ['HEAD']) revisarAlcance(v.dir, ref, base);
    }
    const r = spawnSync(conf.git, ['-C', v.dir, ...v.args], { env, stdio: 'inherit', timeout: 600_000 });
    process.exit(r.status ?? 1);
  }
  if (herramienta === 'gh') {
    if (!dentroDe(real(conf.raiz), real(cwd))) fallar(`gh solo se permite dentro de los hilos del proyecto (${conf.raiz}).`);
    let repoCwd = null;
    if (existsSync(path.join(cwd, '.git'))) {
      revisar(cwd);
      try {
        repoCwd = repoDeUrl(execFileSync(conf.git, ['-C', cwd, 'config', '--get', 'remote.origin.url'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }));
      } catch {}
    }
    const v = validarGh(argv, { repos: conf.repos ?? {}, repoCwd });
    if (!v.ok) fallar(v.motivo);
    if (!token) fallar('todavía no hay token de GitHub configurado para este agente: no se puede usar gh. Avísele a Tecnología.');
    if (argv.some((a) => a.includes(token))) fallar('el comando contiene el token de GitHub.');
    for (const f of v.archivos) {
      const ruta = path.resolve(cwd, f);
      if (!dentroDe(real(conf.raiz), real(ruta))) fallar(`--body-file solo dentro de los hilos del proyecto (${f}).`);
      let contenido = '';
      try {
        contenido = readFileSync(ruta, 'utf8');
      } catch {
        fallar(`no pude leer ${f}.`);
      }
      if (contenido.includes(token)) fallar(`${f} contiene el token de GitHub.`);
    }
    if (argv[0] === 'pr' && argv[1] === 'create' && Array.isArray(conf.rutasPermitidas)) {
      if (!repoCwd) fallar('gh pr create se corre dentro del worktree (workdir = la ruta del worktree).');
      const head = valorOpcionPublica(argv.slice(2), ['--head'], ['-H'])[0];
      revisarAlcance(cwd, head ? `origin/${head.replace(/^[^:]+:/, '')}` : 'HEAD', baseDe(cwd));
    }
    const r = spawnSync(conf.gh, v.args, { cwd, env, stdio: 'inherit', timeout: 600_000 });
    process.exit(r.status ?? 1);
  }
  fallar(`herramienta desconocida: ${herramienta}`);
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) principal();
