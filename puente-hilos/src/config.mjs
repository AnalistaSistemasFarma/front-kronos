/**
 * Configuración del PUENTE DE HILOS — se lee del entorno y de perfiles.json,
 * se valida y, ante cualquier duda, FALLA CERRADO (no arranca).
 *
 * Variables (nombres; los valores nunca van al repositorio):
 *   HILOS_ENTORNO              'pruebas'. En F1 es el único valor admitido.
 *   HILOS_SYNERLINK_URL        Base de SynerLink de PRUEBAS (p. ej. http://host:puerto).
 *   HILOS_SYNERLINK_KEY        Llave del agente con scope "projects" (NO la del bot vivo).
 *   HILOS_AGENTE               code del agente (p. ej. 'play'); se verifica contra la llave.
 *   HILOS_DIR                  Carpeta del puente (estado, carpetas de hilos, config aislado).
 *   HILOS_PERFILES             Ruta a perfiles.json (perfil -> conectores MCP).
 *   Credencial del modelo, EXACTAMENTE una de:
 *   HILOS_TOKEN_ENV_AGENTE     Ruta al .env DEL PROPIO AGENTE (p. ej. ~/.play/.env). Decisión de
 *                              Nicolás (2026-10-17): «el plan de cada agente, el token de cada
 *                              agente». Se lee SOLO CLAUDE_CODE_OAUTH_TOKEN de ese archivo, dentro
 *                              del proceso y sin imprimirlo; el resto del archivo se ignora.
 *                              Comparte el límite de uso con el bot vivo.
 *   HILOS_CLAUDE_CODE_OAUTH_TOKEN  El mismo token, copiado al .env del puente (600).
 *   HILOS_ANTHROPIC_API_KEY    Llave de API (la vía que Anthropic indica para multiusuario).
 *   HILOS_MAX_CONCURRENCIA     1 o 2 (por defecto 2). Tope de hilos simultáneos.
 *   HILOS_TIMEOUT_TURNO_MS     Tope por turno (por defecto 900000 = 15 min).
 *   HILOS_MODELO               Opcional: modelo del `claude -p`.
 *   HILOS_MAX_BUDGET_USD       Opcional: tope de gasto por turno (solo con llave de API).
 *   HILOS_CLAUDE_BIN           Opcional: ruta del ejecutable `claude` (por defecto, el del PATH).
 *   HILOS_INSTRUCCIONES_EN     'system-prompt' (por defecto) o 'claude-md'. Ver hilos.mjs.
 *
 *   Equipo de subagentes (F2, 2026-10-18; ver equipo.mjs):
 *   HILOS_SUBAGENTES                 'si' (por defecto) o 'no'. Con 'no', ningún turno lleva
 *                                    equipo aunque el proyecto tenga uno aprobado (interruptor).
 *   HILOS_SUBAGENTES_MAX_SIMULTANEOS Tope de subagentes a la vez por turno (1 a 5; por defecto 3).
 *                                    El proyecto puede bajarlo, nunca subirlo.
 *   HILOS_SUBAGENTES_MAX_TURNOS      Vueltas máximas de cada subagente (5 a 100; por defecto 30).
 *   HILOS_SUBAGENTES_PRESUPUESTO_USD Tope de gasto por PEDIDO cuando el turno lleva equipo
 *                                    (`--max-budget-usd`; por defecto 3). Si HILOS_MAX_BUDGET_USD
 *                                    es menor, manda ese.
 *   HILOS_SUGERENCIA_PRESUPUESTO_USD Tope de gasto de «Sugerir equipo» (por defecto 0.5).
 *   HILOS_SUGERENCIA_TIMEOUT_MS      Tope de tiempo de «Sugerir equipo» (por defecto 180000 = 3 min).
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const MAX_CONCURRENCIA_F1 = 2;

/** Herramientas de Claude Code que NUNCA se habilitan, aunque un perfil las pida. */
export const HERRAMIENTAS_PROHIBIDAS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'PowerShell',
  'REPL',
  'NotebookEdit',
  // Subagentes: prohibidos SALVO en un turno con equipo aprobado (F2, equipo.mjs),
  // y entonces solo `Agent(<slug>)` del equipo. Nunca dentro de un subagente.
  'Agent',
  'Task',
];

function numero(env, nombre, porDefecto, max) {
  const raw = (env[nombre] ?? '').trim();
  if (!raw) return porDefecto;
  const n = Number(raw);
  if (!(n > 0) || n > max) throw new ErrorConfig(`${nombre} debe ser un número mayor que 0 y hasta ${max}.`);
  return n;
}

export class ErrorConfig extends Error {}

function requerida(env, nombre) {
  const v = (env[nombre] ?? '').trim();
  if (!v) throw new ErrorConfig(`Falta la variable ${nombre}.`);
  return v;
}

function entero(env, nombre, porDefecto, min, max) {
  const raw = (env[nombre] ?? '').trim();
  if (!raw) return porDefecto;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ErrorConfig(`${nombre} debe ser un entero entre ${min} y ${max}.`);
  }
  return n;
}

/**
 * Valida perfiles.json. Reglas (todas fallan cerrado):
 *   - cada perfil declara `mcpServers` (objeto) y `herramientas` (lista);
 *   - solo servidores HTTP con URL http(s), SIN cabeceras: las credenciales
 *     no viven en archivos de configuración;
 *   - cada herramienta es un nombre EXACTO `mcp__<servidor>__<tool>` de un
 *     servidor declarado en ese mismo perfil; nada de comodines;
 *   - `web: true` habilita WebSearch y WebFetch (decisión de Nicolás, 2026-10-17).
 */
export function validarPerfiles(json) {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ErrorConfig('perfiles.json debe ser un objeto { "<perfil>": { ... } }.');
  }
  const perfiles = new Map();
  for (const [clave, p] of Object.entries(json)) {
    if (!/^[a-z0-9-]+$/.test(clave)) throw new ErrorConfig(`Perfil con clave inválida: ${clave}.`);
    if (typeof p !== 'object' || p === null) throw new ErrorConfig(`Perfil ${clave} inválido.`);
    const servidores = p.mcpServers ?? {};
    if (typeof servidores !== 'object' || Array.isArray(servidores)) {
      throw new ErrorConfig(`Perfil ${clave}: mcpServers debe ser un objeto.`);
    }
    const limpios = {};
    for (const [nombre, s] of Object.entries(servidores)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(nombre)) throw new ErrorConfig(`Perfil ${clave}: servidor ${nombre} inválido.`);
      if (!s || s.type !== 'http' || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) {
        throw new ErrorConfig(`Perfil ${clave}: el servidor ${nombre} debe ser {"type":"http","url":"http(s)://…"}.`);
      }
      if (s.headers !== undefined) {
        throw new ErrorConfig(`Perfil ${clave}: el servidor ${nombre} trae cabeceras; las credenciales no van en perfiles.json.`);
      }
      limpios[nombre] = { type: 'http', url: s.url };
    }
    const herramientas = p.herramientas ?? [];
    if (!Array.isArray(herramientas)) throw new ErrorConfig(`Perfil ${clave}: herramientas debe ser una lista.`);
    for (const h of herramientas) {
      const m = typeof h === 'string' ? /^mcp__([a-zA-Z0-9_-]+)__([a-zA-Z0-9_-]+)$/.exec(h) : null;
      if (!m) throw new ErrorConfig(`Perfil ${clave}: herramienta inválida o con comodín: ${String(h)}.`);
      if (!limpios[m[1]]) throw new ErrorConfig(`Perfil ${clave}: ${h} es de un servidor que el perfil no declara.`);
    }
    perfiles.set(clave, { mcpServers: limpios, herramientas: [...new Set(herramientas)], web: p.web === true });
  }
  if (!perfiles.has('sin-conectores')) {
    // Siempre debe existir el perfil neutro.
    perfiles.set('sin-conectores', { mcpServers: {}, herramientas: [], web: false });
  }
  return perfiles;
}

/** Busca CLAUDE.md en los ancestros: Claude Code los carga solos y contaminarían el hilo. */
export function claudeMdEnAncestros(dir) {
  const encontrados = [];
  let actual = path.resolve(dir);
  for (;;) {
    const padre = path.dirname(actual);
    for (const nombre of ['CLAUDE.md', 'CLAUDE.local.md']) {
      const f = path.join(padre, nombre);
      if (padre !== actual && existsSync(f)) encontrados.push(f);
    }
    if (padre === actual) break;
    actual = padre;
  }
  return encontrados;
}

/**
 * El config dir del `claude -p` es SIEMPRE <HILOS_DIR>/claude-config. Nunca
 * el de un bot: se rechaza un HILOS_DIR dentro de `~/.<bot>/` o de ~/.claude.
 */
export function validarAislamiento(hilosDir, home = homedir()) {
  const abs = path.resolve(hilosDir);
  const rel = path.relative(home, abs);
  const primerSegmento = rel.split(path.sep)[0] ?? '';
  if (rel === '' || abs === path.resolve(home)) {
    throw new ErrorConfig('HILOS_DIR no puede ser la carpeta personal.');
  }
  if (!rel.startsWith('..') && primerSegmento === '.claude') {
    throw new ErrorConfig('HILOS_DIR no puede estar dentro de ~/.claude.');
  }
  if (abs.split(path.sep).includes('claude-config') || abs.split(path.sep).includes('synerlink-channel')) {
    throw new ErrorConfig('HILOS_DIR no puede estar dentro del config de un bot.');
  }
  // `~/.<bot>/…` es la casa de los bots de la flota (horus, play, plan…):
  // solo se admite la carpeta propia del puente, `~/.puente-hilos`.
  if (!rel.startsWith('..') && primerSegmento.startsWith('.') && primerSegmento !== '.puente-hilos') {
    throw new ErrorConfig(`HILOS_DIR no puede estar dentro de ~/${primerSegmento} (posible carpeta de un bot).`);
  }
  return abs;
}

/**
 * Lee SOLO `CLAUDE_CODE_OAUTH_TOKEN` del .env del agente. No devuelve ni
 * registra nada más del archivo, y los errores nunca incluyen su contenido.
 */
export function leerTokenDeEnv(ruta, leer = (r) => readFileSync(r, 'utf8')) {
  let texto;
  try {
    texto = leer(ruta);
  } catch {
    throw new ErrorConfig(`No se pudo leer HILOS_TOKEN_ENV_AGENTE (${ruta}).`);
  }
  for (const cruda of texto.split('\n')) {
    let linea = cruda.trim();
    if (linea.startsWith('export ')) linea = linea.slice(7).trim();
    const igual = linea.indexOf('=');
    if (igual < 0 || linea.slice(0, igual).trim() !== 'CLAUDE_CODE_OAUTH_TOKEN') continue;
    let valor = linea.slice(igual + 1).trim();
    const q = valor[0];
    if ((q === '"' || q === "'") && valor.endsWith(q) && valor.length >= 2) valor = valor.slice(1, -1).trim();
    if (valor) return valor;
  }
  throw new ErrorConfig(`El archivo de HILOS_TOKEN_ENV_AGENTE no trae CLAUDE_CODE_OAUTH_TOKEN.`);
}

export function cargarConfig(env = process.env) {
  const entorno = requerida(env, 'HILOS_ENTORNO');
  if (entorno !== 'pruebas') {
    throw new ErrorConfig('F1: el puente solo corre contra PRUEBAS (HILOS_ENTORNO=pruebas).');
  }

  const url = requerida(env, 'HILOS_SYNERLINK_URL').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new ErrorConfig('HILOS_SYNERLINK_URL debe empezar por http(s)://.');

  const llave = requerida(env, 'HILOS_SYNERLINK_KEY');
  if (llave.length < 32) throw new ErrorConfig('HILOS_SYNERLINK_KEY debe tener al menos 32 caracteres.');

  const agente = requerida(env, 'HILOS_AGENTE').toLowerCase();

  const apiKey = (env.HILOS_ANTHROPIC_API_KEY ?? '').trim();
  const oauthDirecto = (env.HILOS_CLAUDE_CODE_OAUTH_TOKEN ?? '').trim();
  const envAgente = (env.HILOS_TOKEN_ENV_AGENTE ?? '').trim();
  const fuentes = [apiKey, oauthDirecto, envAgente].filter(Boolean).length;
  if (fuentes !== 1) {
    throw new ErrorConfig(
      'Defina EXACTAMENTE una credencial: HILOS_TOKEN_ENV_AGENTE, HILOS_CLAUDE_CODE_OAUTH_TOKEN o HILOS_ANTHROPIC_API_KEY.'
    );
  }
  const oauth = envAgente ? leerTokenDeEnv(envAgente) : oauthDirecto;

  const hilosDir = validarAislamiento(requerida(env, 'HILOS_DIR'));
  const ancestros = claudeMdEnAncestros(hilosDir);
  if (ancestros.length > 0) {
    throw new ErrorConfig(
      `Hay CLAUDE.md por encima de HILOS_DIR (${ancestros.join(', ')}); Claude Code los cargaría en cada hilo. Mueva HILOS_DIR.`
    );
  }

  const rutaPerfiles = requerida(env, 'HILOS_PERFILES');
  let perfilesJson;
  try {
    perfilesJson = JSON.parse(readFileSync(rutaPerfiles, 'utf8'));
  } catch (err) {
    throw new ErrorConfig(`No se pudo leer HILOS_PERFILES: ${err.message}`);
  }
  const perfiles = validarPerfiles(perfilesJson);

  const instruccionesEn = (env.HILOS_INSTRUCCIONES_EN ?? 'system-prompt').trim();
  if (instruccionesEn !== 'system-prompt' && instruccionesEn !== 'claude-md') {
    throw new ErrorConfig("HILOS_INSTRUCCIONES_EN solo admite 'system-prompt' o 'claude-md'.");
  }

  const subagentes = (env.HILOS_SUBAGENTES ?? 'si').trim().toLowerCase();
  if (subagentes !== 'si' && subagentes !== 'no') throw new ErrorConfig("HILOS_SUBAGENTES solo admite 'si' o 'no'.");

  const presupuesto = (env.HILOS_MAX_BUDGET_USD ?? '').trim();
  if (presupuesto && !(Number(presupuesto) > 0)) throw new ErrorConfig('HILOS_MAX_BUDGET_USD debe ser un número positivo.');

  let claudeBin = (env.HILOS_CLAUDE_BIN ?? '').trim() || 'claude';
  if (claudeBin.includes(path.sep)) {
    try {
      claudeBin = realpathSync(claudeBin);
    } catch {
      throw new ErrorConfig(`HILOS_CLAUDE_BIN no existe: ${claudeBin}.`);
    }
  }

  return {
    entorno,
    url,
    llave,
    agente,
    credencial: apiKey ? { tipo: 'api-key', valor: apiKey } : { tipo: 'oauth-token', valor: oauth },
    origenCredencial: apiKey ? 'llave de API' : envAgente ? 'token del propio agente (leído de su .env)' : 'token en el .env del puente',
    hilosDir,
    configClaudeDir: path.join(hilosDir, 'claude-config'),
    perfiles,
    maxConcurrencia: entero(env, 'HILOS_MAX_CONCURRENCIA', MAX_CONCURRENCIA_F1, 1, MAX_CONCURRENCIA_F1),
    timeoutTurnoMs: entero(env, 'HILOS_TIMEOUT_TURNO_MS', 15 * 60 * 1000, 60 * 1000, 60 * 60 * 1000),
    modelo: (env.HILOS_MODELO ?? '').trim() || null,
    presupuestoUsd: presupuesto ? Number(presupuesto) : null,
    subagentes: subagentes === 'si',
    subagentesMaxSimultaneos: entero(env, 'HILOS_SUBAGENTES_MAX_SIMULTANEOS', 3, 1, 5),
    subagentesMaxTurnos: entero(env, 'HILOS_SUBAGENTES_MAX_TURNOS', 30, 5, 100),
    subagentesPresupuestoUsd: numero(env, 'HILOS_SUBAGENTES_PRESUPUESTO_USD', 3, 50),
    sugerenciaPresupuestoUsd: numero(env, 'HILOS_SUGERENCIA_PRESUPUESTO_USD', 0.5, 5),
    sugerenciaTimeoutMs: entero(env, 'HILOS_SUGERENCIA_TIMEOUT_MS', 3 * 60 * 1000, 30 * 1000, 10 * 60 * 1000),
    claudeBin,
    instruccionesEn,
    // Para el entorno del hijo: solo lo indispensable del entorno propio.
    path: env.PATH ?? '/usr/bin:/bin',
    home: env.HOME ?? homedir(),
  };
}
