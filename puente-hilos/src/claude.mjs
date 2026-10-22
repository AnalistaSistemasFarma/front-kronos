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
import { entornoTopes, HERRAMIENTAS_SUBAGENTE, revisarAgentesInit } from './equipo.mjs';

/** Herramientas de archivos: lectura libre dentro del hilo, escritura solo en ./trabajo. */
export const HERRAMIENTAS_BASE = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite'];
export const PERMITIDAS_BASE = ['Read', 'Glob', 'Grep', 'TodoWrite', 'Edit(./trabajo/**)', 'Write(./trabajo/**)'];

/** Única herramienta prohibida que se habilita en un turno con código (con reglas y sandbox). */
export const HERRAMIENTAS_CODIGO = ['Bash'];

export const SETTINGS_HIJO = {
  enabledPlugins: { 'telegram@claude-plugins-official': false },
  disableAllHooks: true,
  permissions: { disableBypassPermissionsMode: 'disable' },
  // Sin memoria automática nativa: la memoria del agente llega en solo lectura
  // desde el puente (memoria.mjs) y los proyectos no guardan memoria propia.
  autoMemoryEnabled: false,
};

/**
 * Argumentos del `claude -p`. `sesion` = { id, nueva }: la primera vez se
 * fija el id con --session-id (así el puente lo conoce de antemano); después,
 * --resume con ese mismo id.
 */
export function armarArgumentos({ perfil, sesion, rutaMcp, rutaSistema, dirArchivos, modelo, presupuestoUsd, equipo = null, codigo = null, plugins = null }) {
  if (!perfil) throw new Error('Falta el perfil.');
  if (!sesion?.id || !/^[0-9a-f-]{36}$/i.test(sesion.id)) throw new Error('session id inválido.');

  // Navegación (decisión de Nicolás, 2026-10-17): WebSearch y WebFetch si el perfil tiene `web`.
  const web = perfil.web ? ['WebSearch', 'WebFetch'] : [];
  // Equipo de subagentes (F2, 2026-10-18): la herramienta Agent SOLO con el
  // equipo aprobado (`Agent(<slug>)`), y los agentes incorporados negados uno
  // por uno. Sin equipo, Agent/Task siguen prohibidas como en la F1.
  // Acceso al código (nivel 2, 2026-10-20): Bash SOLO con las reglas de
  // codigo.mjs (git/gh/npm/npx/node) y dentro del sandbox de Claude Code.
  // Skills (2026-10-21): en --restricted solo entran por --plugin-dir; con plugins, la herramienta Skill.
  const skill = plugins?.dirs?.length ? ['Skill'] : [];
  const tools = [...HERRAMIENTAS_BASE, ...web, ...skill, ...(equipo ? equipo.tools : []), ...(codigo ? codigo.tools : [])];
  const permitidas = [...PERMITIDAS_BASE, ...web, ...skill, ...perfil.herramientas, ...(equipo ? equipo.permitidas : []), ...(codigo ? codigo.permitidas : [])];
  const exentas = [...(equipo ? HERRAMIENTAS_SUBAGENTE : []), ...(codigo ? HERRAMIENTAS_CODIGO : [])];
  const prohibidas = [
    ...HERRAMIENTAS_PROHIBIDAS.filter((h) => !exentas.includes(h)),
    ...(equipo ? equipo.prohibidas : []),
    ...(codigo ? codigo.prohibidas : []),
  ];
  // Sin sandbox SOLO con terminal completa (turno de operador en un proyecto con la bandera).
  if (codigo && !codigo.sandbox?.enabled && codigo.terminalCompleta !== true) throw new Error('Turno con código sin sandbox: no se arma.');
  if (codigo && !codigo.hooks?.PreToolUse?.length) throw new Error('Turno con código sin el hook de subagentes: no se arma.');
  // Con código: sandbox y el ÚNICO hook (subagentes solo git de lectura); nada más.
  const settings = codigo ? { ...SETTINGS_HIJO, disableAllHooks: false, hooks: codigo.hooks ?? {}, sandbox: codigo.sandbox } : SETTINGS_HIJO;

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
    ...prohibidas,
    '--strict-mcp-config',
    '--mcp-config',
    rutaMcp,
    '--settings',
    JSON.stringify(settings),
    '--append-system-prompt-file',
    rutaSistema,
  ];
  if (dirArchivos) args.push('--add-dir', dirArchivos);
  for (const d of codigo?.dirsExtra ?? []) args.push('--add-dir', d);
  // Grafos de Graphify en solo lectura (Edit/Write siguen confinados a ./trabajo y ./codigo).
  for (const d of plugins?.dirsLectura ?? []) args.push('--add-dir', d);
  for (const d of plugins?.dirs ?? []) args.push('--plugin-dir', d);
  if (sesion.nueva) args.push('--session-id', sesion.id);
  else args.push('--resume', sesion.id);
  if (modelo) args.push('--model', modelo);
  if (presupuestoUsd) args.push('--max-budget-usd', String(presupuestoUsd));
  if (equipo) args.push(...equipo.extra);

  // Defensa en profundidad: jamás salen estas banderas, se arme como se arme.
  for (const prohibida of ['--dangerously-skip-permissions', 'bypassPermissions', '--continue', '-c']) {
    if (args.includes(prohibida)) throw new Error(`Argumento prohibido: ${prohibida}`);
  }
  return args;
}

/**
 * Argumentos del `claude -p` que SUGIERE el equipo de un proyecto. Sin ninguna
 * herramienta (`--tools ""`), sin conectores, sin sesión guardada y con salida
 * estructurada validada por esquema: el modelo solo puede devolver el JSON.
 */
export function armarArgumentosSugerencia({ rutaMcp, esquema, modelo, presupuestoUsd }) {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--restricted',
    '--permission-mode',
    'dontAsk',
    '--tools',
    '',
    '--disallowedTools',
    ...HERRAMIENTAS_PROHIBIDAS,
    '--strict-mcp-config',
    '--mcp-config',
    rutaMcp,
    '--settings',
    JSON.stringify(SETTINGS_HIJO),
    '--no-session-persistence',
    '--json-schema',
    JSON.stringify(esquema),
  ];
  if (modelo) args.push('--model', modelo);
  if (presupuestoUsd) args.push('--max-budget-usd', String(presupuestoUsd));
  for (const prohibida of ['--dangerously-skip-permissions', 'bypassPermissions', '--continue', '-c', '--resume']) {
    if (args.includes(prohibida)) throw new Error(`Argumento prohibido: ${prohibida}`);
  }
  return args;
}

/**
 * Entorno del hijo: SOLO lo indispensable. Nada se hereda del puente. Los
 * topes de subagentes van SIEMPRE (sin equipo, Agent está prohibida y el tope
 * queda en 1 por si acaso).
 */
export function armarEntorno({ path, home, configClaudeDir, credencial }, topes = null, extraCodigo = null) {
  const env = {
    PATH: path,
    HOME: home,
    LANG: 'es_CO.UTF-8',
    CLAUDE_CONFIG_DIR: configClaudeDir,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    // Cada comando de Bash vuelve a la carpeta del hilo: un `cd codigo/<repo>` no
    // persiste y no rompe las reglas relativas de Edit/Write (gotcha del 2026-10-21).
    CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
    // Graphify SIEMPRE local: sin esto autodetecta llaves de proveedores o cae a `claude -p`.
    GRAPHIFY_BACKEND: 'none',
    GRAPHIFY_QUERY_LOG_DISABLE: '1',
    ...entornoTopes(topes),
  };
  // Turno con código: GH_TOKEN, HOME propio (home-codigo) y avisos de gh/npm apagados.
  if (extraCodigo) Object.assign(env, extraCodigo);
  if (credencial.tipo === 'api-key') env.ANTHROPIC_API_KEY = credencial.valor;
  else env.CLAUDE_CODE_OAUTH_TOKEN = credencial.valor;
  return env;
}

/**
 * Revisa el evento `system/init`: si el proceso arrancó con una herramienta
 * prohibida, con permisos abiertos o con un conector que el perfil no
 * declara, el turno se aborta. Devuelve la lista de problemas (vacía = bien).
 */
export function revisarInit(evento, perfil, equipo = null, codigo = null) {
  const problemas = [];
  const herramientas = Array.isArray(evento?.tools) ? evento.tools : [];
  for (const h of herramientas) {
    // Con equipo aprobado, la herramienta de subagentes es la única excepción.
    if (equipo && HERRAMIENTAS_SUBAGENTE.includes(h)) continue;
    // Con código vinculado, Bash (con sus reglas y el sandbox).
    if (codigo && HERRAMIENTAS_CODIGO.includes(h)) continue;
    if (HERRAMIENTAS_PROHIBIDAS.includes(h)) problemas.push(`herramienta prohibida: ${h}`);
  }
  if (equipo) problemas.push(...revisarAgentesInit(evento, equipo));
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
    Bash: 'Ejecutando comandos…',
    Skill: 'Usando una skill…',
    Agent: 'Repartiendo el trabajo entre el equipo…',
    Task: 'Repartiendo el trabajo entre el equipo…',
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
    const contenido = Array.isArray(evento.message?.content) ? evento.message.content : [];
    const usos = contenido.filter((c) => c?.type === 'tool_use');
    if (usos.length > 0) out.ultimaHerramienta = usos[usos.length - 1].name;
    // Para los avisos de progreso y el mensaje de corte (progreso.mjs): el último texto
    // del hilo PRINCIPAL (lo de los subagentes no) y los archivos que tocó con Write/Edit.
    if (!evento.parent_tool_use_id) {
      const textos = contenido.filter((c) => c?.type === 'text' && typeof c.text === 'string' && c.text.trim());
      if (textos.length > 0) out.ultimoTexto = textos[textos.length - 1].text.trim().slice(-2000);
    }
    const tocados = usos
      .filter((u) => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(u.name))
      .map((u) => u.input?.file_path ?? u.input?.notebook_path)
      .filter((f) => typeof f === 'string' && f);
    if (tocados.length > 0) out.archivosTocados = [...new Set([...(out.archivosTocados ?? []), ...tocados])].slice(-50);
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
      // `usage` es SOLO del hilo principal; `modelUsage` suma también a los
      // subagentes (verificado en 2.1.299). Si trae más, manda `modelUsage`.
      const suma = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
      for (const mu of Object.values(evento.modelUsage)) {
        if (!mu || typeof mu !== 'object') continue;
        suma.input += Number(mu.inputTokens ?? 0) || 0;
        suma.cacheCreation += Number(mu.cacheCreationInputTokens ?? 0) || 0;
        suma.cacheRead += Number(mu.cacheReadInputTokens ?? 0) || 0;
        suma.output += Number(mu.outputTokens ?? 0) || 0;
      }
      const total = (t) => t.input + t.cacheCreation + t.cacheRead + t.output;
      if (total(suma) > total(out.tokens)) {
        out.tokensPrincipal = out.tokens;
        out.tokens = suma;
      }
    }
    if (evento.structured_output !== undefined) out.salidaEstructurada = evento.structured_output;
    if (typeof evento.total_cost_usd === 'number') out.costoUsd = evento.total_cost_usd;
  }
  return out;
}

/**
 * Corre el proceso y devuelve el resumen del turno. `alEvento` recibe cada
 * evento (para mover el indicador). Mata el proceso si se pasa del tope o si
 * `revisarInit` encuentra un problema.
 */
export function correrTurno({ bin, args, env, cwd, prompt, perfil, equipo = null, codigo: accesoCodigo = null, vigia = null, timeoutMs, alEvento = () => {}, spawnImpl = spawn }) {
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
          const problemas = revisarInit(evento, perfil, equipo, accesoCodigo);
          if (problemas.length > 0) matar(`arranque inseguro: ${problemas.join('; ')}`);
        }
        // Vigía del equipo: un subagente fuera de lo aprobado detiene el turno.
        if (vigia) {
          const violaciones = vigia.procesar(evento);
          if (violaciones.length > 0) matar(`subagente fuera de lo aprobado: ${violaciones.join('; ')}`);
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
