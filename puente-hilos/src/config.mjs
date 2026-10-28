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
 *   Perfil del agente (2026-10-26; ver perfil-agente.mjs):
 *   HILOS_PERFIL                     'desarrollo' (por defecto) o 'negocio'. Con 'negocio' el contexto de
 *                                    código no se activa nunca (ni repos, ni codigo/, ni guía, ni Graphify,
 *                                    ni skills de revisión de código) y se rechazan las variables de código.
 *   HILOS_ENFOQUE                    Opcional, una línea (máx. 400): el rol del agente de negocio (p. ej.
 *                                    «comercio exterior y compras internacionales»). Va en el encabezado.
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
 *   PRUEBAS para todos los hilos (2026-10-22; ver pruebas-kronos.mjs). Encendido por defecto:
 *   HILOS_PRUEBAS_KRONOS             'si' (por defecto) o 'no'. Conectores kronos-pruebas-sql (lectura y
 *                                    escritura SOLO en KRONOSDB_PRUEBAS) y synerlink-testing-web (testing
 *                                    como usuario QA) en TODOS los proyectos. Credenciales: clave
 *                                    «kronos-pruebas» de HILOS_CONECTORES_SECRETOS.
 *   HILOS_PRUEBAS_KRONOS_WEB         Web de testing (por defecto http://192.168.11.230:3030; debe ser un
 *                                    host de HOSTS_PRUEBAS).
 *
 *   Archivos del proyecto (2026-10-23; ver archivar-proyecto.mjs). Encendido por defecto:
 *   HILOS_ARCHIVAR_EN_PROYECTO       'si' (por defecto) o 'no'. Cada adjunto de la respuesta (MEDIA:/PDF:)
 *                                    se sube además a la pestaña Archivos del proyecto.
 *
 *   Modo Orus completo (2026-10-22, orden de Nicolás Rivera; ver orus-completo.mjs). Opcional:
 *   HILOS_AUTORES_ORUS_COMPLETO      Correos (coma). Los turnos cuyos mensajes son TODOS de uno de ellos
 *                                    (identidad del servidor) corren con las capacidades del Orus
 *                                    principal en CUALQUIER proyecto. Vacío = apagado.
 *   HILOS_ORUS_COMPLETO_CONFIG_DIR   Config del Orus principal (~/.horus/claude-config): de ahí se LEEN sus
 *                                    MCP en cada turno. El turno sigue con el config aislado del puente.
 *   HILOS_ORUS_COMPLETO_ENV          .env del principal para resolver ${VAR} de sus MCP (no se imprime).
 *   HILOS_ORUS_COMPLETO_PLUGIN       Plugin con TODAS las skills del principal (cambia al «orus» saneado).
 *   HILOS_ORUS_COMPLETO_EXCLUIR      Servidores del principal que no entran (además de synerlink/-prod).
 *
 *   Conectores del agente (2026-10-22, orden de Nicolás Rivera; ver conectores-agente.mjs). Opcional:
 *   HILOS_CONECTORES_AGENTE_CONFIG_DIR  Config dir del bot vivo (p. ej. ~/.play/claude-config): en cada
 *                                    turno se LEEN sus MCP (usuario, proyecto de su carpeta y plugins
 *                                    habilitados, sin synerlink/-prod ni Telegram) y se suman al perfil,
 *                                    en todos los proyectos. El turno sigue con el config aislado.
 *   HILOS_CONECTORES_AGENTE_PROYECTO    Carpeta de trabajo del bot (su vault): elige los MCP de proyecto.
 *   HILOS_CONECTORES_AGENTE_ENV         .env del bot para resolver ${VAR} (no se imprime).
 *   HILOS_CONECTORES_AGENTE_EXCLUIR     Servidores del agente que no entran (coma).
 *   HILOS_CONECTORES_AGENTE_ENGRAM_PROYECTO  Proyecto de engram de su chat (por defecto: el repo git de
 *                                    HILOS_CONECTORES_AGENTE_PROYECTO). Así el hilo lee y guarda en su misma memoria.
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
import { MAX_ENFOQUE, PERFILES_AGENTE, PERFIL_POR_DEFECTO, VARIABLES_SOLO_DESARROLLO } from './perfil-agente.mjs';

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

/** Runners del turno: `claude -p` (por defecto) u openclaw (2026-10-27). */
export const RUNNERS = ['claude', 'openclaw'];

/**
 * Variables que SUMAN capacidades al turno de Claude Code. Con el runner openclaw NO se admiten:
 * el agente trabaja con sus propias herramientas y permisos, sin ampliarlos (auditoría de Iván).
 */
export const VARIABLES_NO_OPENCLAW = [
  'HILOS_AUTORES_ORUS_COMPLETO',
  'HILOS_ORUS_COMPLETO_CONFIG_DIR',
  'HILOS_CONECTORES_AGENTE_CONFIG_DIR',
  'HILOS_CONECTORES_POR_PROYECTO',
  'HILOS_CONECTORES_SECRETOS',
  'HILOS_PLUGIN_DIRS',
  'HILOS_MEMORIA_DIR',
  'HILOS_GRAFOS_DIR',
  'HILOS_REPOS_POR_PROYECTO',
  'HILOS_GITHUB_TOKEN_ARCHIVO',
  'HILOS_MODELO',
  'HILOS_MAX_BUDGET_USD',
];

/**
 * Configuración del runner openclaw (openclaw.mjs). Falla cerrado.
 *   HILOS_OPENCLAW_BIN             binario (por defecto /opt/homebrew/bin/openclaw)
 *   HILOS_OPENCLAW_AGENTE          id del agente en openclaw (p. ej. duo; Lunaris = main)
 *   HILOS_OPENCLAW_PERFIL          perfil de openclaw (p. ej. lunaris); vacío = instalación compartida
 *   HILOS_OPENCLAW_LOCAL           'si' = --local (sin Gateway; 1 hilo a la vez)
 *   HILOS_OPENCLAW_SESION_PREFIJO  por defecto `proyecto-<entorno>-`; nunca `synerlink…` (es el del chat)
 *   HILOS_OPENCLAW_OUTBOX          outbox del chat del agente (opcional): lo que deje ahí se recoge
 *   HILOS_OPENCLAW_AREA            dónde van proyectos/<id>/… (por defecto HILOS_DIR)
 *   HILOS_OPENCLAW_ACTIVIDAD       'si' (por defecto) o 'no': indicador fino por el Gateway
 *   HILOS_OPENCLAW_RECURSOS        carpetas de solo lectura para los PDF (marca: gss-design, olp-design), separadas por coma
 *   HILOS_OPENCLAW_CUOTA           'si' (por defecto) o 'no': cupo semanal/5 h con la credencial del agente en openclaw
 *   HILOS_OPENCLAW_DIR_AGENTE      carpeta del agente en openclaw (por defecto <estado>/agents/<agente>/agent)
 */
export function configOpenclaw(env, { entorno, hilosDir, perfiles, perfilAgente, pruebasModo, cuotaModo, pdfModo, subagentes }) {
  if (perfilAgente !== 'negocio') throw new ErrorConfig('HILOS_RUNNER=openclaw exige HILOS_PERFIL=negocio (sin código).');
  const sobran = VARIABLES_NO_OPENCLAW.filter((v) => (env[v] ?? '').trim());
  if (sobran.length) throw new ErrorConfig(`HILOS_RUNNER=openclaw no suma capacidades al agente: quite ${sobran.join(', ')} del .env.`);
  const explicitas = [
    ['HILOS_PRUEBAS_KRONOS', pruebasModo],
    ['HILOS_CUOTA', cuotaModo],
    ['HILOS_SUBAGENTES', subagentes],
  ].filter(([v, modo]) => (env[v] ?? '').trim() && modo === 'si');
  if (explicitas.length) throw new ErrorConfig(`Con HILOS_RUNNER=openclaw quedan apagados: ${explicitas.map(([v]) => v).join(', ')} (ponga «no» o quítelos).`);
  for (const [clave, p] of perfiles) {
    if (Object.keys(p.mcpServers).length || p.herramientas.length || p.web) {
      throw new ErrorConfig(`Con HILOS_RUNNER=openclaw los perfiles no llevan conectores ni web (el agente usa los suyos): revise «${clave}» en perfiles.json.`);
    }
  }
  const bin = (env.HILOS_OPENCLAW_BIN ?? '').trim() || '/opt/homebrew/bin/openclaw';
  if (!path.isAbsolute(bin)) throw new ErrorConfig('HILOS_OPENCLAW_BIN debe ser una ruta absoluta.');
  if (!existsSync(bin)) throw new ErrorConfig(`HILOS_OPENCLAW_BIN no existe: ${bin}.`);
  const agente = (env.HILOS_OPENCLAW_AGENTE ?? '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(agente)) throw new ErrorConfig('Falta HILOS_OPENCLAW_AGENTE (id del agente en openclaw, p. ej. duo).');
  const perfil = (env.HILOS_OPENCLAW_PERFIL ?? '').trim() || null;
  if (perfil && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(perfil)) throw new ErrorConfig('HILOS_OPENCLAW_PERFIL inválido.');
  const localRaw = (env.HILOS_OPENCLAW_LOCAL ?? 'no').trim().toLowerCase();
  if (!['si', 'no'].includes(localRaw)) throw new ErrorConfig('HILOS_OPENCLAW_LOCAL debe ser «si» o «no».');
  const actRaw = (env.HILOS_OPENCLAW_ACTIVIDAD ?? 'si').trim().toLowerCase();
  if (!['si', 'no'].includes(actRaw)) throw new ErrorConfig('HILOS_OPENCLAW_ACTIVIDAD debe ser «si» o «no».');
  const prefijo = (env.HILOS_OPENCLAW_SESION_PREFIJO ?? '').trim() || `proyecto-${entorno}-`;
  if (!/^[a-z0-9][a-z0-9-]{0,40}-$/.test(prefijo)) throw new ErrorConfig('HILOS_OPENCLAW_SESION_PREFIJO: minúsculas, números y guiones, terminado en «-».');
  if (/^synerlink/.test(prefijo)) throw new ErrorConfig('HILOS_OPENCLAW_SESION_PREFIJO no puede empezar por «synerlink»: es el espacio de sesiones del chat del agente.');
  if ((entorno === 'pruebas') !== /pruebas|testing/.test(prefijo)) throw new ErrorConfig(`HILOS_OPENCLAW_SESION_PREFIJO debe decir de qué entorno es (${entorno}): pruebas y producción no comparten sesiones.`);
  const ruta = (nombre) => {
    const v = (env[nombre] ?? '').trim() || null;
    if (v && !path.isAbsolute(v)) throw new ErrorConfig(`${nombre} debe ser una ruta absoluta.`);
    return v ? path.resolve(v) : null;
  };
  const outbox = ruta('HILOS_OPENCLAW_OUTBOX');
  const area = ruta('HILOS_OPENCLAW_AREA') ?? hilosDir;
  if (outbox && (area + path.sep).startsWith(outbox + path.sep)) throw new ErrorConfig('HILOS_OPENCLAW_AREA no puede estar dentro del outbox del agente.');
  // Recursos de SOLO LECTURA para los PDF (p. ej. gss-design/recursos u olp-design): datos de marca, no herramientas.
  const recursos = (env.HILOS_OPENCLAW_RECURSOS ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  for (const d of recursos) {
    if (!path.isAbsolute(d)) throw new ErrorConfig('HILOS_OPENCLAW_RECURSOS debe ser una lista de rutas absolutas separadas por coma.');
    if (!existsSync(d)) throw new ErrorConfig(`HILOS_OPENCLAW_RECURSOS: ${d} no existe.`);
  }
  // Cupo de Anthropic del agente (2026-10-28): sonda con la credencial que el agente tiene en
  // openclaw (openclaw/credencial.mjs, solo lectura). Encendido por defecto; HILOS_CUOTA sigue
  // siendo el medidor de Claude Code y con openclaw debe quedar en «no».
  const cuotaRaw = (env.HILOS_OPENCLAW_CUOTA ?? 'si').trim().toLowerCase();
  if (!['si', 'no'].includes(cuotaRaw)) throw new ErrorConfig('HILOS_OPENCLAW_CUOTA debe ser «si» o «no».');
  const dirAgente = ruta('HILOS_OPENCLAW_DIR_AGENTE');
  return { bin, agente, perfil, local: localRaw === 'si', actividad: actRaw === 'si', prefijo, outbox, area, recursos: recursos.map((d) => path.resolve(d)), cuota: cuotaRaw === 'si', dirAgente };
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

  // Runner del turno (2026-10-27): `claude` (por defecto, `claude -p`) u `openclaw` (openclaw.mjs).
  const runner = (env.HILOS_RUNNER ?? '').trim().toLowerCase() || 'claude';
  if (!RUNNERS.includes(runner)) throw new ErrorConfig(`HILOS_RUNNER solo admite ${RUNNERS.join(' u ')}.`);

  const apiKey = (env.HILOS_ANTHROPIC_API_KEY ?? '').trim();
  const oauthDirecto = (env.HILOS_CLAUDE_CODE_OAUTH_TOKEN ?? '').trim();
  const envAgente = (env.HILOS_TOKEN_ENV_AGENTE ?? '').trim();
  const fuentes = [apiKey, oauthDirecto, envAgente].filter(Boolean).length;
  if (runner === 'openclaw') {
    const sobran = VARIABLES_NO_OPENCLAW.filter((v) => (env[v] ?? '').trim());
    if (sobran.length) throw new ErrorConfig(`HILOS_RUNNER=openclaw no suma capacidades al agente: quite ${sobran.join(', ')} del .env.`);
  }
  if (runner === 'openclaw' && fuentes > 0) {
    throw new ErrorConfig('Con HILOS_RUNNER=openclaw no se define credencial de Anthropic: el agente usa la suya (models auth de openclaw).');
  }
  if (runner === 'claude' && fuentes !== 1) {
    throw new ErrorConfig(
      'Defina EXACTAMENTE una credencial: HILOS_TOKEN_ENV_AGENTE, HILOS_CLAUDE_CODE_OAUTH_TOKEN o HILOS_ANTHROPIC_API_KEY.'
    );
  }
  const oauth = runner === 'claude' && envAgente ? leerTokenDeEnv(envAgente) : oauthDirecto;

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

  // Perfil del agente (perfil-agente.mjs, 2026-10-26). Por defecto «desarrollo»: nada cambia.
  const perfilAgente = (env.HILOS_PERFIL ?? '').trim().toLowerCase() || PERFIL_POR_DEFECTO;
  if (!PERFILES_AGENTE.includes(perfilAgente)) throw new ErrorConfig(`HILOS_PERFIL solo admite ${PERFILES_AGENTE.join(' o ')}.`);
  if (perfilAgente === 'negocio') {
    const sobran = VARIABLES_SOLO_DESARROLLO.filter((v) => (env[v] ?? '').trim());
    if (sobran.length) throw new ErrorConfig(`HILOS_PERFIL=negocio no lleva código: quite ${sobran.join(', ')} del .env (o use HILOS_PERFIL=desarrollo).`);
  }
  const enfoque = (env.HILOS_ENFOQUE ?? '').trim() || null;
  if (enfoque && (enfoque.length > MAX_ENFOQUE || /[\r\n`]/.test(enfoque))) throw new ErrorConfig(`HILOS_ENFOQUE debe ser una sola línea de máximo ${MAX_ENFOQUE} caracteres, sin comillas invertidas.`);

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

  // PRUEBAS para todos los hilos (pruebas-kronos.mjs, 2026-10-22). Encendido por defecto.
  const pruebasModo = (env.HILOS_PRUEBAS_KRONOS ?? 'si').trim().toLowerCase();
  if (!['si', 'no'].includes(pruebasModo)) throw new ErrorConfig('HILOS_PRUEBAS_KRONOS debe ser «si» o «no».');
  const pruebasWeb = (env.HILOS_PRUEBAS_KRONOS_WEB ?? 'http://192.168.11.230:3030').trim();
  {
    let u;
    try {
      u = new URL(pruebasWeb);
    } catch {
      throw new ErrorConfig('HILOS_PRUEBAS_KRONOS_WEB no es una URL válida.');
    }
    if (!HOSTS_PRUEBAS.includes(u.hostname) || u.pathname !== '/' || u.username || u.search) throw new ErrorConfig('HILOS_PRUEBAS_KRONOS_WEB debe ser la web de PRUEBAS (host de HOSTS_PRUEBAS, sin ruta).');
  }
  // HTML → PDF en el puente (pdf.mjs, 2026-10-21). Encendido por defecto; HILOS_PDF=no lo apaga.
  const pdfModo = (env.HILOS_PDF ?? 'si').trim().toLowerCase();
  if (!['si', 'no'].includes(pdfModo)) throw new ErrorConfig('HILOS_PDF debe ser «si» o «no».');
  const pdfChrome = (env.HILOS_PDF_CHROME ?? '').trim() || null;
  if (pdfChrome && !path.isAbsolute(pdfChrome)) throw new ErrorConfig('HILOS_PDF_CHROME debe ser una ruta absoluta.');

  // Archivar en los Archivos del proyecto lo que el hilo adjunta (archivar-proyecto.mjs, 2026-10-23). Encendido por defecto.
  const archivarModo = (env.HILOS_ARCHIVAR_EN_PROYECTO ?? 'si').trim().toLowerCase();
  if (!['si', 'no'].includes(archivarModo)) throw new ErrorConfig('HILOS_ARCHIVAR_EN_PROYECTO debe ser «si» o «no».');
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

  // Modo Orus completo (orus-completo.mjs, 2026-10-22). Sin autores, apagado.
  const autoresCompleto = (env.HILOS_AUTORES_ORUS_COMPLETO ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  let orusCompleto = null;
  if (autoresCompleto.length) {
    if (autoresCompleto.some((c) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))) throw new ErrorConfig('HILOS_AUTORES_ORUS_COMPLETO debe ser una lista de correos separados por coma.');
    const configDir = (env.HILOS_ORUS_COMPLETO_CONFIG_DIR ?? '').trim();
    if (!configDir || !path.isAbsolute(configDir)) throw new ErrorConfig('Con HILOS_AUTORES_ORUS_COMPLETO hace falta HILOS_ORUS_COMPLETO_CONFIG_DIR (ruta absoluta al config del Orus principal).');
    if (!existsSync(path.join(configDir, '.claude.json'))) throw new ErrorConfig(`HILOS_ORUS_COMPLETO_CONFIG_DIR (${configDir}) no tiene .claude.json.`);
    // Se LEE el config del principal para armar el mcp.json; el turno nunca corre con él (sigue el aislado).
    if (path.resolve(configDir) === path.resolve(hilosDir, 'claude-config')) throw new ErrorConfig('HILOS_ORUS_COMPLETO_CONFIG_DIR no puede ser el config aislado del puente.');
    const envArchivo = (env.HILOS_ORUS_COMPLETO_ENV ?? '').trim() || null;
    if (envArchivo && !path.isAbsolute(envArchivo)) throw new ErrorConfig('HILOS_ORUS_COMPLETO_ENV debe ser una ruta absoluta.');
    const plugin = (env.HILOS_ORUS_COMPLETO_PLUGIN ?? '').trim() || null;
    if (plugin && (!path.isAbsolute(plugin) || !existsSync(path.join(plugin, '.claude-plugin', 'plugin.json')))) throw new ErrorConfig('HILOS_ORUS_COMPLETO_PLUGIN debe ser la ruta absoluta de un plugin (con .claude-plugin/plugin.json).');
    const excluir = (env.HILOS_ORUS_COMPLETO_EXCLUIR ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    orusCompleto = { autores: autoresCompleto, configDir, envArchivo, plugin, excluir };
  }

  // Conectores del agente (conectores-agente.mjs, 2026-10-22). Sin la variable, apagado.
  let conectoresAgente = null;
  const caDir = (env.HILOS_CONECTORES_AGENTE_CONFIG_DIR ?? '').trim();
  if (caDir) {
    if (!path.isAbsolute(caDir)) throw new ErrorConfig('HILOS_CONECTORES_AGENTE_CONFIG_DIR debe ser una ruta absoluta (config dir del bot).');
    if (!existsSync(path.join(caDir, '.claude.json'))) throw new ErrorConfig(`HILOS_CONECTORES_AGENTE_CONFIG_DIR (${caDir}) no tiene .claude.json.`);
    // Se LEE el config del bot para armar el mcp.json; el turno nunca corre con él (sigue el aislado).
    if (path.resolve(caDir) === path.resolve(hilosDir, 'claude-config')) throw new ErrorConfig('HILOS_CONECTORES_AGENTE_CONFIG_DIR no puede ser el config aislado del puente.');
    const rutaOpcional = (nombre) => {
      const v = (env[nombre] ?? '').trim() || null;
      if (v && !path.isAbsolute(v)) throw new ErrorConfig(`${nombre} debe ser una ruta absoluta.`);
      return v;
    };
    conectoresAgente = {
      configDir: caDir,
      proyectoDir: rutaOpcional('HILOS_CONECTORES_AGENTE_PROYECTO'),
      envArchivo: rutaOpcional('HILOS_CONECTORES_AGENTE_ENV'),
      excluir: (env.HILOS_CONECTORES_AGENTE_EXCLUIR ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      engramProyecto: (env.HILOS_CONECTORES_AGENTE_ENGRAM_PROYECTO ?? '').trim() || null,
    };
    if (conectoresAgente.engramProyecto && !/^[A-Za-z0-9._-]{1,100}$/.test(conectoresAgente.engramProyecto)) {
      throw new ErrorConfig('HILOS_CONECTORES_AGENTE_ENGRAM_PROYECTO solo admite letras, números, punto, guion y guion bajo.');
    }
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

  const openclaw = runner === 'openclaw' ? configOpenclaw(env, { entorno, hilosDir, perfiles, perfilAgente, pruebasModo, cuotaModo, pdfModo, subagentes }) : null;

  return {
    entorno,
    url,
    llave,
    agente,
    runner,
    openclaw,
    // Dónde van proyectos/<id>/… (openclaw: HILOS_OPENCLAW_AREA; si no, HILOS_DIR).
    areaDir: openclaw?.area ?? hilosDir,
    credencial: runner === 'openclaw' ? null : apiKey ? { tipo: 'api-key', valor: apiKey } : { tipo: 'oauth-token', valor: oauth },
    origenCredencial: runner === 'openclaw' ? 'la del agente en openclaw (el puente no la ve)' : apiKey ? 'llave de API' : envAgente ? 'token del propio agente (leído de su .env)' : 'token en el .env del puente',
    hilosDir,
    configClaudeDir: path.join(hilosDir, 'claude-config'),
    perfiles,
    // --local de openclaw (Lunaris): un hilo a la vez, para no chocar con el candado de su perfil.
    maxConcurrencia: openclaw?.local ? 1 : entero(env, 'HILOS_MAX_CONCURRENCIA', MAX_CONCURRENCIA_F1, 1, MAX_CONCURRENCIA_F1),
    timeoutTurnoMs: entero(env, 'HILOS_TIMEOUT_TURNO_MS', TIMEOUT_TURNO_DEFECTO_MS, 60 * 1000, 60 * 60 * 1000),
    avisoProgresoMs,
    continuarAlAgotar: continuar === 'si',
    modelo,
    presupuestoUsd: presupuesto && !sinTopeGasto ? Number(presupuesto) : null,
    sinTopeGasto,
    subagentes: subagentes === 'si' && runner === 'claude',
    subagentesMaxSimultaneos: entero(env, 'HILOS_SUBAGENTES_MAX_SIMULTANEOS', 3, 1, 5),
    subagentesMaxTurnos: entero(env, 'HILOS_SUBAGENTES_MAX_TURNOS', 30, 5, 100),
    subagentesPresupuestoUsd: numero(env, 'HILOS_SUBAGENTES_PRESUPUESTO_USD', 3, 50),
    sugerenciaPresupuestoUsd: numero(env, 'HILOS_SUGERENCIA_PRESUPUESTO_USD', 0.5, 5),
    sugerenciaTimeoutMs: entero(env, 'HILOS_SUGERENCIA_TIMEOUT_MS', 3 * 60 * 1000, 30 * 1000, 10 * 60 * 1000),
    claudeBin,
    instruccionesEn,
    perfilAgente,
    enfoque,
    rutaReposPorProyecto: (env.HILOS_REPOS_POR_PROYECTO ?? '').trim() || null,
    githubTokenArchivo: (env.HILOS_GITHUB_TOKEN_ARCHIVO ?? '').trim() || null,
    memoriaDir,
    memoriaLectores,
    pluginDirs,
    grafosDir,
    // PDF también con openclaw (decisión de Nicolás Rivera, 2026-10-27: «sí, claro, con todos»).
    pdf: { habilitado: pdfModo === 'si', chrome: pdfChrome, timeoutMs: entero(env, 'HILOS_PDF_TIMEOUT_MS', 60 * 1000, 10 * 1000, 3 * 60 * 1000) },
    cuota: { habilitada: runner === 'claude' ? cuotaModo === 'si' : openclaw.cuota, intervaloMs: cuotaIntervaloMs },
    archivarEnProyecto: archivarModo === 'si',
    rutaConectoresPorProyecto: (env.HILOS_CONECTORES_POR_PROYECTO ?? '').trim() || null,
    conectoresSecretos: (env.HILOS_CONECTORES_SECRETOS ?? '').trim() || null,
    pruebasKronos: { habilitado: pruebasModo === 'si' && runner === 'claude', base: new URL(pruebasWeb).origin },
    orusCompleto,
    conectoresAgente,
    // Para el entorno del hijo: solo lo indispensable del entorno propio.
    path: env.PATH ?? '/usr/bin:/bin',
    home: env.HOME ?? homedir(),
  };
}
