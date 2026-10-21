/**
 * HOJA DE VIDA COMPLETA (incremento 1, 2026-10-20) — lógica PURA, sin base de
 * datos, para poder probarla con vitest. La parte que toca Prisma está en
 * ./cv-completa-db.ts.
 *
 * Qué agrega sobre F2 (./cv.ts):
 *   - datos de ejecución que manda el recolector (credencial por HUELLA,
 *     arranque, rotación de sesión, huella de la personalidad, bloques de
 *     gobierno) y los eventos de línea de tiempo que salen de compararlos;
 *   - calidad de respuesta (tiempo de respuesta y mensajes sin respuesta)
 *     calculada SOLO con horas y autores de los mensajes, nunca con su texto;
 *   - validación de lo que se edita a mano: gobierno declarado (director,
 *     plantilla), casos vinculados y hallazgos de Gobierno IA.
 */
import { ocultarSecretos } from './inventory';

// ── Datos de ejecución (los manda el recolector) ────────────────────────────

export const AUTH_MODES = ['token', 'api-key', 'oauth-llavero', 'perfil-openclaw', 'desconocido'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface BloqueGobierno {
  /** Marcador del bloque, p. ej. 'GOBIERNO-IA-MINPRIV'. */
  marker: string;
  /** Día en que se agregó, según el propio marcador ('YYYY-MM-DD'). */
  addedOn: string | null;
  /** Quién lo agregó, según el marcador. */
  author: string | null;
  /** Caso de SynerLink citado en el marcador. */
  caseRef: number | null;
  /** Texto del bloque (reglas en lenguaje natural; pasa por el filtro de secretos). */
  text: string | null;
  /** Archivo donde está (solo el nombre). */
  file: string | null;
}

export interface InventoryRuntime {
  authMode: AuthMode;
  authDetail: string | null;
  /** 12 hex del sha256 de la credencial. NUNCA el valor. */
  tokenFingerprint: string | null;
  processStartedAt: Date | null;
  lastRotationAt: Date | null;
  lastRotationStatus: string | null;
  lastRotationDetail: string | null;
  personaFingerprint: string | null;
  personaFiles: string[];
  governance: BloqueGobierno[];
  usageHook: boolean | null;
}

const RE_HUELLA = /^[a-f0-9]{8,16}$/;

function textoSeguro(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = ocultarSecretos(v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim());
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function fechaValida(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  // Ni antes de que existiera la flota ni en el futuro lejano: un reloj roto no
  // debe llenar la línea de tiempo de basura.
  if (d.getTime() < Date.UTC(2025, 0, 1) || d.getTime() > Date.now() + 2 * 86_400_000) return null;
  return d;
}

function huella(v: unknown): string | null {
  return typeof v === 'string' && RE_HUELLA.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null;
}

export const MAX_BLOQUES_GOBIERNO = 8;
export const MAX_TEXTO_BLOQUE = 2000;

/**
 * Valida el objeto `runtime` de un agente. Todo es opcional: un recolector
 * viejo no lo manda y el inventario se guarda igual (devuelve null).
 */
export function parseRuntime(v: unknown): InventoryRuntime | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const authMode = (AUTH_MODES as readonly string[]).includes(String(o.authMode))
    ? (o.authMode as AuthMode)
    : 'desconocido';
  const governance: BloqueGobierno[] = (Array.isArray(o.governance) ? o.governance : [])
    .slice(0, MAX_BLOQUES_GOBIERNO)
    .map((b): BloqueGobierno | null => {
      if (typeof b !== 'object' || b === null) return null;
      const x = b as Record<string, unknown>;
      const marker = textoSeguro(x.marker, 60);
      if (!marker || !/^GOBIERNO-IA[A-Z0-9-]*$/.test(marker)) return null;
      const addedOn = typeof x.addedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.addedOn) ? x.addedOn : null;
      const caseRef =
        typeof x.caseRef === 'number' && Number.isInteger(x.caseRef) && x.caseRef > 0 && x.caseRef < 10_000_000
          ? x.caseRef
          : null;
      return {
        marker,
        addedOn,
        author: textoSeguro(x.author, 60),
        caseRef,
        text: textoSeguro(x.text, MAX_TEXTO_BLOQUE),
        file: textoSeguro(x.file, 120),
      };
    })
    .filter((x): x is BloqueGobierno => x !== null);
  const personaFiles = (Array.isArray(o.personaFiles) ? o.personaFiles : [])
    .map((f) => textoSeguro(f, 80))
    .filter((f): f is string => Boolean(f))
    .slice(0, 8);
  return {
    authMode,
    authDetail: textoSeguro(o.authDetail, 120),
    tokenFingerprint: huella(o.tokenFingerprint),
    processStartedAt: fechaValida(o.processStartedAt),
    lastRotationAt: fechaValida(o.lastRotationAt),
    lastRotationStatus: textoSeguro(o.lastRotationStatus, 30),
    lastRotationDetail: textoSeguro(o.lastRotationDetail, 300),
    personaFingerprint: huella(o.personaFingerprint),
    personaFiles,
    governance,
    usageHook: typeof o.usageHook === 'boolean' ? o.usageHook : null,
  };
}

/**
 * Datos de ejecución de cada agente que vienen en el cuerpo crudo del
 * recolector (campo `runtime` de cada agente), por código. Va aparte de
 * parseInventoryPayload para no tocar el contrato de F1: un recolector sin
 * `runtime` sigue funcionando igual.
 */
export function extraerRuntimes(body: unknown): Map<string, InventoryRuntime> {
  const r = new Map<string, InventoryRuntime>();
  if (typeof body !== 'object' || body === null) return r;
  const agentes = (body as Record<string, unknown>).agents;
  if (!Array.isArray(agentes)) return r;
  for (const a of agentes) {
    if (typeof a !== 'object' || a === null) continue;
    const o = a as Record<string, unknown>;
    if (typeof o.code !== 'string') continue;
    const rt = parseRuntime(o.runtime);
    if (rt && !r.has(o.code.toLowerCase())) r.set(o.code.toLowerCase(), rt);
  }
  return r;
}

// ── Eventos de la línea de tiempo que salen de los datos de ejecución ───────

export interface EventoRuntime {
  occurredAt: Date;
  kind: 'reinicio' | 'rotacion' | 'gobierno' | 'credencial' | 'personalidad';
  title: string;
  detail: string | null;
  sourceRef: string;
}

/** Un día 'YYYY-MM-DD' de Colombia a mediodía (para que no cambie de fecha). */
function mediodia(dia: string): Date {
  return new Date(`${dia}T17:00:00.000Z`);
}

const MODO: Record<string, string> = {
  token: 'token propio de larga duración',
  'api-key': 'llave de API',
  'oauth-llavero': 'sesión OAuth guardada en el llavero',
  'perfil-openclaw': 'perfil de autenticación de openclaw',
  desconocido: 'sin determinar',
};

export function nombreModoAuth(m: string | null | undefined): string {
  return MODO[m ?? 'desconocido'] ?? m ?? 'sin determinar';
}

/**
 * Eventos que se deducen al comparar los datos de ejecución de un inventario
 * con los del anterior. `prev` null = primer inventario con estos datos: solo
 * se registran los hechos fechados (arranque, rotación, bloques de gobierno),
 * no los "cambios" de credencial o personalidad, que necesitan un antes.
 *
 * El `sourceRef` hace idempotente la reconstrucción: el mismo arranque visto
 * en diez escaneos produce una sola entrada.
 */
export function eventosRuntime(
  prev: InventoryRuntime | null,
  next: InventoryRuntime,
  /** Hora del escaneo que detectó el cambio (para los eventos sin fecha propia). */
  at: Date
): EventoRuntime[] {
  const ev: EventoRuntime[] = [];

  if (next.processStartedAt) {
    const t = next.processStartedAt.getTime();
    const antes = prev?.processStartedAt?.getTime() ?? null;
    // Dos lecturas del mismo arranque pueden diferir unos segundos (reloj y
    // redondeo de `ps`): menos de 3 minutos es el mismo arranque.
    if (antes === null || Math.abs(antes - t) > 3 * 60_000) {
      ev.push({
        occurredAt: next.processStartedAt,
        kind: 'reinicio',
        title: prev ? 'Se reinició el agente' : 'Arranque del agente en ejecución',
        detail: null,
        sourceRef: `reinicio:${Math.round(t / 60_000)}`,
      });
    }
  }

  if (next.lastRotationAt) {
    const dia = next.lastRotationAt.toISOString().slice(0, 10);
    const ok = (next.lastRotationStatus ?? '').toLowerCase() === 'ok';
    ev.push({
      occurredAt: next.lastRotationAt,
      kind: 'rotacion',
      title: ok ? 'Rotación semanal de sesión' : `Rotación semanal de sesión (${next.lastRotationStatus ?? 'sin estado'})`,
      detail: next.lastRotationDetail,
      sourceRef: `rotacion:${dia}`,
    });
  }

  for (const b of next.governance) {
    ev.push({
      occurredAt: b.addedOn ? mediodia(b.addedOn) : at,
      kind: 'gobierno',
      title: `Se aplicó el bloque de gobierno ${b.marker}${b.caseRef ? ` (caso #${b.caseRef})` : ''}`,
      detail: [b.author ? `Lo agregó ${b.author}` : null, b.file ? `en ${b.file}` : null].filter(Boolean).join(' ') || null,
      sourceRef: `gob:${b.marker}:${b.caseRef ?? 'sin-caso'}:${b.addedOn ?? 'sin-fecha'}`,
    });
  }

  if (prev) {
    if (prev.tokenFingerprint !== next.tokenFingerprint || prev.authMode !== next.authMode) {
      const de = prev.tokenFingerprint ? `huella ${prev.tokenFingerprint}` : nombreModoAuth(prev.authMode);
      const a = next.tokenFingerprint ? `huella ${next.tokenFingerprint}` : nombreModoAuth(next.authMode);
      if (de !== a) {
        ev.push({
          occurredAt: at,
          kind: 'credencial',
          title: 'Cambió la credencial del agente',
          detail: `De ${de} a ${a}. Solo se guardan huellas: nunca el valor de la credencial.`,
          sourceRef: `cred:${prev.tokenFingerprint ?? prev.authMode}>${next.tokenFingerprint ?? next.authMode}`,
        });
      }
    }
    if (prev.personaFingerprint && next.personaFingerprint && prev.personaFingerprint !== next.personaFingerprint) {
      ev.push({
        occurredAt: at,
        kind: 'personalidad',
        title: 'Cambiaron las instrucciones o la personalidad del agente',
        detail: `Huella ${prev.personaFingerprint} → ${next.personaFingerprint}${next.personaFiles.length ? ` (${next.personaFiles.join(', ')})` : ''}.`,
        sourceRef: `persona:${prev.personaFingerprint}>${next.personaFingerprint}`,
      });
    }
  }
  return ev;
}

// ── Calidad de respuesta ─────────────────────────────────────────────────────

/** Minutos sin respuesta a partir de los cuales una pregunta cuenta como "sin respuesta". */
export const UMBRAL_SIN_RESPUESTA_MIN = 60;
/** Minutos sin que el agente recoja un mensaje a partir de los cuales es "entrega tardía". */
export const UMBRAL_ENTREGA_MIN = 10;

export interface Pregunta {
  /** Hora del primer mensaje de la persona en ese turno. */
  at: Date;
  /** Hora de la primera respuesta del agente después de esa pregunta (null = ninguna). */
  respondidaAt: Date | null;
}

export interface CalidadRespuesta {
  preguntas: number;
  respondidas: number;
  sinRespuesta: number;
  /** Sin respuesta todavía, pero aún dentro del umbral (no cuentan como falla). */
  enEspera: number;
  medianaSeg: number | null;
  p90Seg: number | null;
}

function percentil(ordenados: number[], p: number): number | null {
  if (ordenados.length === 0) return null;
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  return ordenados[i];
}

/**
 * Tiempo de respuesta y preguntas sin respuesta. Una "pregunta" es el primer
 * mensaje de una persona después de un mensaje del agente (o al abrir el hilo):
 * si la persona manda tres mensajes seguidos, cuenta uno. Solo hilos directos:
 * en un grupo no todo mensaje va dirigido al agente.
 */
export function calidadRespuesta(
  preguntas: Pregunta[],
  ahora: Date = new Date(),
  umbralMin = UMBRAL_SIN_RESPUESTA_MIN
): CalidadRespuesta {
  const umbral = umbralMin * 60_000;
  const tiempos: number[] = [];
  let sinRespuesta = 0;
  let enEspera = 0;
  for (const p of preguntas) {
    const espera = p.respondidaAt ? p.respondidaAt.getTime() - p.at.getTime() : null;
    if (espera !== null && espera <= umbral) {
      tiempos.push(Math.max(0, Math.round(espera / 1000)));
    } else if (espera !== null) {
      // Respondió, pero tarde: cuenta su tiempo y además como sin respuesta a tiempo.
      tiempos.push(Math.round(espera / 1000));
      sinRespuesta += 1;
    } else if (ahora.getTime() - p.at.getTime() > umbral) {
      sinRespuesta += 1;
    } else {
      enEspera += 1;
    }
  }
  tiempos.sort((a, b) => a - b);
  return {
    preguntas: preguntas.length,
    respondidas: tiempos.length,
    sinRespuesta,
    enEspera,
    medianaSeg: percentil(tiempos, 50),
    p90Seg: percentil(tiempos, 90),
  };
}

export interface Entrega {
  creadoAt: Date;
  entregadoAt: Date | null;
}

/** Mensajes que el agente recogió tarde o que todavía no recoge (pasado el umbral). */
export function entregasConProblema(
  filas: Entrega[],
  ahora: Date = new Date(),
  umbralMin = UMBRAL_ENTREGA_MIN
): { tardias: number; pendientes: number } {
  const umbral = umbralMin * 60_000;
  let tardias = 0;
  let pendientes = 0;
  for (const f of filas) {
    if (f.entregadoAt) {
      if (f.entregadoAt.getTime() - f.creadoAt.getTime() > umbral) tardias += 1;
    } else if (ahora.getTime() - f.creadoAt.getTime() > umbral) {
      pendientes += 1;
    }
  }
  return { tardias, pendientes };
}

/** "45 s", "3 min", "1 h 20 min". */
export function duracionLegible(seg: number | null): string {
  if (seg === null) return '—';
  if (seg < 60) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// ── Gobierno declarado ───────────────────────────────────────────────────────

export class EntradaInvalidaError extends Error {}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function opcional(raw: unknown, max: number, campo: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new EntradaInvalidaError(`${campo}: debe ser texto.`);
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > max) throw new EntradaInvalidaError(`${campo}: máximo ${max} caracteres.`);
  return t;
}

function diaOpcional(raw: unknown, campo: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new EntradaInvalidaError(`${campo}: use el formato AAAA-MM-DD.`);
  }
  return raw;
}

export interface GobiernoEntrada {
  directorName: string | null;
  directorEmail: string | null;
  privilegeTemplate: string | null;
  privilegeAppliedOn: string | null;
  notes: string | null;
}

export function validarGobierno(body: unknown): GobiernoEntrada {
  if (!body || typeof body !== 'object') throw new EntradaInvalidaError('El cuerpo debe ser un objeto JSON.');
  const b = body as Record<string, unknown>;
  const directorEmail = opcional(b.directorEmail, 255, 'Correo del director');
  if (directorEmail && !RE_CORREO.test(directorEmail)) {
    throw new EntradaInvalidaError('Correo del director: no tiene formato de correo.');
  }
  return {
    directorName: opcional(b.directorName, 160, 'Director'),
    directorEmail: directorEmail?.toLowerCase() ?? null,
    privilegeTemplate: opcional(b.privilegeTemplate, 120, 'Plantilla de mínimo privilegio'),
    privilegeAppliedOn: diaOpcional(b.privilegeAppliedOn, 'Fecha de aplicación'),
    notes: opcional(b.notes, 1000, 'Notas'),
  };
}

export function cambiosGobierno(antes: GobiernoEntrada | null, despues: GobiernoEntrada): string[] {
  const a = antes ?? { directorName: null, directorEmail: null, privilegeTemplate: null, privilegeAppliedOn: null, notes: null };
  const c: string[] = [];
  if ((a.directorName ?? '') !== (despues.directorName ?? '') || (a.directorEmail ?? '') !== (despues.directorEmail ?? '')) {
    const quien = [despues.directorName, despues.directorEmail].filter(Boolean).join(' · ');
    c.push(quien ? `Director: ${quien}.` : 'Se quitó el director.');
  }
  if ((a.privilegeTemplate ?? '') !== (despues.privilegeTemplate ?? '') || (a.privilegeAppliedOn ?? '') !== (despues.privilegeAppliedOn ?? '')) {
    c.push(
      despues.privilegeTemplate
        ? `Mínimo privilegio: ${despues.privilegeTemplate}${despues.privilegeAppliedOn ? ` (aplicado el ${despues.privilegeAppliedOn})` : ''}.`
        : 'Se quitó la plantilla de mínimo privilegio.'
    );
  }
  if ((a.notes ?? '') !== (despues.notes ?? '')) c.push(despues.notes ? 'Se actualizaron las notas de gobierno.' : 'Se borraron las notas de gobierno.');
  return c;
}

// ── Casos vinculados ─────────────────────────────────────────────────────────

export const RELACIONES_CASO = ['gobierno-ia', 'incidente', 'cambio', 'otro'] as const;
export type RelacionCaso = (typeof RELACIONES_CASO)[number];

export function validarVinculoCaso(body: unknown): { idRequest: number; relation: RelacionCaso } {
  if (!body || typeof body !== 'object') throw new EntradaInvalidaError('El cuerpo debe ser un objeto JSON.');
  const b = body as Record<string, unknown>;
  const raw = typeof b.idRequest === 'string' ? b.idRequest.replace(/^#/, '').trim() : b.idRequest;
  const idRequest = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof idRequest !== 'number' || !Number.isInteger(idRequest) || idRequest <= 0 || idRequest > 99_999_999) {
    throw new EntradaInvalidaError('Número de caso inválido.');
  }
  const relation = (RELACIONES_CASO as readonly string[]).includes(String(b.relation))
    ? (b.relation as RelacionCaso)
    : null;
  if (!relation) throw new EntradaInvalidaError('Relación del caso inválida.');
  return { idRequest, relation };
}

// ── Hallazgos de Gobierno IA ─────────────────────────────────────────────────

export const SEVERIDADES_EXTERNAS = ['critico', 'alto', 'medio', 'bajo'] as const;
export const ESTADOS_EXTERNOS = ['abierto', 'resuelto', 'aceptado'] as const;

export interface HallazgoExternoEntrada {
  source: string;
  refCode: string;
  severity: (typeof SEVERIDADES_EXTERNAS)[number];
  title: string;
  detail: string | null;
  recommendation: string | null;
  reportedOn: string;
  idRequest: number | null;
}

export function validarHallazgoExterno(body: unknown): HallazgoExternoEntrada {
  if (!body || typeof body !== 'object') throw new EntradaInvalidaError('El cuerpo debe ser un objeto JSON.');
  const b = body as Record<string, unknown>;
  const title = opcional(b.title, 300, 'Hallazgo');
  if (!title) throw new EntradaInvalidaError('Escriba el hallazgo.');
  const refCode = opcional(b.refCode, 40, 'Código');
  if (!refCode || !/^[A-Za-z0-9._-]+$/.test(refCode)) {
    throw new EntradaInvalidaError('Código: solo letras, números, punto, guion y guion bajo (p. ej. H-01).');
  }
  const severity = (SEVERIDADES_EXTERNAS as readonly string[]).includes(String(b.severity))
    ? (b.severity as HallazgoExternoEntrada['severity'])
    : null;
  if (!severity) throw new EntradaInvalidaError('Severidad inválida.');
  const reportedOn = diaOpcional(b.reportedOn, 'Fecha del informe');
  if (!reportedOn) throw new EntradaInvalidaError('Fecha del informe: obligatoria.');
  let idRequest: number | null = null;
  if (b.idRequest !== undefined && b.idRequest !== null && b.idRequest !== '') {
    const n = Number(String(b.idRequest).replace(/^#/, ''));
    if (!Number.isInteger(n) || n <= 0) throw new EntradaInvalidaError('Número de caso inválido.');
    idRequest = n;
  }
  return {
    source: opcional(b.source, 120, 'Fuente') ?? 'Gobierno IA (Iván Gutiérrez)',
    refCode: refCode.toUpperCase(),
    severity,
    title,
    detail: opcional(b.detail, 2000, 'Detalle'),
    recommendation: opcional(b.recommendation, 1000, 'Recomendación'),
    reportedOn,
    idRequest,
  };
}

export function validarEstadoHallazgo(body: unknown): { status: (typeof ESTADOS_EXTERNOS)[number] } {
  if (!body || typeof body !== 'object') throw new EntradaInvalidaError('El cuerpo debe ser un objeto JSON.');
  const s = String((body as Record<string, unknown>).status);
  if (!(ESTADOS_EXTERNOS as readonly string[]).includes(s)) throw new EntradaInvalidaError('Estado inválido.');
  return { status: s as (typeof ESTADOS_EXTERNOS)[number] };
}
