/**
 * MEDIDOR DEL CONSUMO DE ANTHROPIC (cupo semanal y ventana de 5 h) — 2026-10-22.
 * Pedido de Nicolás Rivera («de una», 07:03 COT): verlo en vivo en el encabezado
 * de TODOS los proyectos de SynerLink, para todos los usuarios.
 *
 * DE DÓNDE SALE EL DATO, sin costo extra cuando hay turnos:
 *   - Durante un turno, el stream-json de Claude Code (verificado en 2.1.299) emite
 *       {"type":"rate_limit_event","rate_limit_info":{"status":"allowed",
 *        "overageStatus":"rejected","overageDisabledReason":"org_level_disabled",
 *        "unifiedWindows":{"five_hour":{"utilization":0.22,"resetsAt":1792684200},
 *                          "seven_day":{"utilization":0.4,"resetsAt":1792879200}}}}
 *     y se publica tal cual (fuente «turno»).
 *   - Sin turnos, cada HILOS_CUOTA_INTERVALO_MS (5 min por defecto) una llamada
 *     MÍNIMA a /v1/messages (haiku, max_tokens 1) y se leen los encabezados
 *     anthropic-ratelimit-unified-{7d,5h}-{utilization,reset} y -overage-status
 *     (fuente «sonda»). Solo con token OAuth: con llave de API esos encabezados
 *     no existen y no se sondea.
 *
 * Se publica en SynerLink por POST /api/chat/agent/quota con la llave del agente
 * (la del puente, scope "projects"). La interfaz lo pinta en cada proyecto donde
 * esté este agente. Es el consumo del TOKEN, compartido con el bot vivo y con
 * los otros agentes que usen el mismo token.
 *
 * Si SynerLink responde 404 (la ruta aún no ha llegado a ese entorno) se
 * reintenta a los 5 min (PAUSA_404_MS); antes era 1 h y, tras el pase a prod
 * del 2026-10-22, el medidor tardaba hasta una hora en aparecer. El log anota
 * la primera publicación exitosa tras arrancar y la primera tras un fallo,
 * para que haya evidencia sin llenar el log con cada envío.
 *
 * Runner openclaw (2026-10-28): no hay stream de cuota; la credencial es la del agente en
 * openclaw (openclaw/credencial.mjs, solo lectura) y se sondea al terminar cada turno
 * (trasTurno) y cada intervalo sin turnos. Con llave de API no hay cupo: no se publica.
 *
 * El token jamás se registra ni se publica. Nada de aquí puede tumbar el puente:
 * todo error se registra y se sigue.
 */

const URL_MENSAJES = 'https://api.anthropic.com/v1/messages';
/** Espera tras un 404 de /api/chat/agent/quota antes de reintentar. */
export const PAUSA_404_MS = 5 * 60 * 1000;
export const MODELO_SONDA = 'claude-haiku-4-5-20251001';
const SISTEMA_SONDA = "You are Claude Code, Anthropic's official CLI for Claude.";

/** Fracción 0..1 (o más, si hay excedente) → porcentaje con un decimal; null si no es número. */
function porcentaje(fraccion) {
  if (fraccion === null || fraccion === undefined || fraccion === '') return null;
  const n = Number(fraccion);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 10;
}

/** Epoch en segundos → ISO; null si no es válido. */
function isoDeEpoch(seg) {
  if (seg === null || seg === undefined || seg === '') return null;
  const n = Number(seg);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function texto(v, max = 40) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Hay algo que publicar: al menos una de las dos ventanas. */
function tieneDato(e) {
  return e.utilizacion7d !== null || e.utilizacion5h !== null;
}

/**
 * Estado de cuota a partir de un evento del stream-json. Devuelve null si el
 * evento no es de cuota o no trae ninguna ventana.
 */
export function cuotaDeEvento(evento, ahora = new Date()) {
  if (evento?.type !== 'rate_limit_event') return null;
  const info = evento.rate_limit_info;
  if (!info || typeof info !== 'object') return null;
  const v = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : {};
  const semanal = v.seven_day ?? null;
  const cinco = v.five_hour ?? null;
  const estado = {
    utilizacion7d: porcentaje(semanal?.utilization),
    reset7d: isoDeEpoch(semanal?.resetsAt),
    utilizacion5h: porcentaje(cinco?.utilization),
    reset5h: isoDeEpoch(cinco?.resetsAt),
    overage: texto(info.overageStatus),
    medidoEn: ahora.toISOString(),
    fuente: 'turno',
  };
  // Versiones sin `unifiedWindows`: solo la ventana que reporta el evento.
  if (!tieneDato(estado) && info.utilization !== undefined) {
    if (info.rateLimitType === 'seven_day') {
      estado.utilizacion7d = porcentaje(info.utilization);
      estado.reset7d = isoDeEpoch(info.resetsAt);
    } else if (info.rateLimitType === 'five_hour') {
      estado.utilizacion5h = porcentaje(info.utilization);
      estado.reset5h = isoDeEpoch(info.resetsAt);
    }
  }
  return tieneDato(estado) ? estado : null;
}

/** Estado de cuota a partir de los encabezados de /v1/messages (Headers o un objeto). */
export function cuotaDeCabeceras(cabeceras, ahora = new Date()) {
  const leer = (n) => {
    const k = `anthropic-ratelimit-unified-${n}`;
    if (typeof cabeceras?.get === 'function') return cabeceras.get(k);
    return cabeceras?.[k] ?? null;
  };
  const estado = {
    utilizacion7d: porcentaje(leer('7d-utilization')),
    reset7d: isoDeEpoch(leer('7d-reset')),
    utilizacion5h: porcentaje(leer('5h-utilization')),
    reset5h: isoDeEpoch(leer('5h-reset')),
    overage: texto(leer('overage-status')),
    medidoEn: ahora.toISOString(),
    fuente: 'sonda',
  };
  return tieneDato(estado) ? estado : null;
}

/**
 * Llamada mínima a la API con el token OAuth del agente. Devuelve el estado o
 * null. Nunca incluye el token en errores.
 */
export async function sondearCuota({ credencial, fetchImpl = globalThis.fetch, timeoutMs = 30_000, ahora = () => new Date() }) {
  if (credencial?.tipo !== 'oauth-token' || !credencial.valor) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(URL_MENSAJES, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credencial.valor}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: MODELO_SONDA, max_tokens: 1, system: SISTEMA_SONDA, messages: [{ role: 'user', content: '.' }] }),
      signal: ctrl.signal,
    });
    // Un 429 también trae los encabezados (es justo cuando más importa verlos).
    const estado = cuotaDeCabeceras(res.headers, ahora());
    try {
      await res.arrayBuffer();
    } catch {}
    if (!estado) throw new Error(`la API respondió HTTP ${res.status} sin encabezados de cuota`);
    return estado;
  } finally {
    clearTimeout(t);
  }
}

/** ¿Cambió lo suficiente como para publicar antes de tiempo? */
export function cambioRelevante(anterior, nuevo) {
  if (!anterior) return true;
  const dif = (a, b) => (a === null || b === null ? a !== b : Math.abs(a - b) >= 1);
  return (
    dif(anterior.utilizacion7d, nuevo.utilizacion7d) ||
    dif(anterior.utilizacion5h, nuevo.utilizacion5h) ||
    anterior.reset7d !== nuevo.reset7d ||
    anterior.reset5h !== nuevo.reset5h ||
    anterior.overage !== nuevo.overage
  );
}

/**
 * Medidor: recibe lo del stream, sondea cuando no hay turnos y publica.
 *   - registrarEvento(evento): durante un turno; publica como mucho una vez por
 *     `minEntrePublicacionesMs`, salvo que el dato cambie (≥ 1 punto o reinicio).
 *   - revisar(): lo llama el temporizador; sondea si no hay turnos en curso y la
 *     última medición tiene `intervaloMs` o más.
 *   - iniciar()/detener(): el temporizador (unref: no mantiene vivo el proceso).
 */
export function crearMedidorCuota({
  credencial,
  publicar,
  ocupado = () => false,
  intervaloMs = 5 * 60 * 1000,
  minEntrePublicacionesMs = 60 * 1000,
  revisionMs = 30 * 1000,
  sondear = (o) => sondearCuota(o),
  ahora = () => new Date(),
  log = () => {},
}) {
  let ultimoPublicado = null;
  let ultimaPublicacion = 0;
  let ultimaMedicion = 0;
  let sondeando = false;
  let pausaHasta = 0;
  let temporizador = null;
  let avisoRuta = false;
  let registrarExito = true; // la primera publicación tras arrancar (o tras un fallo) va al log

  async function enviar(estado, forzar = false) {
    const t = ahora().getTime();
    ultimaMedicion = t;
    if (t < pausaHasta) return false;
    if (!forzar && t - ultimaPublicacion < minEntrePublicacionesMs && !cambioRelevante(ultimoPublicado, estado)) return false;
    ultimaPublicacion = t;
    try {
      await publicar(estado);
      ultimoPublicado = estado;
      avisoRuta = false;
      if (registrarExito) {
        log(`cuota publicada en SynerLink: semanal ${estado.utilizacion7d ?? '—'} %, 5 h ${estado.utilizacion5h ?? '—'} % (${estado.fuente}, medido ${estado.medidoEn}).`);
        registrarExito = false;
      }
      return true;
    } catch (err) {
      registrarExito = true;
      if (err?.status === 404) {
        // SynerLink todavía no trae la ruta: se reintenta en 5 min, sin llenar el log.
        pausaHasta = t + PAUSA_404_MS;
        if (!avisoRuta) log(`SynerLink no trae /api/chat/agent/quota (404): reintento cada ${Math.round(PAUSA_404_MS / 60000)} min.`);
        avisoRuta = true;
      } else log('cuota: no se pudo publicar:', err?.message ?? err);
      return false;
    }
  }

  function registrarEvento(evento) {
    const estado = cuotaDeEvento(evento, ahora());
    if (!estado) return false;
    void enviar(estado);
    return true;
  }

  // `credencial` puede ser el objeto { tipo, valor } o una función (sync o async) que lo
  // devuelve: el runner openclaw lo relee del almacén del agente en cada sonda (2026-10-28).
  let tipoAnunciado = null;
  async function credencialActual() {
    const c = typeof credencial === 'function' ? await credencial() : credencial;
    const tipo = c?.tipo ?? 'ninguna';
    if (tipo !== tipoAnunciado) {
      tipoAnunciado = tipo;
      if (tipo === 'api-key') log('cuota: el agente usa llave de API: no hay cupo semanal ni de 5 h que medir; el gasto queda por turno (consumo).');
      else if (tipo === 'ninguna') log('cuota: el agente no tiene credencial de Anthropic que medir: sin datos de cupo para este agente.');
    }
    return c;
  }

  async function revisar({ forzar = false } = {}) {
    if (sondeando || intervaloMs <= 0) return null;
    if (!forzar && (ocupado() || ahora().getTime() - ultimaMedicion < intervaloMs)) return null;
    sondeando = true;
    try {
      const c = await credencialActual();
      if (c?.tipo !== 'oauth-token') {
        ultimaMedicion = ahora().getTime();
        return null;
      }
      const estado = await sondear({ credencial: c });
      if (!estado) return null;
      await enviar(estado, true);
      return estado;
    } catch (err) {
      ultimaMedicion = ahora().getTime(); // no reintentar en cada vuelta si la API falla
      log('cuota: la sonda falló:', err?.name === 'AbortError' ? 'tiempo agotado' : (err?.message ?? err));
      return null;
    } finally {
      sondeando = false;
    }
  }

  /**
   * Al terminar un turno de un runner SIN stream de cuota (openclaw): una sonda, salvo que la
   * última medición tenga menos de `minEntrePublicacionesMs` (varios hilos terminando a la vez).
   */
  async function trasTurno() {
    if (ahora().getTime() - ultimaMedicion < minEntrePublicacionesMs) return null;
    return revisar({ forzar: true });
  }

  function iniciar() {
    if (temporizador || intervaloMs <= 0) return;
    temporizador = setInterval(() => void revisar(), revisionMs);
    temporizador.unref?.();
    void revisar({ forzar: true });
  }

  function detener() {
    if (temporizador) clearInterval(temporizador);
    temporizador = null;
  }

  return { registrarEvento, revisar, trasTurno, iniciar, detener, ultimo: () => ultimoPublicado };
}
