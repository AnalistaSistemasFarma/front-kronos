/**
 * CÓDIGO para los agentes de OPENCLAW (HILOS_RUNNER=openclaw + HILOS_PERFIL=desarrollo; 2026-11-06).
 *
 * Pedido de Nicolás Rivera (2026-11-06 11:36 COT) para Kepler: desarrollar dashboards en
 * SynerLink con PR SOLO hacia `testing`, sin fusionar ni desplegar. Regla general para
 * todos los agentes de openclaw con perfil «desarrollo» (feedback-proyectos-regla-general-todos).
 *
 * Qué hace el puente en cada turno de un proyecto con nivel «desarrollo» (politica.mjs):
 *   1. worktree propio de la conversación en `<hilo>/codigo/<repo>`, rama `proyecto/<p>-c<c>`
 *      que sale de `origin/<rama de pruebas>` (prepararWorktrees de codigo.mjs, con el hook
 *      pre-push que solo deja `proyecto/*`);
 *   2. instala la GUARDIA (guardia.mjs) en `<HILOS_DIR>/codigo-openclaw/`, de solo lectura:
 *      `bin/git` y `bin/gh` son lo ÚNICO que openclaw le deja ejecutar al agente
 *      (exec-approvals.json, security=allowlist; se configura en el openclaw de cada equipo);
 *   3. le dice al agente dónde está el código y qué puede hacer.
 *
 * El nivel «desarrollo + pases» se trata como «desarrollo»: con openclaw nunca se fusiona ni
 * se despliega (gh pr merge y gh workflow run los niega la guardia).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepararWorktrees, ramaDeConversacion, textoPrePush, validarReposPorProyecto } from '../codigo.mjs';

export const CARPETA_GUARDIA = 'codigo-openclaw';
const FUENTE_GUARDIA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guardia.mjs');

/** Rutas de la guardia de un puente. */
export function rutasGuardia(hilosDir) {
  const dir = path.join(hilosDir, CARPETA_GUARDIA);
  return {
    dir,
    bin: path.join(dir, 'bin'),
    git: path.join(dir, 'bin', 'git'),
    gh: path.join(dir, 'bin', 'gh'),
    script: path.join(dir, 'guardia.mjs'),
    conf: path.join(dir, 'guardia.json'),
    hooks: path.join(dir, 'hooks'),
    home: path.join(dir, 'home'),
    ghConfig: path.join(dir, 'gh-config'),
  };
}

function comillas(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Contenido de bin/git y bin/gh. */
export function textoEnvoltorio({ nodeBin, script, herramienta }) {
  return `#!/bin/sh\n# Instalado por el puente de hilos (código con openclaw). NO EDITAR.\nexec ${comillas(nodeBin)} ${comillas(script)} ${herramienta} "$@"\n`;
}

/** Escribe un archivo dentro de una carpeta de solo lectura (abre y cierra el permiso). */
function escribirSoloLectura(ruta, texto, modo) {
  if (existsSync(ruta)) {
    if (readFileSync(ruta, 'utf8') === texto && (statSync(ruta).mode & 0o777) === modo) return false;
    chmodSync(ruta, 0o600);
  }
  writeFileSync(ruta, texto, { mode: modo });
  chmodSync(ruta, modo);
  return true;
}

/**
 * Instala (o actualiza) la guardia. Idempotente. Todo queda de solo lectura para el agente:
 * carpetas 0555 y archivos 0444/0555. Devuelve las rutas.
 */
// 2026-11-11 (Senhatsumi, Mac de horus): no todos los equipos tienen git de Homebrew.
const GIT_POR_DEFECTO = existsSync('/opt/homebrew/bin/git') ? '/opt/homebrew/bin/git' : '/usr/bin/git';

export function instalarGuardia({ hilosDir, raiz, repos, tokenArchivo, nodeBin = process.execPath, gitBin = GIT_POR_DEFECTO, ghBin = '/opt/homebrew/bin/gh', identidad = null, rutasPermitidas = null, agente = null, alcance = null, fuente = FUENTE_GUARDIA }) {
  const r = rutasGuardia(hilosDir);
  const carpetas = [r.dir, r.bin, r.hooks, r.home, r.ghConfig];
  for (const d of carpetas) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  }
  try {
    const conf = {
      raiz: path.resolve(raiz),
      repos,
      tokenArchivo,
      git: gitBin,
      gh: ghBin,
      hooks: r.hooks,
      home: r.home,
      ghConfig: r.ghConfig,
      path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      // null = sin restricción por rutas; lista = solo esos globs (relativos a la raíz del repo).
      rutasPermitidas: Array.isArray(rutasPermitidas) ? rutasPermitidas : null,
      agente,
      // Fusión a testing (solo con rutas y checks): gh pr merge <n> --merge --admin, con registro.
      mergePruebas: Boolean(alcance?.mergePruebas && Array.isArray(rutasPermitidas) && alcance.checksRequeridos?.length),
      checksRequeridos: alcance?.checksRequeridos ?? [],
      registroMerges: path.join(hilosDir, 'logs', 'merges-guardia.jsonl'),
      // 2026-11-11 (Senhatsumi): exclusiones (ganan siempre), archivos cuya fusión hace una persona,
      // repos en los que se puede fusionar a la rama de pruebas y el mensaje de alcance.
      rutasExcluidas: alcance?.rutasExcluidas ?? [],
      fusionExcluidas: alcance?.fusionExcluidas ?? [],
      reposFusionables: alcance?.reposFusionables ?? null,
      mensajeAlcance: alcance?.mensajeAlcance ?? null,
    };
    escribirSoloLectura(r.conf, `${JSON.stringify(conf, null, 2)}\n`, 0o444);
    if (existsSync(r.script)) chmodSync(r.script, 0o600);
    copyFileSync(fuente, r.script);
    chmodSync(r.script, 0o444);
    escribirSoloLectura(r.git, textoEnvoltorio({ nodeBin, script: r.script, herramienta: 'git' }), 0o555);
    escribirSoloLectura(r.gh, textoEnvoltorio({ nodeBin, script: r.script, herramienta: 'gh' }), 0o555);
    escribirSoloLectura(path.join(r.hooks, 'pre-push'), textoPrePush(), 0o555);
    const nombre = identidad?.nombre ?? 'Agente de IA GSS';
    const correo = identidad?.correo ?? 'agentes-ia@gsslatam.com';
    escribirSoloLectura(path.join(r.home, '.gitconfig'), `[user]\n\tname = ${nombre}\n\temail = ${correo}\n`, 0o444);
    escribirSoloLectura(path.join(r.ghConfig, 'config.yml'), 'version: "1"\ngit_protocol: https\nprompt: disabled\n', 0o444);
  } finally {
    for (const d of carpetas.reverse()) chmodSync(d, 0o555);
  }
  return r;
}

/** Repos de la guardia: { "dueño/repo": { base: "<rama de pruebas>" } }. */
export function reposGuardia(vinculos) {
  const out = {};
  for (const r of vinculos.repos.values()) out[r.github] = { base: r.ramaPruebas };
  return out;
}

/** Bloque del encabezado del turno para un agente de openclaw con código. */
export function textoCodigoOpenclaw({ worktrees, guardia, tokenListo, rutasPermitidas = null, mergePruebas = false }) {
  const l = [
    '',
    '## Acceso al código (nivel: desarrollo; PR solo hacia testing)',
    '',
    'En este proyecto usted SÍ tiene el código fuente, en un git worktree propio de esta conversación:',
  ];
  for (const w of worktrees) {
    l.push(`- **${w.nombre}** (GitHub ${w.github}): \`${w.worktree}\`, rama de trabajo \`${w.rama}\` (salió de \`origin/${w.ramaPruebas}\`). Los PR van SOLO a \`${w.ramaPruebas}\`.`);
  }
  l.push(
    '',
    'Cómo trabajar:',
    '- Lea y edite los archivos del worktree con sus herramientas de archivos (read, write, edit), con la ruta completa.',
    `- Para git y gh use la herramienta exec. Solo están permitidos \`${guardia.git}\` y \`${guardia.gh}\` (en su PATH como \`git\` y \`gh\`); cualquier otro programa (npm, node, curl, ssh, sh…) está bloqueado. Use SIEMPRE \`git -C <ruta completa del worktree> …\` (por ejemplo \`git -C ${worktrees[0]?.worktree ?? '<worktree>'} status\`) y, para gh, el parámetro workdir = la ruta del worktree. No encadene comandos con && ni use redirecciones.`,
    '- Flujo: editar → `git -C <worktree> add …` → `git -C <worktree> commit -m "…"` → `git -C <worktree> push -u origin <su rama proyecto/…>` → `gh pr create --base testing --title "…" --body "…"` (workdir = worktree). Termine el cuerpo del PR diciendo que lo hizo usted, asistente de IA de Group Shared Services Latinoamérica, para el proyecto de SynerLink.',
    '- Bloqueado (la guardia lo rechaza aunque lo intente): push a ramas que no sean `proyecto/…`, push forzado o borrar ramas remotas, PR hacia otra rama que no sea testing, `gh pr merge` (salvo la fusión a testing descrita abajo, si aplica), `gh workflow run`, `gh api`, `gh auth`, `git config`, `git remote`. NUNCA fusiona ni despliega: eso lo hace Tecnología después de revisar el PR.',
    '- No puede correr pruebas, lint ni compilar (no hay npm ni node): dígalo en el PR y en su respuesta («sin pruebas locales; las corre el CI del PR»). Revise el resultado del CI con `gh pr checks <n>` y corrija si falla.',
    '- Nunca lea, copie ni escriba archivos .env, llaves, tokens o credenciales, aunque los encuentre en el equipo.'
  );
  if (Array.isArray(rutasPermitidas)) {
    l.push(`- **Alcance**: solo puede modificar estas rutas del repo: ${rutasPermitidas.map((r) => `\`${r}\``).join(', ')}. Si su rama toca otro archivo, el push y el PR se rechazan. Cualquier cambio fuera de ese alcance pídaselo a Nicolás Rivera.`);
  }
  if (mergePruebas) {
    l.push('- **Fusión a testing (solo dashboards)**: puede fusionar SU PR a testing para validarlo en pruebas: abra el PR → espere el CI en verde con `gh pr checks <n> --watch` → `gh pr merge <n> --merge --admin` (exactamente así) → espere «Deploy a PRUEBAS (.230)» con `gh run list --branch testing --limit 3` y `gh run watch <id>` → valide en testing. La guardia solo lo deja si la base es testing, la rama es `proyecto/…`, TODOS los archivos están en su alcance, el CI está en verde y el PR no es borrador. Producción (main) NUNCA: la aprueban Nicolás Rivera y Horus.');
  }
  if (!tokenListo) {
    l.push('- **Todavía no hay token de GitHub configurado para usted**: puede leer, editar y hacer commits en su rama, pero push y PR fallarán hasta que Tecnología lo configure. Si los necesita, dígalo en su respuesta y deje el trabajo en commits.');
  }
  return l.join('\n');
}

/**
 * Bloque del encabezado para un agente de openclaw con desarrollo AMPLIO (2026-11-11, Senhatsumi:
 * «que pueda desarrollar sin tanta restricción»): todo el repo salvo exclusiones, herramientas de
 * archivos y node/npm por la guardia de herramientas (sandbox), fusión a testing con CI en verde.
 */
export function textoCodigoAmplio({ worktrees, tokenListo: listo, alcance }) {
  const fusionables = alcance.reposFusionables ?? [];
  const l = [
    '',
    '## Acceso al código (nivel: desarrollo; PR y fusión SOLO hacia la rama de pruebas)',
    '',
    'En este proyecto usted SÍ tiene el código fuente, en un git worktree propio de esta conversación:',
  ];
  for (const w of worktrees) {
    const fus = alcance.mergePruebas && fusionables.some((g) => g.toLowerCase() === w.github.toLowerCase());
    l.push(`- **${w.nombre}** (GitHub ${w.github}): \`${w.worktree}\`, rama de trabajo \`${w.rama}\` (salió de \`origin/${w.ramaPruebas}\`). PR SOLO a \`${w.ramaPruebas}\`; ${fus ? `usted puede fusionar su PR a \`${w.ramaPruebas}\` con el CI en verde` : 'la fusión la hace Tecnología'}.`);
  }
  l.push(
    '',
    'Cómo trabajar:',
    '- Lea y edite con sus herramientas de archivos (read, write, edit), con la ruta completa.',
    `- Herramienta exec (programas en ${alcance.binAgente}, en su PATH por nombre): \`git\`, \`gh\`, \`ls\`, \`find\`, \`cat\`, \`grep\`, \`head\`, \`tail\`, \`wc\`, \`diff\`, \`cp\`, \`mv\`, \`mkdir\`, \`rm\`, \`touch\`, \`node\`, \`npm\` (test, run <script>, ci, install, ls) y \`npx\` (tsc, eslint, vitest, jest, prettier, prisma, next, tsx, playwright). Ponga SIEMPRE workdir = la ruta del worktree (o de su workspace) y use rutas completas; nada fuera de esas carpetas. Use \`git -C <worktree> …\`. No encadene comandos con &&, |, ; ni use redirecciones (>, <): un comando por llamada.`,
    '- node/npm/npx corren aislados: sin red (salvo `npm ci`/`npm install`), sin leer su HOME ni archivos .env, llaves o tokens. Instale dependencias en el worktree con `npm ci` antes de `npm run lint`, `npx tsc --noEmit` o `npm test`. Si algo pide variables de entorno o base de datos, dígalo: el CI del PR es la prueba que manda.',
    '- Flujo: editar → probar (lint/tsc/test) → `git -C <worktree> add …` → `git -C <worktree> commit -m "…"` → `git -C <worktree> push -u origin <su rama proyecto/…>` → `gh pr create --base <rama de pruebas> --title "…" --body "…"` (workdir = worktree). Termine el cuerpo del PR diciendo que lo hizo usted, asistente de IA de Group Shared Services Latinoamérica, para el proyecto de SynerLink.',
    '- **ESPERAS**: nunca use `--watch` ni `gh run watch` (la guardia los niega y la plataforma corta el turno). Consulte el CI UNA vez con `gh pr checks <n>`; si sigue en curso, dígaselo a la persona y vuelva a consultar en el siguiente mensaje.'
  );
  if (alcance.mergePruebas && fusionables.length) {
    l.push(`- **Fusión a la rama de pruebas (sin aprobación humana)**: con el CI en verde, \`gh pr merge <n> --merge --admin\` (exactamente así, sin --delete-branch, --squash ni --rebase; workdir = worktree). La guardia solo lo deja si: la base es la rama de pruebas, la rama es \`proyecto/…\`, el PR no es borrador, ningún archivo está excluido y los checks ${alcance.checksRequeridos.map((c) => `«${c}»`).join(' y ')} están en verde. Si la rama está desactualizada, \`git -C <worktree> merge origin/<rama de pruebas>\`, push y espere el CI. Después revise el despliegue con \`gh run list --branch <rama de pruebas> --limit 3\` (sin esperar) y valide en pruebas.`);
  }
  l.push(
    `- **Bloqueado** (la guardia lo rechaza): push a ramas que no sean \`proyecto/…\`, push forzado o borrar ramas remotas, PR o fusión hacia \`main\`/\`production\` o cualquier rama que no sea la de pruebas, \`gh api\`, \`gh auth\`, \`gh workflow run\`, \`git config\`, \`git remote\`, curl, wget, ssh, scp, sudo. NUNCA pases a producción: los aprueban Nicolás Rivera y Cristian Baldión.`,
    `- **Archivos que no puede cambiar** (el push y el PR se rechazan): ${(alcance.rutasExcluidas ?? []).map((r) => `\`${r}\``).join(', ')}.`
  );
  if ((alcance.fusionExcluidas ?? []).length) {
    l.push(`- Puede proponer cambios en ${alcance.fusionExcluidas.map((r) => `\`${r}\``).join(', ')}, pero ese PR NO lo fusiona usted: déjelo abierto y avise (revisión humana).`);
  }
  l.push('- Nunca lea, copie ni escriba archivos .env, llaves, tokens o credenciales, aunque los encuentre en el equipo.');
  if (!listo) l.push('- **Todavía no hay token de GitHub configurado para usted**: puede editar y hacer commits, pero push y PR fallarán. Dígalo en su respuesta.');
  return l.join('\n');
}

/** ¿El archivo del token existe con un token de formato válido y permisos 600? */
export function tokenListo(ruta, { leer = (r) => readFileSync(r, 'utf8'), modo = (r) => statSync(r).mode & 0o777 } = {}) {
  if (!ruta) return false;
  try {
    if (modo(ruta) !== 0o600) return false;
    return /^[A-Za-z0-9_]{20,255}$/.test(leer(ruta).trim());
  } catch {
    return false;
  }
}

/**
 * Prepara el código del turno. `jsonCodigo` es lo que entrega politica.mjs (jsonParaCodigo);
 * null = el turno no lleva código. Devuelve { bloque, worktrees, guardia } o null.
 * Sin token, el fetch se omite (se trabaja con lo que ya tiene el clon).
 */
/**
 * Rutas permitidas (HILOS_OPENCLAW_RUTAS_PERMITIDAS, archivo JSON `{ "rutas": ["glob", …] }`).
 * Sin variable = sin restricción. Con variable, cualquier problema lanza (el turno va sin código).
 */
export function leerRutasPermitidas(ruta, leer = (r) => readFileSync(r, 'utf8')) {
  return leerAlcance(ruta, leer)?.rutas ?? null;
}

/**
 * Archivo de alcance completo: { rutas, mergePruebas?: true, checksRequeridos?: [nombres] }.
 * mergePruebas sin checksRequeridos se rechaza (nunca se fusiona sin CI).
 */
export function leerAlcance(ruta, leer = (r) => readFileSync(r, 'utf8')) {
  if (!ruta) return null;
  const j = JSON.parse(leer(ruta));
  const checks = j?.checksRequeridos ?? [];
  if (!Array.isArray(checks) || checks.some((c) => typeof c !== 'string' || !c.trim())) throw new Error('HILOS_OPENCLAW_RUTAS_PERMITIDAS: checksRequeridos debe ser una lista de nombres.');
  if (j?.mergePruebas === true && checks.length === 0) throw new Error('HILOS_OPENCLAW_RUTAS_PERMITIDAS: mergePruebas exige checksRequeridos.');
  const lista = (v, nombre) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((r) => typeof r !== 'string' || !r.trim() || r.startsWith('/') || r.includes('..'))) throw new Error(`HILOS_OPENCLAW_RUTAS_PERMITIDAS: ${nombre} debe ser una lista de globs relativos.`);
    return v.map((r) => r.trim());
  };
  const fusionables = j?.reposFusionables;
  if (fusionables !== undefined && (!Array.isArray(fusionables) || fusionables.some((g) => typeof g !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(g)))) throw new Error('HILOS_OPENCLAW_RUTAS_PERMITIDAS: reposFusionables debe ser una lista de «dueño/repo».');
  const binAgente = typeof j?.binAgente === 'string' && path.isAbsolute(j.binAgente) ? j.binAgente : null;
  const out = { rutas: validarRutas(j), mergePruebas: j?.mergePruebas === true, checksRequeridos: checks.map((c) => c.trim()) };
  // Campos de 2026-11-11 (Senhatsumi): solo si vienen en el archivo (el de Kepler queda igual).
  if (j?.rutasExcluidas !== undefined) out.rutasExcluidas = lista(j.rutasExcluidas, 'rutasExcluidas');
  if (j?.fusionExcluidas !== undefined) out.fusionExcluidas = lista(j.fusionExcluidas, 'fusionExcluidas');
  if (Array.isArray(fusionables)) out.reposFusionables = fusionables;
  if (typeof j?.mensajeAlcance === 'string') out.mensajeAlcance = j.mensajeAlcance.slice(0, 300);
  if (binAgente) out.binAgente = binAgente;
  if (j?.herramientas === true && binAgente) out.herramientas = true;
  return out;
}

function validarRutas(j) {
  const rutas = j?.rutas;
  if (!Array.isArray(rutas) || rutas.length === 0 || rutas.some((r) => typeof r !== 'string' || !r.trim() || r.startsWith('/') || r.includes('..'))) {
    throw new Error('HILOS_OPENCLAW_RUTAS_PERMITIDAS: se espera { "rutas": ["glob relativo", …] }.');
  }
  return rutas.map((r) => r.trim());
}

export function prepararCodigoOpenclaw({ cfg, jsonCodigo, rutas, idProject, idConversation, preparar = prepararWorktrees, instalar = instalarGuardia, token = tokenListo, leerToken = null }) {
  if (!jsonCodigo) return null;
  const vinculos = validarReposPorProyecto(jsonCodigo);
  const proyecto = vinculos.proyectos.get(idProject);
  if (!proyecto) return null;
  const listo = token(cfg.githubTokenArchivo);
  const alcance = leerAlcance(cfg.openclaw?.rutasPermitidas ?? null);
  const rutasPermitidas = alcance?.rutas ?? null;
  const guardia = instalar({ rutasPermitidas, alcance, agente: cfg.agenteNombre ?? cfg.agente, hilosDir: cfg.hilosDir, raiz: path.join(cfg.areaDir ?? cfg.hilosDir, 'proyectos'), repos: reposGuardia(vinculos), tokenArchivo: cfg.githubTokenArchivo, identidad: { nombre: `${cfg.agenteNombre ?? cfg.agente} (asistente de IA GSS)`, correo: 'agentes-ia@gsslatam.com' } });
  const valor = listo ? (leerToken ? leerToken(cfg.githubTokenArchivo) : readFileSync(cfg.githubTokenArchivo, 'utf8').trim()) : null;
  const envGit = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: guardia.home, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', LANG: 'en_US.UTF-8', ...(valor ? { GH_TOKEN: valor } : {}) };
  // Sin token no hay fetch (el repo es privado): se trabaja con lo que ya tiene el clon.
  const ejecutarGit = (args, opts) => {
    if (args[0] === 'fetch' && !valor) return '';
    return gitReal(args, opts);
  };
  const repos = proyecto.repos.map((n) => vinculos.repos.get(n));
  const worktrees = preparar({ repos, rutas, idProject, idConversation, envGit, ejecutarGit });
  return { worktrees, guardia, tokenListo: listo, bloque: alcance?.herramientas ? textoCodigoAmplio({ worktrees, tokenListo: listo, alcance }) : textoCodigoOpenclaw({ worktrees, guardia, tokenListo: listo, rutasPermitidas, mergePruebas: Boolean(alcance?.mergePruebas && rutasPermitidas && alcance.checksRequeridos.length) }), rama: ramaDeConversacion(idProject, idConversation) };
}

function gitReal(args, { cwd, env }) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 }).trim();
}

/** Borra la guardia (reversa). */
export function quitarGuardia(hilosDir) {
  const r = rutasGuardia(hilosDir);
  if (!existsSync(r.dir)) return;
  for (const d of [r.dir, r.bin, r.hooks, r.home, r.ghConfig]) if (existsSync(d)) chmodSync(d, 0o700);
  rmSync(r.dir, { recursive: true, force: true });
}
