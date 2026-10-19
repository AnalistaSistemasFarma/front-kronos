/**
 * Lanzamiento de UN turno de `claude -p` para UN hilo.
 *
 * Todo lo que decide la seguridad del proceso del modelo está aquí, en
 * funciones puras con pruebas (test/claude.test.mjs):
 *
 *   - `--restricted`: quita Bash y las demás herramientas que ejecutan código
 *     (WebFetch solo vuelve si el perfil tiene `web`), ignora los settings de usuario/proyecto/local, confina
 *     las herramientas de archivos a la carpeta del hilo y rechaza el modo
 *     bypassPermissions.
 *   - `--permission-mode dontAsk`: lo que no está permitido explícitamente se
 *     NIEGA (no se pregunta: en un proceso sin persona al otro lado, preguntar
 *     es colgarse). NUNCA bypassPermissions ni --dangerously-skip-permissions.
 *   - `--tools` con la lista mínima, `--allowedTools` con nombres exactos y
 *     `--disallowedTools` con las prohibidas, por si acaso.
 *   - `--strict-mcp-config --mcp-config <archivo del hilo>`: solo los
 *     conectores del perfil del proyecto; ninguno heredado.
 *   - `--settings` con el plugin de Telegram APAGADO (gotcha «jobs claude -p
 *     matan el poller de Telegram») y los hooks desactivados.
 *   - ENTORNO LIMPIO: el hijo no hereda el entorno del puente (ni la llave de
 *     SynerLink ni ningún secreto). Recibe solo PATH, HOME, el config dir
 *     AISLADO y UNA credencial del modelo.
 */
import { spawn } from 'node:child_process';
import { HERRAMIENTAS_PROHIBIDAS } from './config.mjs';

/** Herramientas de archivos: lectura libre dentro del hilo, escritura solo en ./trabajo. */
export const HERRAMIENTAS_BASE = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite'];
export const PERMITIDAS_BASE = ['Read', 'Glob', 'Grep', 'TodoWrite', 'Edit(./trabajo/**)', 'Write(./trabajo/**)'];

export const SETTINGS_HIJO = {
  enabledPlugins: { 'telegram@claude-plugins-official': false },
  disableAllHooks: true,
  permissions: { disableBypassPermissionsMode: 'disable' },
};

/**
 * Argumentos del `claude -p`. `sesion` = { id, nueva }: la primera vez se
 * fija el id con --session-id (así el puente lo conoce de antemano); después,
 * --resume con ese mismo id.
 */
export function armarArgumentos({ perfil, sesion, rutaMcp, rutaSistema, dirArchivos, modelo, presupuestoUsd }) {
  if (!perfil) throw new Error('Falta el perfil.');
  if (!sesion?.id || !/^[0-9a-f-]{36}$/i.test(sesion.id)) throw new Error('session id inválido.');

  // Navegación (decisión de Nicolás, 2026-10-17): WebSearch y WebFetch si el perfil tiene `web`.
  const web = perfil.web ? ['WebSearch', 'WebFetch'] : [];
  const tools = [...HERRAMIENTAS_BASE, ...web];
  const permitidas = [...PERMITIDAS_BASE, ...web, ...perfil.herramientas];

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--restricted',
    '--permission-mode',
    'dontAsk',
    '--tools',
    tools.join(','),
    '--allowedTools',
    ...permitidas,
    '--disallowedTools',
    ...HERRAMIENTAS_PROHIBIDAS,
    '--strict-mcp-config',
    '--mcp-config',
    rutaMcp,
    '--settings',
    JSON.stringify(SETTINGS_HIJO),
    '--append-system-prompt-file',
    rutaSistema,
  ];
  if (dirArchivos) args.push('--add-dir', dirArchivos);
  if (sesion.nueva) args.push('--session-id', sesion.id);
  else args.push('--resume', sesion.id);
  if (modelo) args.push('--model', modelo);
  if (presupuestoUsd) args.push('--max-budget-usd', String(presupuestoUsd));

  // Defensa en profundidad: jamás salen estas banderas, se arme como se arme.
  for (const prohibida of ['--dangerously-skip-permissions', 'bypassPermissions', '--continue', '-c']) {
    if (args.includes(prohibida)) throw new Error(`Argumento prohibido: ${prohibida}`);
  }
  return args;
}

/** Entorno del hijo: SOLO lo indispensable. Nada se hereda del puente. */
export function armarEntorno({ path, home, configClaudeDir, credencial }) {
  const env = {
    PATH: path,
    HOME: home,
    LANG: 'es_CO.UTF-8',
    CLAUDE_CONFIG_DIR: configClaudeDir,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  if (credencial.tipo === 'api-key') env.ANTHROPIC_API_KEY = credencial.valor;
  else env.CLAUDE_CODE_OAUTH_TOKEN = credencial.valor;
  return env;
}

/**
 * Revisa el evento `system/init`: si el proceso arrancó con una herramienta
 * prohibida, con permisos abiertos o con un conector que el perfil no
 * declara, el turno se aborta. Devuelve la lista de problemas (vacía = bien).
 */
export function revisarInit(evento, perfil) {
  const problemas = [];
  const herramientas = Array.isArray(evento?.tools) ? evento.tools : [];
  for (const h of herramientas) {
    if (HERRAMIENTAS_PROHIBIDAS.includes(h)) problemas.push(`herramienta prohibida: ${h}`);
  }
  const modo = evento?.permissionMode;
  if (modo === 'bypassPermissions' || modo === 'acceptEdits' || modo === 'auto') {
    problemas.push(`modo de permisos abierto: ${modo}`);
  }
  const permitidos = new Set(Object.keys(perfil.mcpServers));
  for (const s of Array.isArray(evento?.mcp_servers) ? evento.mcp_servers : []) {
    const nombre = typeof s === 'string' ? s : s?.name;
    if (nombre && !permitidos.has(nombre)) problemas.push(`conector no declarado: ${nombre}`);
  }
  return problemas;
}

/** Etiqueta corta y en español para el indicador, a partir de un tool_use. */
export function etiquetaHerramienta(nombre) {
  if (!nombre) return 'Trabajando…';
  if (nombre.startsWith('mcp__')) {
    const [, servidor] = nombre.split('__');
    if (servidor?.startsWith('sap')) return 'Consultando SAP…';
    return `Consultando ${servidor}…`;
  }
  const mapa = {
    Read: 'Leyendo archivos del proyecto…',
    Glob: 'Buscando archivos…',
    Grep: 'Buscando en los archivos…',
    Write: 'Preparando un documento…',
    Edit: 'Editando un documento…',
    WebSearch: 'Buscando en internet…',
    WebFetch: 'Leyendo una página web…',
    TodoWrite: 'Organizando la tarea…',
  };
  return mapa[nombre] ?? 'Trabajando…';
}

/**
 * Acumula los eventos del stream-json en un resumen del turno. Pura: recibe
 * el acumulado y un evento y devuelve el acumulado nuevo.
 */
export function acumularEvento(acc, evento) {
  const out = { ...acc };
  if (evento?.type === 'system' && evento.subtype === 'init') {
    out.init = evento;
    out.sessionId = evento.session_id ?? out.sessionId;
  } else if (evento?.type === 'assistant') {
    out.apiMessages = (out.apiMessages ?? 0) + 1;
    if (evento.parent_tool_use_id) out.apiMessagesSubagents = (out.apiMessagesSubagents ?? 0) + 1;
    const modelo = evento.message?.model;
    if (modelo) out.modelos = [...new Set([...(out.modelos ?? []), modelo])];
    const usos = (evento.message?.content ?? []).filter((c) => c?.type === 'tool_use');
    if (usos.length > 0) out.ultimaHerramienta = usos[usos.length - 1].name;
  } else if (evento?.type === 'result') {
    out.resultado = {
      ok: evento.subtype === 'success' && !evento.is_error,
      texto: typeof evento.result === 'string' ? evento.result : '',
      subtipo: evento.subtype ?? null,
    };
    out.sessionId = evento.session_id ?? out.sessionId;
    const u = evento.usage ?? {};
    out.tokens = {
      input: Number(u.input_tokens ?? 0),
      cacheCreation: Number(u.cache_creation_input_tokens ?? 0),
      cacheRead: Number(u.cache_read_input_tokens ?? 0),
      output: Number(u.output_tokens ?? 0),
    };
    if (evento.modelUsage && typeof evento.modelUsage === 'object') {
      out.modelos = [...new Set([...(out.modelos ?? []), ...Object.keys(evento.modelUsage)])];
    }
    if (typeof evento.total_cost_usd === 'number') out.costoUsd = evento.total_cost_usd;
  }
  return out;
}

/**
 * Corre el proceso y devuelve el resumen del turno. `alEvento` recibe cada
 * evento (para mover el indicador). Mata el proceso si se pasa del tope o si
 * `revisarInit` encuentra un problema.
 */
export function correrTurno({ bin, args, env, cwd, prompt, perfil, timeoutMs, alEvento = () => {}, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    const hijo = spawnImpl(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let acc = { apiMessages: 0, apiMessagesSubagents: 0, modelos: [] };
    let buffer = '';
    let stderr = '';
    let abortado = null;
    let terminado = false;

    const matar = (motivo) => {
      if (abortado) return;
      abortado = motivo;
      try {
        hijo.kill('SIGTERM');
        setTimeout(() => {
          try {
            hijo.kill('SIGKILL');
          } catch {}
        }, 5000).unref?.();
      } catch {}
    };

    // Sin unref: el tope del turno debe mantener vivo el proceso hasta cumplirse.
    const temporizador = setTimeout(() => matar('tiempo agotado'), timeoutMs);

    hijo.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linea = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!linea) continue;
        let evento;
        try {
          evento = JSON.parse(linea);
        } catch {
          continue;
        }
        acc = acumularEvento(acc, evento);
        if (evento.type === 'system' && evento.subtype === 'init') {
          const problemas = revisarInit(evento, perfil);
          if (problemas.length > 0) matar(`arranque inseguro: ${problemas.join('; ')}`);
        }
        try {
          alEvento(evento, acc);
        } catch {}
      }
    });
    hijo.stderr.on('data', (chunk) => {
      // Se guarda acotado: sirve para diagnosticar, no para registrar todo.
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });

    const cerrar = (codigo) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      resolve({ ...acc, codigo, abortado, stderr });
    };
    hijo.on('error', (err) => {
      stderr += `\n${err.message}`;
      cerrar(-1);
    });
    hijo.on('close', (codigo) => cerrar(codigo));

    hijo.stdin.end(prompt);
  });
}
