/**
 * Diagnóstico técnico estructurado de Transferencias Nabuco (módulo técnico: los errores se
 * muestran con detalle). Puro (sin BD ni red): lo usan el servidor, la UI y las pruebas.
 *
 * Reglas de seguridad: nunca contiene la contraseña (en /AuthBI el `pwd` SIEMPRE va '•••') ni el
 * token completo (Authorization → 'Bearer eyJ…(oculto, N caracteres)'). `sanitizarDiagnostico`
 * reemplaza además cualquier secreto conocido que se haya colado en textos libres.
 */

export type EtapaDiagnostico = 'validacion' | 'red' | 'autenticacion' | 'envio' | 'respuesta' | 'sap' | 'interno';

export interface PeticionDiagnostico {
  metodo: string;
  url: string;
  cabeceras: Record<string, string>;
  cuerpo?: string;
}

export interface RespuestaDiagnostico {
  http_status: number;
  status_text: string;
  cabeceras: Record<string, string>;
  cuerpo_crudo: string;
  cuerpo_json?: unknown;
}

export interface DiagnosticoNabuco {
  ok: boolean;
  etapa: EtapaDiagnostico;
  mensaje: string;
  detalle?: string;
  sugerencia?: string;
  peticion?: PeticionDiagnostico;
  respuesta?: RespuestaDiagnostico;
  red?: { codigo: string; mensaje: string };
  duracion_ms: number;
  cuando: string;
  /** HTTP de la API de SynerLink cuando el error es de NUESTRO lado (400/403/409/500). */
  http_synerlink?: number;
}

export const MAX_CUERPO_DIAGNOSTICO = 20_000;
export const PWD_OCULTO = '•••';

export function recortar(t: string, max = MAX_CUERPO_DIAGNOSTICO): string {
  return t.length > max ? `${t.slice(0, max)}…(recortado, ${t.length} caracteres en total)` : t;
}

/** 'eyJhbGciOi…(oculto, 812 caracteres)'. Nunca devuelve el token completo. */
export function enmascararToken(t: string): string {
  const s = t.trim();
  if (!s) return '(vacío)';
  return `${s.slice(0, Math.min(6, Math.floor(s.length / 4)))}…(oculto, ${s.length} caracteres)`;
}

const CABECERAS_SECRETAS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i;

export function enmascararCabeceras(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (!CABECERAS_SECRETAS.test(k)) out[k] = v;
    else {
      const m = /^(Bearer|Basic)\s+(.+)$/i.exec(v);
      out[k] = m ? `${m[1]} ${enmascararToken(m[2])}` : enmascararToken(v);
    }
  }
  return out;
}

/** Cabeceras de respuesta útiles para diagnosticar (content-type, www-authenticate, server, date, x-*). */
export function cabecerasRelevantes(h: Headers | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  h.forEach((v, k) => {
    const n = k.toLowerCase();
    if (['content-type', 'content-length', 'www-authenticate', 'server', 'date', 'location', 'retry-after'].includes(n) || n.startsWith('x-')) out[n] = v;
  });
  return enmascararCabeceras(out);
}

/** ¿Parece un token (JWT o cadena larga sin espacios)? */
export function pareceToken(t: string): boolean {
  const s = t.trim().replace(/^"|"$/g, '');
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(s) || (s.length >= 32 && !/\s/.test(s) && !/[{}<>]/.test(s));
}

// ---------------------------------------------------------------------------------- red

export interface ErrorRed {
  codigo: string;
  mensaje: string;
}

/** Saca el código de red de un error de fetch (undici): err.cause.code, AbortError/TimeoutError, CERT_*. */
export function errorDeRed(e: unknown): ErrorRed {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string; name?: string } } | null;
  const nombre = err?.name ?? '';
  const causa = err?.cause;
  let codigo = causa?.code ?? err?.code ?? '';
  if (!codigo && (nombre === 'TimeoutError' || nombre === 'AbortError')) codigo = nombre;
  if (!codigo && causa?.name && /Timeout/i.test(causa.name)) codigo = 'UND_ERR_CONNECT_TIMEOUT';
  const mensaje = [err?.message, causa?.message].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') || String(e);
  return { codigo: codigo || 'DESCONOCIDO', mensaje };
}

export function esTimeout(codigo: string): boolean {
  return ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'AbortError', 'TimeoutError', 'ESOCKETTIMEDOUT'].includes(codigo);
}

/** Mensaje y sugerencia para un código de red. */
export function clasificarRed(codigo: string, host: string, timeoutMs?: number): { mensaje: string; sugerencia: string } {
  if (codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN') {
    return { mensaje: `No se pudo resolver el nombre «${host}» (DNS, ${codigo}).`, sugerencia: 'Revise que el host de la URL esté bien escrito y que el servidor de SynerLink tenga DNS/salida a Internet hacia ese dominio.' };
  }
  if (codigo === 'ECONNREFUSED') {
    return { mensaje: `«${host}» rechazó la conexión (ECONNREFUSED).`, sugerencia: 'El puerto está cerrado o el servicio de Nabuco está caído. Verifique el puerto de la URL (pruebas usa :90 por HTTP) y que el API esté arriba.' };
  }
  if (codigo === 'ECONNRESET' || codigo === 'UND_ERR_SOCKET' || codigo === 'EPIPE') {
    return { mensaje: `La conexión con «${host}» se cortó (${codigo}).`, sugerencia: 'Un firewall/proxy o el servidor cerró la conexión. Pruebe de nuevo; si persiste, revise protocolo (http vs https) y puerto.' };
  }
  if (esTimeout(codigo)) {
    return {
      mensaje: `Nabuco no respondió a tiempo (${codigo}${timeoutMs ? `, timeout ${timeoutMs} ms` : ''}).`,
      sugerencia: 'El servidor puede estar «dormido» (el de pruebas tarda ~9 s en la 1.ª llamada) o un firewall bloquea el tráfico. Reintente y, si persiste, suba el timeout (p. ej. 30 000–60 000 ms).',
    };
  }
  if (/^(CERT_|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|ERR_TLS|ERR_SSL|EPROTO)/.test(codigo)) {
    return { mensaje: `Falló la validación TLS con «${host}» (${codigo}).`, sugerencia: 'El certificado del servidor no es válido para Node (vencido, autofirmado o cadena incompleta). Use la URL con certificado válido o pida a Nabuco corregirlo; SynerLink no desactiva la validación TLS hacia Nabuco.' };
  }
  return { mensaje: `Error de red al llamar a «${host}» (${codigo}).`, sugerencia: 'Revise la URL, el puerto y la conectividad desde el servidor de SynerLink.' };
}

// ---------------------------------------------------------------------------------- HTTP

export type ContextoHttp = 'autenticacion' | 'envio';

/** Mensaje y sugerencia para un HTTP de Nabuco según dónde ocurrió (AuthBI o solicitudes). */
export function clasificarHttp(status: number, contexto: ContextoHttp, mensajeNabuco?: string | null): { mensaje: string; sugerencia: string } {
  const donde = contexto === 'autenticacion' ? 'la autenticación (AuthBI)' : 'el envío de la solicitud';
  const textoNabuco = mensajeNabuco ? ` Nabuco dice: «${mensajeNabuco}».` : '';
  if (status === 401 || status === 403) {
    if (contexto === 'autenticacion') {
      return {
        mensaje: `Nabuco rechazó las credenciales (HTTP ${status}).${textoNabuco}`,
        sugerencia: 'Usuario, contraseña u org incorrectos. Verifique mayúsculas y la org (suele ser 0 o 1: pruebe la otra).',
      };
    }
    return { mensaje: `Nabuco rechazó el token en ${donde} (HTTP ${status}).${textoNabuco}`, sugerencia: 'Token vencido o sin permiso: SynerLink ya pidió un token nuevo y reintentó una vez. Si persiste, el usuario de Nabuco no tiene permiso sobre solicitudes de alistamiento.' };
  }
  if (status === 400 || status === 422) {
    return { mensaje: `Nabuco rechazó los datos en ${donde} (HTTP ${status}).${textoNabuco}`, sugerencia: contexto === 'autenticacion' ? 'El cuerpo {usr, pwd, org} no tiene el formato esperado (revise la org).' : 'Payload inválido: revise el mensaje de Nabuco y el mapeo (campos obligatorios, tipos, códigos de producto/bodega).' };
  }
  if (status === 404) return { mensaje: `La ruta no existe en Nabuco (HTTP 404) en ${donde}.${textoNabuco}`, sugerencia: `Ruta mal configurada: revise la URL base y la ruta de ${contexto === 'autenticacion' ? 'token (p. ej. /AuthBI)' : 'solicitudes'}.` };
  if (status === 405) return { mensaje: `Método no permitido (HTTP 405) en ${donde}.${textoNabuco}`, sugerencia: 'La ruta existe pero no acepta POST: probablemente la ruta configurada no es la correcta.' };
  if (status === 408 || status === 429) return { mensaje: `Nabuco respondió HTTP ${status} en ${donde}.${textoNabuco}`, sugerencia: status === 429 ? 'Demasiadas peticiones: espere y reintente (no pida AuthBI en cada envío).' : 'Tiempo de espera del servidor: reintente.' };
  if (status >= 500) return { mensaje: `Error interno de Nabuco (HTTP ${status}) en ${donde}.${textoNabuco}`, sugerencia: 'Falla del lado de Nabuco: reintente más tarde y, si persiste, envíe este diagnóstico al soporte de Nabuco.' };
  return { mensaje: `Nabuco respondió HTTP ${status} en ${donde}.${textoNabuco}`, sugerencia: 'Revise el cuerpo de la respuesta en el detalle técnico.' };
}

/** Extrae un mensaje legible del cuerpo de error de Nabuco (ASP.NET: title/detail/errors/message). */
export function mensajeDeCuerpo(json: unknown, crudo: string): string | null {
  if (typeof json === 'string') return json.slice(0, 500);
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const partes: string[] = [];
    for (const k of ['message', 'Message', 'mensaje', 'error', 'title', 'detail']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) partes.push(v.trim());
      else if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).message === 'string') partes.push(String((v as Record<string, unknown>).message));
    }
    if (o.errors && typeof o.errors === 'object') {
      for (const [campo, lista] of Object.entries(o.errors as Record<string, unknown>)) {
        partes.push(`${campo}: ${Array.isArray(lista) ? lista.join(' ') : String(lista)}`);
      }
    }
    if (partes.length) return [...new Set(partes)].join(' · ').slice(0, 800);
  }
  const t = crudo.trim();
  return t && t.length <= 300 && !t.startsWith('<') ? t : null;
}

export function parsearJson(t: string): { ok: true; valor: unknown } | { ok: false } {
  if (!t.trim()) return { ok: false };
  try {
    return { ok: true, valor: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

export function respuestaDiagnostico(status: number, statusText: string, headers: Headers | null, crudo: string): RespuestaDiagnostico {
  const j = parsearJson(crudo);
  return { http_status: status, status_text: statusText, cabeceras: cabecerasRelevantes(headers), cuerpo_crudo: recortar(crudo), ...(j.ok ? { cuerpo_json: j.valor } : {}) };
}

// ---------------------------------------------------------------------------------- constructores

export function base(inicio: number, ahora = Date.now()): { duracion_ms: number; cuando: string } {
  return { duracion_ms: Math.max(0, ahora - inicio), cuando: new Date(ahora).toISOString() };
}

export function diagnosticoValidacion(mensaje: string, sugerencia?: string, inicio = Date.now()): DiagnosticoNabuco {
  return { ok: false, etapa: 'validacion', mensaje, ...(sugerencia ? { sugerencia } : {}), ...base(inicio) };
}

export function diagnosticoRed(e: unknown, contexto: ContextoHttp, peticion: PeticionDiagnostico, inicio: number, timeoutMs?: number): DiagnosticoNabuco {
  const red = errorDeRed(e);
  let host = '';
  try {
    host = new URL(peticion.url).host;
  } catch {
    host = peticion.url;
  }
  const c = clasificarRed(red.codigo, host, timeoutMs);
  return {
    ok: false,
    etapa: 'red',
    mensaje: `${contexto === 'autenticacion' ? 'Pidiendo el token' : 'Enviando la solicitud'}: ${c.mensaje}`,
    detalle: red.mensaje,
    sugerencia: c.sugerencia,
    peticion,
    red,
    ...base(inicio),
  };
}

/** Diagnóstico de una respuesta HTTP de Nabuco (ok o no). */
export function diagnosticoHttp(contexto: ContextoHttp, peticion: PeticionDiagnostico, respuesta: RespuestaDiagnostico, inicio: number): DiagnosticoNabuco {
  const s = respuesta.http_status;
  if (s >= 200 && s < 300) {
    return { ok: true, etapa: contexto, mensaje: contexto === 'autenticacion' ? `Nabuco entregó un token (HTTP ${s}).` : `Nabuco aceptó la solicitud (HTTP ${s}).`, peticion, respuesta, ...base(inicio) };
  }
  const c = clasificarHttp(s, contexto, mensajeDeCuerpo(respuesta.cuerpo_json, respuesta.cuerpo_crudo));
  const noJson = respuesta.cuerpo_crudo.trim() && respuesta.cuerpo_json === undefined;
  return {
    ok: false,
    etapa: contexto,
    mensaje: c.mensaje,
    sugerencia: c.sugerencia,
    ...(noJson ? { detalle: `La respuesta no es JSON (${respuesta.cabeceras['content-type'] ?? 'sin content-type'}); vea el cuerpo crudo.` } : {}),
    peticion,
    respuesta,
    ...base(inicio),
  };
}

/** Diagnóstico de un error del Service Layer de SAP (SapError: message, status, detail). */
export function diagnosticoSap(e: { message?: string; status?: number; detail?: string }, contexto: { entidad?: string; docEntry?: number; url?: string } = {}, inicio = Date.now()): DiagnosticoNabuco {
  const j = parsearJson(e.detail ?? '');
  let codigo: string | null = null;
  let msgSap: string | null = null;
  if (j.ok && j.valor && typeof j.valor === 'object') {
    const err = (j.valor as { error?: { code?: unknown; message?: unknown } }).error;
    if (err) {
      codigo = err.code === undefined ? null : String(err.code);
      const m = err.message as unknown;
      msgSap = typeof m === 'string' ? m : m && typeof m === 'object' ? String((m as { value?: unknown }).value ?? '') : null;
    }
  }
  const ruta = /SAP (?:GET|POST|PATCH|DELETE|PUT) (\S+)/.exec(e.message ?? '')?.[1];
  const status = e.status ?? 0;
  const sugerencia =
    status === 401 ? 'La sesión del Service Layer expiró o las credenciales de la conexión SAP (sap_endpoints) son inválidas.'
    : status === 404 ? `El documento o la entidad no existe en SAP${contexto.docEntry ? ` (DocEntry ${contexto.docEntry})` : ''}.`
    : status === 400 ? 'Consulta OData inválida: revise el «Filtro OData adicional» y los campos del mapeo.'
    : 'Revise la conexión SAP (Service Layer) de la configuración y el mensaje de SAP.';
  return {
    ok: false,
    etapa: 'sap',
    mensaje: `SAP Service Layer${status ? ` (HTTP ${status})` : ''}${codigo ? ` código ${codigo}` : ''}: ${msgSap || e.message || 'error'}`,
    detalle: [contexto.entidad ? `Entidad: ${contexto.entidad}` : '', contexto.docEntry ? `DocEntry: ${contexto.docEntry}` : '', e.message ?? ''].filter(Boolean).join(' · '),
    sugerencia,
    ...(contexto.url || ruta ? { peticion: { metodo: /SAP (\w+)/.exec(e.message ?? '')?.[1] ?? 'GET', url: contexto.url ?? `{ServiceLayer}/${ruta}`, cabeceras: {} } } : {}),
    ...(e.detail ? { respuesta: { http_status: status, status_text: '', cabeceras: {}, cuerpo_crudo: recortar(e.detail), ...(j.ok ? { cuerpo_json: j.valor } : {}) } } : {}),
    ...base(inicio),
  };
}

export function diagnosticoInterno(e: unknown, inicio = Date.now()): DiagnosticoNabuco {
  const m = e instanceof Error ? e.message : String(e);
  return { ok: false, etapa: 'interno', mensaje: `Error interno de SynerLink: ${m}`, detalle: e instanceof Error ? e.name : undefined, ...base(inicio) };
}

// ---------------------------------------------------------------------------------- error y persistencia

/** Error que lleva el diagnóstico (falla de Nabuco, de red o de validación de la conexión). */
export class NabucoDiagnosticoError extends Error {
  diagnostico: DiagnosticoNabuco;
  status: number | null;
  constructor(d: DiagnosticoNabuco) {
    super(d.mensaje);
    this.name = 'NabucoDiagnosticoError';
    this.diagnostico = d;
    this.status = d.respuesta?.http_status ?? null;
  }
}

/** Reemplaza cualquier secreto conocido (contraseña, token) que haya quedado en el diagnóstico. */
export function sanitizarDiagnostico(d: DiagnosticoNabuco, secretos: (string | null | undefined)[]): DiagnosticoNabuco {
  const lista = secretos.filter((s): s is string => typeof s === 'string' && s.length >= 3).sort((a, b) => b.length - a.length);
  if (!lista.length) return d;
  let t = JSON.stringify(d);
  for (const s of lista) {
    const enJson = JSON.stringify(s).slice(1, -1);
    t = t.split(enJson).join(s.length > 20 ? enmascararToken(s) : PWD_OCULTO);
  }
  return JSON.parse(t) as DiagnosticoNabuco;
}

/** Resumen de una línea para columnas cortas (error NVARCHAR(2000)). */
export function resumenDiagnostico(d: DiagnosticoNabuco, max = 2000): string {
  const partes = [`[${d.etapa}]`, d.mensaje];
  if (d.red) partes.push(`(red: ${d.red.codigo})`);
  if (d.sugerencia) partes.push(`Sugerencia: ${d.sugerencia}`);
  const t = partes.join(' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function serializarDiagnostico(d: DiagnosticoNabuco): string {
  return JSON.stringify({ diagnostico_nabuco: 1, ...d });
}

/** Lee un diagnóstico serializado (columna `respuesta`); null si es una respuesta antigua/cruda. */
export function leerDiagnostico(t: string | null | undefined): DiagnosticoNabuco | null {
  if (!t || !t.startsWith('{"diagnostico_nabuco"')) return null;
  const j = parsearJson(t);
  if (!j.ok || !j.valor || typeof j.valor !== 'object') return null;
  const { diagnostico_nabuco: _v, ...d } = j.valor as Record<string, unknown>;
  return typeof d.etapa === 'string' && typeof d.mensaje === 'string' ? (d as unknown as DiagnosticoNabuco) : null;
}

/** Respuesta HTTP de NUESTRA API para un error (duck-typing por `name` para no acoplar BD/SAP). */
export function respuestaErrorApi(e: unknown, contextoSap: { entidad?: string } = {}): { status: number; body: Record<string, unknown> } {
  const err = e as { name?: string; message?: string; status?: number; detail?: string; diagnostico?: DiagnosticoNabuco } | null;
  // Fallas de Nabuco o de red (upstream): 200 con ok:false y el diagnóstico.
  if (err?.name === 'NabucoDiagnosticoError' && err.diagnostico) {
    const d = err.diagnostico;
    if (d.etapa === 'validacion') return { status: 400, body: { ok: false, error: d.mensaje, diagnostico: { ...d, http_synerlink: 400 } } };
    return { status: 200, body: { ok: false, error: d.mensaje, diagnostico: d } };
  }
  if (err?.name === 'SapError') {
    const d = diagnosticoSap(err, contextoSap);
    return { status: 200, body: { ok: false, error: d.mensaje, diagnostico: d } };
  }
  if (err?.name === 'NabucoError') {
    const status = typeof err.status === 'number' ? err.status : 400;
    const d: DiagnosticoNabuco = { ok: false, etapa: status >= 500 ? 'interno' : 'validacion', mensaje: err.message ?? 'Error', http_synerlink: status, ...base(Date.now()) };
    return { status, body: { ok: false, error: d.mensaje, diagnostico: d } };
  }
  const d = { ...diagnosticoInterno(e), http_synerlink: 500 };
  return { status: 500, body: { ok: false, error: d.mensaje, diagnostico: d } };
}
