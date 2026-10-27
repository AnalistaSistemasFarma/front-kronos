// Copia de migrar-agente-synerlink/assets/openclaw/openclaw-seguimiento.mjs (commit 67c6c6b); único cambio: el import de ./actividad.mjs.
/**
 * Seguimiento de trabajo en segundo plano (sub-agentes) para el puente
 * SynerLink ⇄ openclaw.
 *
 * QUÉ RESUELVE
 * ------------
 * Cuando el agente lanza un sub-agente (`sessions_spawn`) y cede el turno
 * (`sessions_yield`), `openclaw agent --json` termina SIN texto: `payloads: []`
 * y `meta.yielded: true`. El resultado del sub-agente llega DESPUÉS, fuera del
 * proceso que lanzó el puente. Antes el puente lo tomaba como error ("openclaw
 * no devolvió texto de respuesta") y el resultado final nunca llegaba al chat.
 *
 * CÓMO LLEGA EL RESULTADO (comprobado el 2026-10-08 con openclaw 2026.9.8)
 * -----------------------------------------------------------------------
 * Al terminar el hijo, openclaw corre un turno nuevo en la sesión que lo pidió
 * (la del puente, `agent:<id>:<prefijo><conversación>`). Ese turno queda en el
 * transcript con `__openclaw.runId` = `announce:requester-settle:…`, y su último
 * mensaje `assistant` trae la respuesta final del agente ya redactada para la
 * persona. Como la sesión la creó el CLI, no tiene ruta de canal: openclaw no
 * la entrega a ningún lado. El puente la recoge.
 *
 * MECANISMO: se consulta `chat.history` por el Gateway (scope operator.read)
 * cada pocos segundos mientras haya seguimientos pendientes. Es la fuente de
 * verdad del transcript, sirve tras un reinicio del puente o del Gateway (no
 * depende de haber estado suscrito cuando pasó el evento) y trae en
 * `sessionInfo` si la sesión tiene un turno o sub-agentes activos.
 *
 * Los seguimientos se guardan en `<STATE_DIR>/seguimientos.json` (escritura
 * atómica), así un reinicio del puente no los pierde.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rutaSdk } from './actividad.mjs'

// Herramientas que dejan trabajo corriendo después del turno.
const RE_SPAWN = /^(sessions_spawn|spawn_agent)$/i
const RE_YIELD = /^sessions_yield$/i
const SILENCIO = /^(NO_REPLY|ANNOUNCE_SKIP)$/

// ── Lectura de la salida de `openclaw agent --json` ─────────────────────────

/** Raíz con `meta` (Gateway: `result.meta`; --local: `meta`). */
function metaDe(d) {
  return d?.result?.meta ?? d?.meta ?? null
}

/** Nombres de herramientas que usó el turno, según las dos fuentes de meta. */
export function herramientasDelTurno(d) {
  const meta = metaDe(d)
  const a = meta?.toolSummary?.tools
  const b = meta?.agentMeta?.terminalReceipt?.successfulToolNames
  return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map(String))]
}

/**
 * ¿El turno dejó trabajo en segundo plano?
 *   cedio  → cedió el turno esperando a sus hijos (sessions_yield / meta.yielded)
 *   lanzo  → lanzó al menos un sub-agente
 */
export function trabajoEnSegundoPlano(d) {
  const meta = metaDe(d)
  const tools = herramientasDelTurno(d)
  const cedio = meta?.yielded === true || tools.some((t) => RE_YIELD.test(t))
  const lanzo = tools.some((t) => RE_SPAWN.test(t))
  return { cedio, lanzo }
}

// ── Transcript ──────────────────────────────────────────────────────────────

/** Texto visible de un mensaje (solo bloques `text`, sin razonamiento ni tools). */
export function textoDeMensaje(m) {
  const c = m?.content
  if (typeof c === 'string') return c.trim()
  if (!Array.isArray(c)) return ''
  return c.filter((x) => x?.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n\n').trim()
}

const runIdDe = (m) => String(m?.__openclaw?.runId ?? m?.runId ?? '')
const tsDe = (m) => Number(m?.__openclaw?.recordTimestampMs ?? m?.timestamp ?? 0)

/**
 * Respuestas finales de los turnos de anuncio (resultado de sub-agentes) que
 * aún no se han entregado. Un turno en curso no se toma: su texto puede no ser
 * el final todavía.
 *
 * @returns {{runId: string, id: string, texto: string, ts: number}[]} en orden
 */
export function anunciosPendientes(messages, { desdeMs = 0, entregados = [], runEnCurso = '' } = {}) {
  const ya = new Set(entregados)
  const porRun = new Map()
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role !== 'assistant') continue
    const runId = runIdDe(m)
    if (!runId.startsWith('announce:') || runId === runEnCurso || ya.has(runId)) continue
    if (tsDe(m) < desdeMs) continue
    porRun.set(runId, m) // el último mensaje del run gana
  }
  const out = []
  for (const [runId, m] of porRun) {
    const texto = textoDeMensaje(m)
    out.push({ runId, id: String(m?.__openclaw?.id ?? ''), texto: SILENCIO.test(texto) ? '' : texto, ts: tsDe(m) })
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/** Última respuesta visible de un hijo (respaldo si el anuncio no llega). */
export function ultimaRespuesta(messages) {
  const lista = Array.isArray(messages) ? messages : []
  for (let i = lista.length - 1; i >= 0; i--) {
    const m = lista[i]
    if (m?.role !== 'assistant') continue
    const t = textoDeMensaje(m)
    if (t && !SILENCIO.test(t)) return t
  }
  return ''
}

// ── Gateway ─────────────────────────────────────────────────────────────────

/**
 * Abre una conexión de solo lectura, corre `fn(request)` y cierra. Una
 * conexión por ciclo: es local, barata, y no hay estado que reconectar.
 */
export async function conGateway(fn, {
  openclawBin = '/opt/homebrew/bin/openclaw',
  gatewayUrl = `ws://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || 18789}`,
  Client,
  timeoutMs = 15_000,
} = {}) {
  const Ctor = Client ?? (await import(rutaSdk(openclawBin))).GatewayClient
  return await new Promise((resolve, reject) => {
    let listo = false
    const fin = (err, v) => {
      if (listo) return
      listo = true
      clearTimeout(reloj)
      try { cliente.stop() } catch {}
      err ? reject(err) : resolve(v)
    }
    const reloj = setTimeout(() => fin(new Error('el Gateway no respondió a tiempo')), timeoutMs)
    const cliente = new Ctor({
      url: gatewayUrl,
      clientName: 'cli',
      mode: 'cli',
      scopes: ['operator.read'],
      onHelloOk: async () => {
        try { fin(null, await fn((metodo, params) => cliente.request(metodo, params))) } catch (err) { fin(err) }
      },
      onConnectError: (err) => fin(err instanceof Error ? err : new Error(String(err))),
      onClose: () => fin(new Error('el Gateway cerró la conexión')),
    })
    cliente.start()
  })
}

/** Resumen de la sesión: mensajes recientes y si hay algo corriendo. */
export async function leerSesion(request, sessionKey, limit = 60) {
  const r = await request('chat.history', { sessionKey, limit })
  const si = r?.sessionInfo ?? {}
  return {
    messages: Array.isArray(r?.messages) ? r.messages : [],
    runEnCurso: String(r?.inFlightRun?.runId ?? ''),
    activo: Boolean(r?.inFlightRun) || si.hasActiveRun === true,
    subagentesActivos: si.hasActiveSubagentRun === true,
    hijos: Array.isArray(si.childSessions) ? si.childSessions.map(String) : [],
    status: String(si.status ?? ''),
    startedAt: Number(si.startedAt ?? 0),
  }
}

// ── Seguimientos persistentes ───────────────────────────────────────────────

/**
 * Crea el gestor de seguimientos.
 *
 * @param {object} o
 * @param {string} o.stateDir
 * @param {string} o.agentId
 * @param {string} o.sessionPrefix
 * @param {(conv:number, texto:string, opts?:{state?:string,label?:string|null}) => Promise<number>} o.publicarRespuesta
 * @param {(conv:number, state:string, label:string|null, tasks?:any[]) => Promise} o.publicarEstado
 * @param {(conv:number) => boolean} o.ocupado  ¿el puente corre un turno en esa conversación?
 * @param {(msg:string) => void} o.log
 */
export function crearSeguimiento({
  stateDir,
  agentId,
  sessionPrefix,
  publicarRespuesta,
  publicarEstado,
  ocupado = () => false,
  log = () => {},
  gateway = {},
  intervaloMs = 10_000,
  maxHoras = 4,
  graciaCierreMs = 45_000,
  graciaSinAnuncioMs = 4 * 60_000,
  refrescoEstadoMs = 60_000,
  ahora = () => Date.now(),
}) {
  const archivo = join(stateDir, 'seguimientos.json')
  /** conversación (string) → seguimiento */
  let pendientes = {}
  try {
    if (existsSync(archivo)) pendientes = JSON.parse(readFileSync(archivo, 'utf8')) || {}
  } catch (err) {
    log(`seguimiento: ${archivo} ilegible, se ignora: ${err.message}`)
    pendientes = {}
  }

  function guardar() {
    const tmp = `${archivo}.tmp.${process.pid}`
    writeFileSync(tmp, JSON.stringify(pendientes, null, 1), { mode: 0o600 })
    renameSync(tmp, archivo)
  }

  const claveSesion = (conv) => `agent:${agentId}:${sessionPrefix}${conv}`
  const etiqueta = (f) => {
    const min = Math.floor((ahora() - f.creadoMs) / 60_000)
    return `⏳ Trabajando en segundo plano${min >= 1 ? ` · ${min} min` : ''}…`
  }

  /**
   * Registra (o refresca) el seguimiento de una conversación.
   * `debeRespuesta`: el turno cedió sin dar la respuesta final; si el anuncio
   * no llega, se recurre al texto del hijo.
   */
  async function registrar({ conversationId, desdeMs, debeRespuesta, tareas = [], prefijo = '' }) {
    const conv = String(conversationId)
    const sessionKey = claveSesion(conv)
    let hijos = []
    try {
      hijos = await conGateway(async (request) => {
        const s = await leerSesion(request, sessionKey, 1)
        const vivos = []
        for (const h of s.hijos) {
          try {
            const sh = await leerSesion(request, h, 1)
            if (sh.activo || sh.status === 'running' || sh.startedAt >= desdeMs - 5_000) vivos.push(h)
          } catch {}
        }
        return vivos
      }, gateway)
    } catch (err) {
      log(`seguimiento c${conv}: no se pudieron leer los sub-agentes: ${err.message}`)
    }
    const previo = pendientes[conv]
    const t = ahora()
    pendientes[conv] = {
      conversationId: Number(conversationId),
      sessionKey,
      creadoMs: previo?.creadoMs ?? t,
      desdeMs: Math.min(previo?.desdeMs ?? desdeMs, desdeMs),
      venceMs: t + maxHoras * 3600_000,
      debeRespuesta: Boolean(debeRespuesta || previo?.debeRespuesta),
      huboTurno: false,
      hijos: [...new Set([...(previo?.hijos ?? []), ...hijos])],
      entregados: previo?.entregados ?? [],
      publicados: previo?.publicados ?? 0,
      quietoDesde: null,
      ultimoEstadoMs: t,
      tareas: Array.isArray(tareas) ? tareas : [],
      prefijo: prefijo || previo?.prefijo || '',
    }
    guardar()
    log(`seguimiento c${conv}: registrado (sub-agentes: ${pendientes[conv].hijos.length}, debe respuesta: ${pendientes[conv].debeRespuesta})`)
  }

  /** El puente avisa que corrió un turno normal en la conversación. */
  function turnoDelPuente(conversationId) {
    const f = pendientes[String(conversationId)]
    if (!f) return
    f.huboTurno = true
    guardar()
  }

  const pendiente = (conversationId) => Boolean(pendientes[String(conversationId)])

  async function cerrar(conv, motivo) {
    const f = pendientes[conv]
    delete pendientes[conv]
    guardar()
    log(`seguimiento c${conv}: cerrado (${motivo})`)
    if (f && !ocupado(f.conversationId)) await publicarEstado(f.conversationId, 'idle', null, [])
  }

  async function publicar(f, texto, sigueTrabajando) {
    const cuerpo = f.prefijo ? `${f.prefijo}\n\n${texto}` : texto
    await publicarRespuesta(f.conversationId, cuerpo, sigueTrabajando
      ? { state: 'thinking', label: etiqueta(f) }
      : { state: 'idle', label: null })
    f.prefijo = ''
    f.publicados++
  }

  async function revisar(conv) {
    const f = pendientes[conv]
    if (!f || ocupado(f.conversationId)) return
    const t = ahora()

    if (t >= f.venceMs) {
      // Si el turno ya había respondido (solo dejó un hijo suelto), se cierra
      // en silencio: no hay una respuesta pendiente que reclamar.
      if (!f.debeRespuesta) return cerrar(conv, 'venció sin respuesta pendiente')
      try {
        await publicar(f, `⏱️ La tarea que dejé en segundo plano está tardando más de ${maxHoras} horas y no recibí el resultado. Por favor pídamela de nuevo; si vuelve a pasar, avísele a Nicolás.`, false)
      } catch (err) { log(`seguimiento c${conv}: no se pudo avisar del vencimiento: ${err.message}`) }
      return cerrar(conv, 'venció')
    }

    const lectura = await conGateway(async (request) => {
      const s = await leerSesion(request, f.sessionKey, 60)
      const hijos = []
      for (const h of f.hijos) {
        try {
          const sh = await leerSesion(request, h, 20)
          hijos.push({ key: h, activo: sh.activo || sh.status === 'running', texto: ultimaRespuesta(sh.messages) })
        } catch (err) {
          hijos.push({ key: h, activo: false, texto: '', error: err.message })
        }
      }
      return { s, hijos }
    }, gateway)
    const { s, hijos } = lectura

    // 1) Anuncios nuevos: la respuesta final del agente tras recibir al hijo.
    const nuevos = anunciosPendientes(s.messages, { desdeMs: f.desdeMs, entregados: f.entregados, runEnCurso: s.runEnCurso })
    const hijosActivos = f.hijos.length > 0 ? hijos.some((h) => h.activo) : s.subagentesActivos
    for (const a of nuevos) {
      f.entregados.push(a.runId)
      if (a.texto) {
        const sigue = hijosActivos || s.activo
        await publicar(f, a.texto, sigue)
        log(`seguimiento c${conv}: entregado el resultado del sub-agente (${a.runId.slice(0, 60)})`)
      }
      guardar()
    }

    // 2) ¿Sigue habiendo trabajo?
    if (s.activo || hijosActivos) {
      f.quietoDesde = null
      if (t - (f.ultimoEstadoMs ?? 0) >= refrescoEstadoMs) {
        f.ultimoEstadoMs = t
        await publicarEstado(f.conversationId, 'thinking', etiqueta(f), f.tareas)
      }
      guardar()
      return
    }
    if (!f.quietoDesde) { f.quietoDesde = t; guardar() }
    const quieto = t - f.quietoDesde

    if (f.publicados > 0 && quieto >= graciaCierreMs) return cerrar(conv, 'resultado entregado')
    if (f.publicados === 0 && quieto >= graciaSinAnuncioMs) {
      // El anuncio no llegó. Si un turno normal del puente ya respondió en esta
      // conversación, el resultado pudo entrar en ese turno: no se duplica.
      if (f.debeRespuesta && !f.huboTurno) {
        const textos = hijos.map((h) => h.texto).filter(Boolean)
        const cuerpo = textos.length > 0
          ? `✅ Terminó la tarea en segundo plano. Este es el resultado:\n\n${textos.join('\n\n---\n\n')}`
          : '⚠️ La tarea en segundo plano terminó, pero no recibí un resultado para mostrarle. Por favor pídamela de nuevo.'
        try { await publicar(f, cuerpo, false) } catch (err) { log(`seguimiento c${conv}: no se pudo publicar el respaldo: ${err.message}`); return }
        return cerrar(conv, textos.length > 0 ? 'respaldo con el texto del sub-agente' : 'sin resultado')
      }
      return cerrar(conv, 'sin anuncio; ya hubo turno del puente')
    }
  }

  let corriendo = false
  async function ciclo() {
    if (corriendo) return
    corriendo = true
    try {
      for (const conv of Object.keys(pendientes)) {
        try {
          await revisar(conv)
        } catch (err) {
          log(`seguimiento c${conv}: ${err.message}`)
        }
      }
    } finally {
      corriendo = false
    }
  }

  const reloj = setInterval(() => { void ciclo() }, intervaloMs)
  reloj.unref?.()
  const n = Object.keys(pendientes).length
  if (n > 0) log(`seguimiento: retomando ${n} pendiente(s)`)

  return {
    registrar,
    turnoDelPuente,
    pendiente,
    ciclo,
    detener() { clearInterval(reloj) },
    get pendientes() { return pendientes },
  }
}
