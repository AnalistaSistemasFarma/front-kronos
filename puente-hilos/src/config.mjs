/**
 * Configuración del PUENTE DE HILOS — se lee del entorno y de perfiles.json,
 * se valida y, ante cualquier duda, FALLA CERRADO (no arranca).
 *
 * Variables (nombres; los valores nunca van al repositorio):
 *   HILOS_ENTORNO              'pruebas' o 'produccion' (2026-10-20, decisión de Nicolás:
 *                              «lo de prod en prod, lo de testing en testing»). Con
 *                              'produccion' se exige además (ver verificarEntorno):
 *                                - URL que NO sea de un servidor de PRUEBAS conocido;
 *                                - HILOS_CONFIRMAR_URL_PRODUCCION idéntica a la URL (doble
 *                                  entrada: no se llega a prod por un copiar/pegar);
 *                                - HILOS_DIR propio de producción (nada de «pruebas» en
 *                                  la ruta) y nunca una carpeta ya usada por otro entorno.
 *                              Cada carpeta queda sellada con su entorno (.entorno.json):
 *                              pruebas y producción nunca comparten estado ni sesiones.
 *   HILOS_SYNERLINK_URL        Base de SynerLink del entorno (p. ej. http://host:puerto).
 *   HILOS_CONFIRMAR_URL_PRODUCCION  Solo producción: la misma URL, escrita otra vez.
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
 *   HILOS_TIMEOUT_TURNO_MS     Tope DURO por turno (por defecto 3600000 = 60 min, que es también el
 *                              máximo; mínimo 1 min). Antes era 15 min: Nicolás Rivera (2026-10-22)
 *                              pidió «el límite de tiempo sí, algo razonable» con supervisión.
 *   HILOS_AVISO_PROGRESO_MS    Cada cuánto el puente publica en el hilo un aviso breve de que
 *                              sigue trabajando (por defecto 600000 = 10 min; 60000 a 1800000;
 *                              0 u «off» lo apaga). El aviso NO reemplaza la respuesta final y
 *                              deja el indicador «trabajando» encendido (ver progreso.mjs).
 *   HILOS_CONTINUAR_AL_AGOTAR  'no' (por defecto) o 'si'. Con 'si', si un turno agota el tiempo
 *                              el puente relanza UNA continuación automática («continúe desde
 *                              donde quedó») sobre la misma sesión antes de rendirse.
 *   HILOS_MODELO               Opcional: modelo del hilo PRINCIPAL del `claude -p` (`--model`),
 *                              por agente (p. ej. claude-opus-5-5 en horus-prod). Sin ella, el
 *                              predeterminado de la cuenta. Los subagentes usan el modelo que
 *                              fijó su equipo (null = heredan este).
 *   HILOS_MAX_BUDGET_USD       Opcional: tope de gasto por turno (`--max-budget-usd`). Vacío = sin
 *                              tope general (con equipo manda HILOS_SUBAGENTES_PRESUPUESTO_USD).
 *                              «0» u «off» = SIN NINGÚN TOPE DE GASTO, ni con equipo: el puente no
 *                              pasa `--max-budget-usd` en los turnos (decisión de Nicolás Rivera,
 *                              2026-10-22: «que no tenga límite de dinero por ahora»). El gasto se
 *                              sigue registrando en consumo.jsonl y en SynerLink como siempre.
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
 *
 *   Acceso al código (nivel 2, 2026-10-20; ver codigo.mjs). Opcional y aditivo:
 *   HILOS_REPOS_POR_PROYECTO         Ruta a repos-por-proyecto.json (repos, proyectos que los
 *                                    usan y operadores que autorizan pases). Se relee en CADA
 *                                    turno: vincular un repo no exige reiniciar el puente.
 *                                    Sin esta variable, ningún proyecto tiene código.
 *   HILOS_GITHUB_TOKEN_ARCHIVO       Archivo (600) con el token de GitHub. Solo entra al proceso
 *                                    del modelo como GH_TOKEN en turnos con código.
 *
 *   Memoria del bot principal (2026-10-20; ver memoria.mjs). Opcional, SOLO LECTURA:
 *   HILOS_MEMORIA_DIR                Ruta absoluta al directorio memory/ del bot (MEMORY.md +
 *                                    archivos). Se copia en cada turno a .puente/memoria del hilo,
 *                                    sin los archivos que parezcan tener secretos.
 *   HILOS_MEMORIA_LECTORES           Correos (coma) cuyos turnos reciben la memoria. Vacío = todos.
 *
 *   Conectores por proyecto (bases en SOLO LECTURA, 2026-10-20; ver conectores.mjs). Opcional:
 *   HILOS_CONECTORES_POR_PROYECTO    Ruta a conectores-por-proyecto.json (conectores MCP que se
 *                                    SUMAN al perfil en proyectos concretos). Se relee en cada turno.
 *   HILOS_CONECTORES_SECRETOS        Archivo 600 con las llaves Bearer de esos conectores; lo lee
 *                                    solo el headersHelper (nunca entra al mcp.json ni al modelo).
 *
 *   Medidor del consumo de Anthropic (2026-10-22; ver cuota.mjs). Opcional:
 *   HILOS_CUOTA                      'si' (por defecto) o 'no'. Publica en SynerLink el cupo semanal
 *                                    y la ventana de 5 h del token (lo que trae el stream del turno).
 *   HILOS_CUOTA_INTERVALO_MS         Sin turnos, cada cuánto se hace la consulta mínima (haiku,
 *                                    max_tokens 1). Por defecto 300000 (5 min); 0 = solo lo del stream.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const MAX_CONCURRENCIA_F1 = 2;

/** Tope duro por turno si el .env no dice otra cosa: 60 min (el máximo admitido). */
export const TIMEOUT_TURNO_DEFECTO_MS = 60 * 60 * 1000;

export const ENTORNOS = ['pruebas', 'produccion'];

/**
 * Servidores de SynerLink de PRUEBAS conocidos (host, cualquier puerto). Un puente
 * de producción que apunte a uno de estos no arranca. La .230 es el servidor de
 * pruebas/testing (y de demos); localhost nunca es producción.
 */
export const HOSTS_PRUEBAS = ['192.168.11.230', 'localhost', '127.0.0.1', '::1', '[::1]'];

/** Archivo que sella una carpeta del puente con su entorno. */
export const ARCHIVO_ENTORNO = '.entorno.json';

/** Rastros de que una carpeta ya la usó un puente (estado, sesiones, hilos, config). */
const RASTROS_DE_USO = ['estado.json', 'proyectos', 'claude-config', 'consumo.jsonl'];

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

function leerSello(hilosDir) {
  const ruta = path.join(hilosDir, ARCHIVO_ENTORNO);
  if (!existsSync(ruta)) return null;
  try {
    const sello = JSON.parse(readFileSync(ruta, 'utf8'));
    if (!sello || typeof sello.entorno !== 'string') throw new Error('sin entorno');
    return sello;
  } catch {
    throw new ErrorConfig(`${ruta} está dañado; no se adivina el entorno de la carpeta.`);
  }
}

/**
 * Protecciones por entorno (fallan cerrado). PRUEBAS conserva el comportamiento
 * de F1; lo único nuevo es que NO arranca sobre una carpeta sellada por otro
 * entorno. PRODUCCIÓN exige URL fuera de PRUEBAS, confirmación de la URL,
 * carpeta propia y nunca reutilizar una carpeta sin sello de producción.
 */
export function verificarEntorno({ entorno, url, hilosDir, confirmacionUrl }) {
  const sello = leerSello(hilosDir);
  if (sello && sello.entorno !== entorno) {
    throw new ErrorConfig(
      `HILOS_DIR (${hilosDir}) es de ${sello.entorno}; este puente es de ${entorno}. Pruebas y producción no comparten carpeta ni sesiones.`
    );
  }
  if (entorno !== 'produccion') return { sello };

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new ErrorConfig('HILOS_SYNERLINK_URL no es una URL válida.');
  }
  if (HOSTS_PRUEBAS.includes(host)) {
    throw new ErrorConfig(`HILOS_ENTORNO=produccion con una URL de PRUEBAS (${host}). Corrija la URL o el entorno.`);
  }
  const confirmada = (confirmacionUrl ?? '').trim().replace(/\/+$/, '');
  if (!confirmada) throw new ErrorConfig('Producción exige HILOS_CONFIRMAR_URL_PRODUCCION (la misma URL, escrita otra vez).');
  if (confirmada !== url) throw new ErrorConfig('HILOS_CONFIRMAR_URL_PRODUCCION no coincide con HILOS_SYNERLINK_URL.');
  if (/pruebas|testing/i.test(hilosDir)) {
    throw new ErrorConfig(`HILOS_DIR de producción no puede ser una carpeta de pruebas (${hilosDir}).`);
  }
  if (sello) {
    if (sello.url !== url) {
      throw new ErrorConfig(`HILOS_DIR quedó sellado para ${sello.url}; no se reutiliza con otra URL.`);
    }
  } else {
    const usados = RASTROS_DE_USO.filter((r) => existsSync(path.join(hilosDir, r)));
    if (usados.length > 0) {
      throw new ErrorConfig(
        `HILOS_DIR ya la usó un puente sin sello de producción (${usados.join(', ')}). Producción arranca en una carpeta nueva.`
      );
    }
  }
  return { sello };
}

/** Sella la carpeta con su entorno (solo producción; idempotente). */
export function sellarEntorno(cfg, ahora = new Date()) {
  if (cfg.entorno !== 'produccion') return false;
  const ruta = path.join(cfg.hilosDir, ARCHIVO_ENTORNO);
  if (existsSync(ruta)) return false;
  writeFileSync(ruta, `${JSON.stringify({ entorno: cfg.entorno, url: cfg.url, agente: cfg.agente, sellado: ahora.toISOString() })}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  return true;
}

export function cargarConfig(env = process.env) {
  const entorno = requerida(env, 'HILOS_ENTORNO');
  if (!ENTORNOS.includes(entorno)) {
    throw new ErrorConfig(`HILOS_ENTORNO solo admite ${ENTORNOS.join(' o ')}.`);
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
  verificarEntorno({ entorno, url, hilosDir, confirmacionUrl: env.HILOS_CONFIRMAR_URL_PRODUCCION });

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

  // «0» u «off»: sin tope de gasto en los turnos (tampoco con equipo).
  const presupuesto = (env.HILOS_MAX_BUDGET_USD ?? '').trim().toLowerCase();
  const sinTopeGasto = presupuesto === 'off' || (presupuesto !== '' && Number(presupuesto) === 0);
  if (presupuesto && !sinTopeGasto && !(Number(presupuesto) > 0)) {
    throw new ErrorConfig('HILOS_MAX_BUDGET_USD debe ser un número positivo, o 0/off para no poner tope de gasto.');
  }

  // Supervisión de turnos largos (progreso.mjs, 2026-10-22).
  const avisoRaw = (env.HILOS_AVISO_PROGRESO_MS ?? '').trim().toLowerCase();
  const avisoProgresoMs = avisoRaw === 'off' || avisoRaw === '0' ? 0 : entero(env, 'HILOS_AVISO_PROGRESO_MS', 10 * 60 * 1000, 60 * 1000, 30 * 60 * 1000);
  const continuar = (env.HILOS_CONTINUAR_AL_AGOTAR ?? 'no').trim().toLowerCase();
  if (continuar !== 'si' && continuar !== 'no') throw new ErrorConfig("HILOS_CONTINUAR_AL_AGOTAR solo admite 'si' o 'no'.");

  for (const v of ['HILOS_REPOS_POR_PROYECTO', 'HILOS_GITHUB_TOKEN_ARCHIVO', 'HILOS_MEMORIA_DIR', 'HILOS_CONECTORES_POR_PROYECTO', 'HILOS_CONECTORES_SECRETOS', 'HILOS_GRAFOS_DIR']) {
    const r = (env[v] ?? '').trim();
    if (r && !path.isAbsolute(r)) throw new ErrorConfig(`${v} debe ser una ruta absoluta.`);
  }

  // Plugins locales (skills) por --plugin-dir, y grafos de Graphify (grafos.mjs). 2026-10-21.
  const pluginDirs = (env.HILOS_PLUGIN_DIRS ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  for (const d of pluginDirs) {
    if (!path.isAbsolute(d)) throw new ErrorConfig('HILOS_PLUGIN_DIRS debe ser una lista de rutas absolutas separadas por coma.');
    if (d.split(path.sep).includes('claude-config')) throw new ErrorConfig('HILOS_PLUGIN_DIRS no puede apuntar al config de un bot.');
    if (!existsSync(path.join(d, '.claude-plugin', 'plugin.json'))) throw new ErrorConfig(`HILOS_PLUGIN_DIRS: ${d} no es un plugin (falta .claude-plugin/plugin.json).`);
  }
  const grafosDir = (env.HILOS_GRAFOS_DIR ?? '').trim() || null;

  // HTML → PDF en el puente (pdf.mjs, 2026-10-21). Encendido por defecto; HILOS_PDF=no lo apaga.
  const pdfModo = (env.HILOS_PDF ?? 'si').trim().toLowerCase();
  if (!['si', 'no'].includes(pdfModo)) throw new ErrorConfig('HILOS_PDF debe ser «si» o «no».');
  const pdfChrome = (env.HILOS_PDF_CHROME ?? '').trim() || null;
  if (pdfChrome && !path.isAbsolute(pdfChrome)) throw new ErrorConfig('HILOS_PDF_CHROME debe ser una ruta absoluta.');

  // Medidor del consumo de Anthropic (cuota.mjs, 2026-10-22). Encendido por defecto.
  const cuotaModo = (env.HILOS_CUOTA ?? 'si').trim().toLowerCase();
  if (!['si', 'no'].includes(cuotaModo)) throw new ErrorConfig('HILOS_CUOTA debe ser «si» o «no».');
  const cuotaIntervaloMs = (env.HILOS_CUOTA_INTERVALO_MS ?? '').trim() === '0' ? 0 : entero(env, 'HILOS_CUOTA_INTERVALO_MS', 5 * 60 * 1000, 60 * 1000, 60 * 60 * 1000);

  // Memoria del bot principal (solo lectura; ver memoria.mjs). Nunca dentro de HILOS_DIR.
  const memoriaDir = (env.HILOS_MEMORIA_DIR ?? '').trim() || null;
  if (memoriaDir && (path.resolve(memoriaDir) + path.sep).startsWith(path.resolve(hilosDir) + path.sep)) {
    throw new ErrorConfig('HILOS_MEMORIA_DIR no puede estar dentro de HILOS_DIR.');
  }
  const memoriaLectores = (env.HILOS_MEMORIA_LECTORES ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (memoriaLectores.some((c) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))) {
    throw new ErrorConfig('HILOS_MEMORIA_LECTORES debe ser una lista de correos separados por coma.');
  }

  // Modelo del hilo PRINCIPAL (por agente, en su .env). Sin la variable, el
  // `claude -p` usa el predeterminado de la cuenta (en 2026-10 era Sonnet 5.5).
  const modelo = (env.HILOS_MODELO ?? '').trim() || null;
  if (modelo && !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/.test(modelo)) {
    throw new ErrorConfig('HILOS_MODELO inválido: use un id o alias de modelo (p. ej. claude-opus-5-5).');
  }

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
    timeoutTurnoMs: entero(env, 'HILOS_TIMEOUT_TURNO_MS', TIMEOUT_TURNO_DEFECTO_MS, 60 * 1000, 60 * 60 * 1000),
    avisoProgresoMs,
    continuarAlAgotar: continuar === 'si',
    modelo,
    presupuestoUsd: presupuesto && !sinTopeGasto ? Number(presupuesto) : null,
    sinTopeGasto,
    subagentes: subagentes === 'si',
    subagentesMaxSimultaneos: entero(env, 'HILOS_SUBAGENTES_MAX_SIMULTANEOS', 3, 1, 5),
    subagentesMaxTurnos: entero(env, 'HILOS_SUBAGENTES_MAX_TURNOS', 30, 5, 100),
    subagentesPresupuestoUsd: numero(env, 'HILOS_SUBAGENTES_PRESUPUESTO_USD', 3, 50),
    sugerenciaPresupuestoUsd: numero(env, 'HILOS_SUGERENCIA_PRESUPUESTO_USD', 0.5, 5),
    sugerenciaTimeoutMs: entero(env, 'HILOS_SUGERENCIA_TIMEOUT_MS', 3 * 60 * 1000, 30 * 1000, 10 * 60 * 1000),
    claudeBin,
    instruccionesEn,
    rutaReposPorProyecto: (env.HILOS_REPOS_POR_PROYECTO ?? '').trim() || null,
    githubTokenArchivo: (env.HILOS_GITHUB_TOKEN_ARCHIVO ?? '').trim() || null,
    memoriaDir,
    memoriaLectores,
    pluginDirs,
    grafosDir,
    pdf: { habilitado: pdfModo === 'si', chrome: pdfChrome, timeoutMs: entero(env, 'HILOS_PDF_TIMEOUT_MS', 60 * 1000, 10 * 1000, 3 * 60 * 1000) },
    cuota: { habilitada: cuotaModo === 'si', intervaloMs: cuotaIntervaloMs },
    rutaConectoresPorProyecto: (env.HILOS_CONECTORES_POR_PROYECTO ?? '').trim() || null,
    conectoresSecretos: (env.HILOS_CONECTORES_SECRETOS ?? '').trim() || null,
    // Para el entorno del hijo: solo lo indispensable del entorno propio.
    path: env.PATH ?? '/usr/bin:/bin',
    home: env.HOME ?? homedir(),
  };
}
