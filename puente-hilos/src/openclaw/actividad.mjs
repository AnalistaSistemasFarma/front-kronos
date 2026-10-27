// Copia de migrar-agente-synerlink/assets/openclaw/openclaw-actividad.mjs (commit 0ca3493), sin cambios.
// Indicador fino del turno por el Gateway de openclaw. Ver src/openclaw.mjs.
/**
 * Indicador de actividad fino para el puente SynerLink ⇄ openclaw.
 *
 * QUÉ RESUELVE
 * ------------
 * El puente corre `openclaw agent --json`, que solo devuelve el resultado al
 * final: mientras el turno corre, SynerLink no sabría qué hace el agente. Este
 * módulo observa el turno EN VIVO por el Gateway de openclaw y traduce lo que
 * pasa a etiquetas en español ("📖 Leyendo informe.xlsx (Read)…"), las mismas
 * que publican los hooks de horus en Claude Code.
 *
 * POR QUÉ EL GATEWAY Y NO OTRA COSA (comprobado el 2026-10-07)
 * ------------------------------------------------------------
 * - `openclaw agent --json` no emite nada por stdout/stderr hasta el final,
 *   ni siquiera con `--verbose on`.
 * - Los hooks PreToolUse de ~/.claude/settings.json solo existen cuando el
 *   runtime es el Claude CLI. Duo corre en el runtime de Codex/OpenAI y ahí no
 *   se disparan; además el proceso `claude` que lanza openclaw no recibe la
 *   clave de sesión, así que no hay forma limpia de saber a qué conversación
 *   pertenece cada llamada.
 * - Leer transcripts o SQLite mientras corre es sondear formatos internos que
 *   cambian entre versiones, con retraso, y sin saber qué turno es cuál.
 * - El Gateway, en cambio, difunde a los suscriptores pasivos:
 *     · `session.tool` (vía `sessions.subscribe`): cada herramienta con su
 *       nombre y sus argumentos YA SANEADOS por openclaw (redactStringsDeep),
 *       para cualquier runtime (Claude CLI, embebido, Codex);
 *     · los eventos `agent` de la sesión (vía `sessions.messages.subscribe`):
 *       ciclo de vida, modelo, cambio de modelo por falla, reintentos, plan,
 *       redacción de la respuesta.
 *   Todo trae `sessionKey`, `agentId` y `runId`: la correlación con la
 *   conversación es EXACTA, porque la clave de sesión la elige el propio puente.
 *
 * SEGURIDAD
 * ---------
 * Nunca se publican resultados de herramientas. De los argumentos solo se toma
 * un resumen (nombre de archivo, comando, entidad, búsqueda), que además pasa
 * por `sanear()` para quitar llaves, tokens, contraseñas y credenciales en URL.
 *
 * Fallar aquí NUNCA debe tumbar el turno: todo error se registra y el puente
 * sigue con el indicador básico.
 */

import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// Tope de la columna `label` en chat_agent_status (NVarChar(200)).
export const MAX_ETIQUETA = 190

// ── Saneamiento ─────────────────────────────────────────────────────────────

/**
 * Quita secretos de un texto que se va a mostrar. Se aplica a TODO detalle que
 * salga de los argumentos de una herramienta, aunque openclaw ya los sanee: el
 * indicador lo ve cualquiera que tenga la conversación abierta.
 */
export function sanear(texto) {
  if (texto === undefined || texto === null) return ''
  let s = String(texto)
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  // Credenciales dentro de una URL: https://usuario:clave@host
  s = s.replace(/(\/\/)[^/\s:@]+:[^@\s/]+@/g, '$1***@')
  // Encabezados y asignaciones típicas: Authorization: Bearer x, token=x, "password": "x"
  s = s.replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ***')
  s = s.replace(
    /((?:authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|secret|token|password|passwd|pwd|contrase(?:n|ñ)a|clave)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    '$1***',
  )
  // Banderas de línea de comando: --password x, -p x (solo las de nombre claro)
  s = s.replace(/(--?(?:password|passwd|pass|token|secret|api-key|apikey|key)(?:=|\s+))\S+/gi, '$1***')
  // Variables de entorno con nombre de secreto: FOO_TOKEN=abc
  s = s.replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASS|PASSWORD|PWD)[A-Z0-9_]*)=\S+/g, '$1=***')
  // Parámetros de URL con nombre sensible: ?sig=..&token=..
  s = s.replace(/([?&][^=&\s]*(?:token|key|sig|secret|pass|code|auth)[^=&\s]*=)[^&\s]+/gi, '$1***')
  // Llaves con prefijo conocido y JWT
  s = s.replace(/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AKIA)[-_A-Za-z0-9]{10,}/g, '***')
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, '***')
  // Cadenas opacas largas (hash, llave, token sin prefijo) que mezclan letras y
  // dígitos. Se respetan las rutas: un segmento con "/" no es un token.
  s = s.replace(/[A-Za-z0-9+_=-]{32,}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? '***' : m))
  return s.replace(/\s+/g, ' ').trim()
}

/** Corta a `n` caracteres sin partir un emoji (pares sustitutos). */
export function recortar(texto, n) {
  const s = String(texto ?? '')
  const chars = Array.from(s)
  if (chars.length <= n) return s
  return `${chars.slice(0, Math.max(1, n - 1)).join('').trimEnd()}…`
}

/** Saneado y recortado: lo único que se permite pasar a una etiqueta. */
function dato(texto, n) {
  return recortar(sanear(texto), n)
}

function primero(args, claves) {
  if (!args || typeof args !== 'object') return ''
  for (const c of claves) {
    const v = args[c]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return ''
}

function archivo(args) {
  const ruta = primero(args, ['file_path', 'path', 'filePath', 'file', 'notebook_path', 'filename', 'target'])
  return ruta ? basename(ruta) : ''
}

/** Host + ruta de una URL, sin query ni credenciales. */
function sitio(url) {
  try {
    const u = new URL(url)
    const ruta = u.pathname && u.pathname !== '/' ? u.pathname : ''
    return `${u.host}${ruta}`
  } catch {
    return String(url ?? '').split(/[?#]/)[0]
  }
}

/** Primer archivo que toca un parche (apply_patch de Codex/openclaw). */
function archivoDelParche(args) {
  const txt = primero(args, ['input', 'patch', 'diff'])
  const m = /\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/.exec(txt)
  return m ? basename(m[1].trim()) : ''
}

// ── Nombres de herramientas ─────────────────────────────────────────────────

/**
 * Separa `mcp__<servidor>__<tool>` en sus partes. El servidor propio de
 * openclaw (`mcp__openclaw__web_search`) se trata como herramienta nativa.
 */
export function partirNombre(nombre) {
  const n = String(nombre ?? '').trim()
  const m = /^mcp__([^_].*?)__(.+)$/.exec(n)
  if (!m) return { servidor: '', tool: n }
  if (m[1] === 'openclaw') return { servidor: '', tool: m[2] }
  return { servidor: m[1], tool: m[2] }
}

/** Nombre presentable de la empresa a partir del nombre del servidor MCP. */
export function empresaDe(servidor) {
  const s = String(servidor ?? '').toLowerCase()
  if (s.includes('farmalogica')) return 'Farmalógica'
  if (s.includes('onelatampharma') || /(^|[-_])olp([-_]|$)/.test(s)) return 'OLP'
  if (s.includes('ryan')) return 'Ryan'
  if (s.includes('abamia')) return 'Abamia'
  if (s.includes('meditrack')) return 'Meditrack'
  if (s.includes('kelab')) return 'Kelab'
  if (s.includes('unidossis')) return 'UNIDOSSIS'
  if (/(^|[-_])gss([-_]|$)/.test(s)) return 'GSS'
  return ''
}

const RE_SUBAGENTE = /^(agent|task|sessions_spawn|spawn_agent|subagents?)$/i

/** ¿Esta herramienta lanza un sub-agente? */
export function esSubagente(nombre) {
  return RE_SUBAGENTE.test(partirNombre(nombre).tool)
}

/** Descripción corta del trabajo de un sub-agente, para la tablita. */
export function descripcionSubagente(args) {
  return dato(primero(args, ['description', 'label', 'title', 'task', 'prompt', 'message']), 60) || 'trabajo'
}

/**
 * Etiqueta en español para una herramienta. Formato:
 *   "<emoji> <qué hace>[: <detalle>] (<herramienta>)…"
 * El detalle es técnico a propósito (archivo, comando, entidad, búsqueda): lo
 * pidió Nicolás el 2026-10-07 ("toda la información, así sea más técnica,
 * nos ayuda"). Devuelve '' para herramientas que no se anuncian.
 */
export function etiquetaHerramienta(nombre, args = {}) {
  const { servidor, tool } = partirNombre(nombre)
  const t = tool.toLowerCase()
  const marca = servidor ? tool : tool
  const con = (frase, detalle) => {
    const d = detalle ? `: ${detalle}` : ''
    return recortar(`${frase}${d} (${marca})…`, MAX_ETIQUETA)
  }

  if (servidor) return etiquetaMcp(servidor, tool, args)

  switch (t) {
    case 'read':
    case 'view':
    case 'open_file':
      return con('📖 Leyendo', dato(archivo(args), 80) || 'un archivo')
    case 'write':
      return con('📝 Escribiendo', dato(archivo(args), 80) || 'un archivo')
    case 'edit':
    case 'multiedit':
    case 'notebookedit':
      return con('✏️ Editando', dato(archivo(args), 80) || 'un archivo')
    case 'apply_patch':
      return con('✏️ Aplicando cambios', dato(archivoDelParche(args), 80))
    case 'bash':
    case 'exec':
    case 'shell':
    case 'terminal':
    case 'process':
    case 'gateway_process': {
      const cmd = dato(primero(args, ['command', 'cmd', 'script']), 90)
      const desc = dato(primero(args, ['description']), 70)
      if (desc && cmd) return con(`⚙️ ${desc}`, cmd)
      if (desc) return con(`⚙️ ${desc}`)
      return con('⚙️ Ejecutando comando', cmd)
    }
    case 'code_execution':
      return con('🧪 Ejecutando código')
    case 'grep':
      return con('🔍 Buscando en archivos', dato(primero(args, ['pattern', 'query']), 70))
    case 'glob':
      return con('🔍 Buscando archivos', dato(primero(args, ['pattern']), 70))
    case 'web_search':
    case 'websearch':
      return con('🌐 Buscando en la web', dato(primero(args, ['query', 'q']), 80))
    case 'web_fetch':
    case 'webfetch':
      return con('🌐 Abriendo página', dato(sitio(primero(args, ['url'])), 90))
    case 'browser': {
      const accion = dato(primero(args, ['action', 'kind']), 30)
      const url = dato(sitio(primero(args, ['url', 'targetUrl'])), 80)
      return con('🧭 Usando el navegador', [accion, url].filter(Boolean).join(' '))
    }
    case 'memory_search':
      return con('🧠 Consultando la memoria', dato(primero(args, ['query']), 80))
    case 'memory_get':
      return con('🧠 Leyendo la memoria', dato(archivo(args), 60))
    case 'sessions_list':
    case 'sessions_history':
    case 'sessions_search':
    case 'conversations_list':
    case 'transcripts':
      return con('🗂️ Revisando conversaciones anteriores')
    case 'agent':
    case 'task':
    case 'sessions_spawn':
    case 'spawn_agent':
    case 'subagents':
    case 'subagent':
      return con('🤖 Delegando a sub-agente', descripcionSubagente(args))
    case 'agents_wait':
    case 'taskoutput':
      return con('🤖 Esperando a los sub-agentes')
    case 'sessions_send':
    case 'conversations_send':
    case 'sendmessage':
      return con('📨 Hablando con otro agente')
    case 'message':
      return con('📨 Enviando un mensaje', dato(primero(args, ['channel', 'target']), 40))
    case 'cron':
      return con('⏰ Programando una tarea')
    case 'todowrite':
    case 'progress_card':
    case 'update_goal':
    case 'create_goal':
      return con('📋 Organizando las tareas')
    case 'image':
    case 'view_image':
      return con('🖼️ Revisando una imagen', dato(archivo(args), 60))
    case 'pdf':
      return con('📄 Revisando un PDF', dato(archivo(args), 60))
    case 'image_generate':
    case 'video_generate':
    case 'music_generate':
    case 'tts':
      return con('🎨 Generando contenido')
    case 'skill':
      return con('🎯 Usando la habilidad', dato(primero(args, ['skill', 'name']), 50))
    case 'toolsearch':
      return con('🧰 Cargando herramientas')
    case 'monitor':
      return con('👀 Vigilando un proceso')
    default:
      return con('🛠️ Usando una herramienta')
  }
}

/** Entidad/objeto que consulta una herramienta de SAP u otro conector. */
function objetoConsultado(args) {
  return primero(args, ['entity', 'entitySet', 'resource', 'object', 'view', 'viewName', 'table', 'path', 'endpoint', 'list', 'listName'])
}

function etiquetaMcp(servidor, tool, args) {
  const s = servidor.toLowerCase()
  const empresa = empresaDe(servidor)
  const deEmpresa = empresa ? ` de ${empresa}` : ''
  const con = (frase, detalle) => recortar(`${frase}${detalle ? `: ${detalle}` : ''} (${tool})…`, MAX_ETIQUETA)
  const objeto = dato(objetoConsultado(args), 60)

  if (/^(synerlink|synerlink-prod)$/.test(s)) return '' // el propio canal no se anuncia
  if (s.startsWith('sapsend')) return con(`💸 Consultando SAPSEND${deEmpresa}`, objeto)
  if (s.startsWith('sap')) return con(`🧾 Consultando SAP${deEmpresa}`, objeto)
  if (s.includes('kronos') || s.includes('synerlink')) return con('🗂️ Consultando SynerLink', objeto)
  if (s.startsWith('sharepoint')) return con(`📁 Consultando SharePoint${deEmpresa}`, objeto)
  if (s === 'outlook' && tool.startsWith('teams_')) return con('💬 Revisando Teams')
  if (s === 'outlook' || s.includes('mail')) return con('📧 Revisando el correo')
  if (s === 'teams') return con('💬 Escribiendo por Teams')
  if (s.includes('sentry')) return con('🐞 Revisando Sentry')
  if (s.includes('playwright') || s.includes('browser')) return con('🧭 Navegando en el explorador')
  if (s.includes('engram') || s.includes('memory')) return con('🧠 Consultando la memoria')
  if (s.includes('n8n')) return con('🔁 Revisando una automatización')
  return con(`🔌 Consultando ${dato(servidor, 40)}`, objeto)
}

// ── Eventos que no son herramientas ─────────────────────────────────────────

const TIPOS_CODEX = {
  commandexecution: '⚙️ Ejecutando un comando…',
  filechange: '✏️ Editando archivos…',
  mcptoolcall: '🔌 Usando un conector…',
  websearch: '🌐 Buscando en la web…',
  reasoning: '🧠 Razonando…',
  agentmessage: '✍️ Redactando la respuesta…',
}

/**
 * Traduce un evento `agent` de la sesión (stream + data) a un estado, o null si
 * no amerita cambiar el indicador. Las herramientas NO pasan por aquí: llegan
 * por `session.tool` y las atiende el observador.
 */
export function estadoDeEvento(stream, data = {}) {
  switch (stream) {
    case 'lifecycle':
      if (data.phase === 'model' && data.model) {
        return { state: 'thinking', label: `🧠 Pensando su respuesta (${dato(data.model, 40)})…`, tipo: 'modelo' }
      }
      if (data.phase === 'fallback' && data.activeModel) {
        const antes = dato(data.selectedModel, 40)
        const motivo = dato(data.reasonSummary, 30)
        return {
          state: 'thinking',
          label: recortar(`🔁 ${antes || 'El modelo principal'} falló${motivo ? ` (${motivo})` : ''}; sigo con ${dato(data.activeModel, 40)}…`, MAX_ETIQUETA),
          tipo: 'modelo',
        }
      }
      return null
    case 'run_status':
      if (data.phase === 'retrying') return { state: 'thinking', label: '🔁 Reintentando la conexión con el modelo…', tipo: 'reintento' }
      return null
    case 'thinking':
      return { state: 'thinking', label: '🧠 Razonando…', tipo: 'razonando' }
    case 'assistant':
      return { state: 'thinking', label: '✍️ Redactando la respuesta…', tipo: 'redactando' }
    case 'plan': {
      if (data.phase !== 'update' || !Array.isArray(data.steps)) return null
      const actual = data.steps.find((p) => p?.status === 'in_progress')
      if (!actual) return null
      const texto = dato(actual.step ?? actual.description ?? actual.title, 120)
      if (!texto) return null
      const hechos = data.steps.filter((p) => p?.status === 'completed').length
      return { state: 'thinking', label: recortar(`📋 ${texto} (${hechos}/${data.steps.length})`, MAX_ETIQUETA), tipo: 'plan' }
    }
    case 'codex_app_server.item': {
      if (data.phase !== 'started') return null
      const label = TIPOS_CODEX[String(data.type ?? '').toLowerCase()]
      return label ? { state: label.startsWith('🧠') || label.startsWith('✍️') ? 'thinking' : 'tool', label, tipo: 'codex' } : null
    }
    default:
      return null
  }
}

// ── Observador ──────────────────────────────────────────────────────────────

/** Ruta del SDK del Gateway a partir del binario de openclaw. */
export function rutaSdk(openclawBin) {
  if (process.env.OPENCLAW_SDK_PATH) return process.env.OPENCLAW_SDK_PATH
  try {
    // /opt/homebrew/bin/openclaw → …/node_modules/openclaw/openclaw.mjs
    const real = realpathSync(openclawBin)
    return join(dirname(real), 'dist', 'plugin-sdk', 'gateway-runtime.js')
  } catch {
    return '/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/gateway-runtime.js'
  }
}

/**
 * Se suscribe a la sesión del turno y publica lo que va pasando.
 *
 * @param {object} o
 * @param {string} o.agentId        id del agente de openclaw
 * @param {string} o.sessionKey     clave completa: agent:<id>:<prefijo><conversación>
 * @param {number} o.conversationId conversación de SynerLink
 * @param {(conv, state, label, tasks?) => Promise} o.publicar
 * @param {(msg: string) => void} [o.log]
 * @returns {Promise<{armar(): void, cerrar(): Promise<void>, conectado: boolean, usoTareas(): boolean, tareas(): object[]}>}
 */
export async function observarActividad({
  agentId,
  sessionKey,
  conversationId,
  publicar,
  log = () => {},
  openclawBin = '/opt/homebrew/bin/openclaw',
  gatewayUrl = `ws://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || 18789}`,
  Client,
  connectTimeoutMs = 4000,
  minIntervalMs = 800,
  esperaAnalisisMs = 1500,
  latidoMs = 15_000,
  ahora = () => Date.now(),
}) {
  let cliente
  let conectado = false
  let armado = false
  let cerrado = false
  let claveCanonica = sessionKey
  let runAceptado = null
  let ultimoSeq = 0

  // Herramientas en curso (toolCallId → {etiqueta, inicio, sub}) y sub-agentes
  // para la tablita (toolCallId → {desc, startedAt}).
  const enCurso = new Map()
  const subagentes = new Map()
  let huboTareas = false
  let contexto = '' // plan o titular vigente: no se pierde por una herramienta puntual
  let actual = null // { state, label, desde }
  let ultimoPublicado = null // { state, label, tasks }
  let ultimoEnvio = 0
  let pendiente = null
  let reloj = null
  let enviando = null
  let latido = null
  let inicioTurno = 0
  let vistos = new Set() // toolCallId:fase, para no repetir el mismo evento
  // "Analizando el resultado" se aplaza: si enseguida arranca otra herramienta,
  // nunca se publica y la etiqueta de la herramienta alcanza a verse.
  let relojAnalisis = null

  const tareasJson = () =>
    [...subagentes.values()].map((t) => ({ desc: t.desc, startedAt: t.startedAt }))

  const programar = () => {
    if (cerrado || reloj || enviando || !pendiente) return
    const espera = Math.max(0, minIntervalMs - (ahora() - ultimoEnvio))
    reloj = setTimeout(vaciar, espera)
  }

  function vaciar() {
    reloj = null
    if (enviando || cerrado || !pendiente) return
    const sig = pendiente
    pendiente = null
    enviando = (async () => {
      try {
        await publicar(conversationId, sig.state, sig.label, sig.tasks)
        ultimoPublicado = sig
        ultimoEnvio = ahora()
      } catch (err) {
        log(`actividad: no se pudo publicar: ${err.message}`)
      }
    })().finally(() => { enviando = null; programar() })
  }

  /** Encola el estado; si es igual al último publicado, no se reenvía. */
  function enviar(state, label, { forzar = false } = {}) {
    if (!armado || cerrado || !label) return
    const tasks = tareasJson()
    if (tasks.length > 0) huboTareas = true
    const sig = { state, label: recortar(label, MAX_ETIQUETA), tasks: huboTareas ? tasks : undefined }
    const igual = (a) => a && a.state === sig.state && a.label === sig.label &&
      JSON.stringify(a.tasks ?? null) === JSON.stringify(sig.tasks ?? null)
    if (!forzar && (igual(pendiente) || (!pendiente && igual(ultimoPublicado)))) return
    pendiente = sig
    programar()
  }

  /** Fija la actividad vigente y la publica. */
  function mostrar(state, label) {
    // La misma actividad repetida (p. ej. varios reintentos seguidos) conserva
    // su hora de inicio: el latido debe contar desde la primera vez.
    if (!(actual && actual.state === state && actual.label === label)) actual = { state, label, desde: ahora() }
    enviar(state, componer(label))
  }

  /** Antepone el plan vigente y anexa los sub-agentes, como hace horus. */
  function componer(label) {
    let s = label
    if (contexto && !label.startsWith('📋')) s = `${recortar(contexto, 90)} · ${label}`
    if (subagentes.size > 0 && !label.startsWith('🤖')) {
      const nombres = [...subagentes.values()].map((t) => t.desc).join(' · ')
      s = `${s}  ·  🤖 ${subagentes.size === 1 ? 'Sub-agente' : `${subagentes.size} en paralelo`}: ${nombres}`
    }
    return recortar(s, MAX_ETIQUETA)
  }

  /** ¿El evento es de NUESTRO turno? Fija el runId con el primero que llega. */
  function esNuestro(payload) {
    if (!armado || cerrado || !payload) return false
    if (payload.sessionKey !== claveCanonica && payload.sessionKey !== sessionKey) return false
    if (payload.agentId && payload.agentId !== agentId) return false
    const runId = typeof payload.runId === 'string' ? payload.runId : ''
    if (!runId) return false
    if (!runAceptado) runAceptado = runId
    return runAceptado === runId
  }

  function alHerramienta(payload) {
    const d = payload.data ?? {}
    const id = String(d.toolCallId ?? '')
    const fase = String(d.phase ?? '')
    if (!id || (fase !== 'start' && fase !== 'result')) return
    const marca = `${id}:${fase}`
    if (vistos.has(marca)) return
    vistos.add(marca)

    if (fase === 'start') {
      clearTimeout(relojAnalisis)
      relojAnalisis = null
      const sub = esSubagente(d.name)
      if (sub) {
        subagentes.set(id, { desc: descripcionSubagente(d.args), startedAt: Math.floor(ahora() / 1000) })
      }
      let etiqueta = etiquetaHerramienta(d.name, d.args)
      if (!etiqueta) return
      // Herramienta usada DENTRO de un sub-agente: se dice de cuál.
      const padre = d.parentToolCallId ? subagentes.get(String(d.parentToolCallId)) : null
      if (padre) etiqueta = `🤖 ${recortar(padre.desc, 40)} → ${etiqueta}`
      enCurso.set(id, { etiqueta, inicio: ahora() })
      mostrar('tool', etiqueta)
      return
    }

    // fase === 'result'
    const tool = partirNombre(d.name).tool
    const enSegundoPlano = d.args?.run_in_background === true || /^sessions_spawn$/i.test(tool)
    if (subagentes.has(id) && !enSegundoPlano) subagentes.delete(id)
    enCurso.delete(id)
    if (enCurso.size > 0) {
      const ultimo = [...enCurso.values()].pop()
      mostrar('tool', ultimo.etiqueta)
    } else {
      clearTimeout(relojAnalisis)
      relojAnalisis = setTimeout(() => {
        relojAnalisis = null
        if (enCurso.size === 0) mostrar('thinking', `🧠 Analizando el resultado (${dato(tool, 40)})…`)
      }, esperaAnalisisMs)
      relojAnalisis.unref?.()
    }
  }

  let yaRedacta = false
  let yaRazona = false
  function alEventoAgente(payload) {
    if (Number.isInteger(payload.seq)) {
      if (payload.seq <= ultimoSeq) return
      ultimoSeq = payload.seq
    }
    const stream = payload.stream
    if (stream === 'tool') return alHerramienta(payload) // por si llega por aquí
    const est = estadoDeEvento(stream, payload.data ?? {})
    if (!est) return
    // Cualquier avance real deja sin efecto el "Analizando…" aplazado.
    if (est.tipo !== 'plan') { clearTimeout(relojAnalisis); relojAnalisis = null }
    if (est.tipo === 'plan') {
      contexto = est.label
      return enviar(est.state, componer(actual?.label ?? est.label))
    }
    // Lo que no es herramienta no pisa una herramienta en curso.
    if (enCurso.size > 0 && est.tipo !== 'modelo') return
    if (est.tipo === 'redactando') {
      if (yaRedacta) return
      yaRedacta = true
    } else {
      yaRedacta = false
    }
    if (est.tipo === 'razonando') {
      if (yaRazona) return
      yaRazona = true
    }
    mostrar(est.state, est.label)
  }

  function alTitular(payload) {
    const t = dato(payload.headline, 120)
    if (!t) return
    contexto = `🧭 ${t}`
    enviar('thinking', componer(actual?.label ?? contexto))
  }

  function alFrame(frame) {
    const ev = frame?.event
    const p = frame?.payload
    if (!p) return
    if (ev === 'session.tool') {
      if (esNuestro(p)) alHerramienta(p)
    } else if (ev === 'agent') {
      if (esNuestro(p)) alEventoAgente(p)
    } else if (ev === 'session.observer') {
      if (esNuestro(p)) alTitular(p)
    }
  }

  try {
    const Ctor = Client ?? (await import(rutaSdk(openclawBin))).GatewayClient
    let resolver
    const listo = new Promise((r) => { resolver = r })
    let resuelto = false
    const terminar = (v) => { if (!resuelto) { resuelto = true; resolver(v) } }
    cliente = new Ctor({
      url: gatewayUrl,
      clientName: 'cli',
      mode: 'cli',
      scopes: ['operator.read'],
      onEvent: (frame) => {
        try { alFrame(frame) } catch (err) { log(`actividad: evento ignorado: ${err.message}`) }
      },
      onHelloOk: async () => {
        try {
          // Herramientas con argumentos: llegan a los suscriptores globales de
          // sesiones como `session.tool` (incluye todas las sesiones; se filtra
          // por sessionKey/agentId/runId en esNuestro()).
          await cliente.request('sessions.subscribe', {})
          // Ciclo de vida, modelo, plan y redacción de ESTA sesión.
          const r = await cliente.request('sessions.messages.subscribe', { key: sessionKey, agentId })
          // 2026.9.3 no devuelve agentId; 2026.9.8 sí. Solo se exige la clave.
          if (r?.key) claveCanonica = r.key
          terminar(true)
        } catch (err) {
          log(`actividad: suscripción no disponible: ${err.message}`)
          terminar(false)
        }
      },
      onConnectError: (err) => { log(`actividad: Gateway no disponible: ${err.message}`); terminar(false) },
      onClose: () => { conectado = false; terminar(false) },
    })
    cliente.start()
    const t = setTimeout(() => terminar(false), connectTimeoutMs)
    conectado = await listo
    clearTimeout(t)
  } catch (err) {
    log(`actividad: observador no disponible: ${err.message}`)
    conectado = false
  }
  if (!conectado) { try { cliente?.stop() } catch {} }

  return {
    get conectado() { return conectado },
    usoTareas: () => huboTareas,
    // Sub-agentes que siguen en la tablita al cerrar el turno (los lanzados en
    // segundo plano con sessions_spawn no se quitan con su resultado).
    tareas: () => tareasJson(),
    armar() {
      armado = true
      inicioTurno = ahora()
      // Latido: en una herramienta o un razonamiento largo, el indicador muestra
      // cuánto lleva; así nadie confunde "lento" con "colgado". Sin Gateway es
      // lo único que se mueve.
      latido = setInterval(() => {
        if (cerrado) return
        const base = actual ?? { state: 'thinking', label: '🧠 Pensando su respuesta…', desde: inicioTurno }
        const seg = Math.floor((ahora() - base.desde) / 1000)
        if (seg < 15) return
        enviar(base.state, componer(`${base.label.replace(/…$/, '')} · ${seg} s…`))
      }, latidoMs)
      latido.unref?.()
    },
    async cerrar() {
      cerrado = true
      armado = false
      clearInterval(latido)
      clearTimeout(reloj)
      clearTimeout(relojAnalisis)
      pendiente = null
      try { cliente?.stop() } catch {}
      await enviando
    },
  }
}
