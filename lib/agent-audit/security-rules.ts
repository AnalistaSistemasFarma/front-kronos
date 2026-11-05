/**
 * AUDITORÍA DE AGENTES → ANÁLISIS DE SEGURIDAD DE CONVERSACIONES — piezas PURAS.
 *
 * Pedido de Nicolás Rivera (2026-11-05): «un botón de analizar: lee las conversaciones del
 * mes buscando inyecciones de prompt, posibles fugas o instrucciones maliciosas entre el
 * operador y el agente».
 *
 * Cómo funciona: el botón deja una corrida pendiente; el analizador de la Mac de horus
 * (scripts/agent-security/analizador.py) la toma, lee en SOLO LECTURA los mensajes del mes
 * de ESTE ambiente, enmascara secretos, clasifica con IA y publica los hallazgos aquí.
 * Sin BD ni `server-only`: lo usan la API, la pantalla y las pruebas.
 */
import { ocultarSecretos } from './inventory';

export const CATEGORIAS = {
  inyeccion_prompt: 'Inyección de prompt',
  instruccion_maliciosa: 'Instrucción maliciosa',
  fuga_datos: 'Fuga de datos',
  exfiltracion: 'Exfiltración',
  evasion_controles: 'Evasión de controles',
  ingenieria_social: 'Ingeniería social',
} as const;
export type Categoria = keyof typeof CATEGORIAS;

export const SEVERIDADES = { critica: 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja' } as const;
export type Severidad = keyof typeof SEVERIDADES;
export const ORDEN_SEVERIDAD: Severidad[] = ['critica', 'alta', 'media', 'baja'];

export const ESTADOS = {
  nuevo: 'Nuevo',
  revisado: 'Revisado',
  falso_positivo: 'Falso positivo',
  escalado: 'Escalado',
} as const;
export type EstadoHallazgo = keyof typeof ESTADOS;

export const CUMPLIO = { si: 'Sí', no: 'No', parcial: 'En parte', 'n/a': 'No aplica' } as const;
export type Cumplio = keyof typeof CUMPLIO;

export const DETECTORES = ['ia', 'reglas', 'reglas+ia'] as const;
export type Detector = (typeof DETECTORES)[number];

const es = <T extends string>(lista: readonly T[] | Record<T, unknown>, v: unknown): v is T =>
  typeof v === 'string' && (Array.isArray(lista) ? (lista as readonly string[]).includes(v) : Object.prototype.hasOwnProperty.call(lista, v));

export const esCategoria = (v: unknown): v is Categoria => es(CATEGORIAS, v);
export const esSeveridad = (v: unknown): v is Severidad => es(SEVERIDADES, v);
export const esEstado = (v: unknown): v is EstadoHallazgo => es(ESTADOS, v);

/** Meses que se pueden analizar: el actual y los 12 anteriores. */
export const MESES_ATRAS = 12;

/** «AAAA-MM» válido, no futuro y dentro de los últimos MESES_ATRAS meses. */
export function periodoValido(v: unknown, hoy = new Date()): v is string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return false;
  const [a, m] = v.split('-').map(Number);
  const indice = a * 12 + (m - 1);
  const actual = hoy.getUTCFullYear() * 12 + hoy.getUTCMonth();
  return indice <= actual && indice >= actual - MESES_ATRAS;
}

/** Mes actual en hora de Colombia (UTC-5), «AAAA-MM». */
export function periodoActual(hoy = new Date()): string {
  const local = new Date(hoy.getTime() - 5 * 3_600_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Lista de meses para el selector, del más reciente al más antiguo. */
export function periodosDisponibles(hoy = new Date(), cuantos = 6): string[] {
  const [a, m] = periodoActual(hoy).split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < cuantos; i += 1) {
    const idx = a * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Segunda barrera (el analizador ya enmascara): «contraseña: X», «la clave es X», «PIN: X»,
 * `Password=X;` de cadenas de conexión y bloques de llave privada.
 */
const ETIQUETA_SECRETO =
  /(\b(?:contrase(?:ñ|n)a|clave|password|passwd|pass|pwd|pin|secret|token)\b(?:[ \t]+[a-záéíóúñ]+){0,5}?[ \t]*(?:[:=]|\bes\b|\bis\b)[ \t]*["'«]?)(?!\[OCULTO\])([^\s"'»,;|`]{4,})/gi;
const LLAVE_PRIVADA = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

export function ocultarSecretosTexto(texto: string): string {
  return ocultarSecretos(
    texto
      .replace(LLAVE_PRIVADA, '-----BEGIN PRIVATE KEY----- [OCULTO] -----END PRIVATE KEY-----')
      .replace(ETIQUETA_SECRETO, (_m, etiqueta: string) => `${etiqueta}[OCULTO]`)
  );
}

/** Texto limpio: sin controles, con secretos ocultos y recortado. */
export function textoSeguro(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = ocultarSecretosTexto(v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim());
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const entero = (v: unknown, min = 0, max = 2_000_000_000): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

export class AnalisisValidacionError extends Error {}

export interface HallazgoEntrada {
  idMessage: number;
  idConversation: number;
  rol: 'user' | 'agent';
  messageAt: string;
  categoria: Categoria;
  severidad: Severidad;
  detector: Detector;
  reglas: string | null;
  evidencia: string | null;
  explicacion: string | null;
  recomendacion: string | null;
  agenteCumplio: Cumplio | null;
}

export interface PublicacionAnalisis {
  idRun: number;
  periodo: string;
  conversaciones: number | null;
  mensajesOperador: number | null;
  mensajesAgente: number | null;
  modelo: string | null;
  resumen: string | null;
  hallazgos: HallazgoEntrada[];
}

export const MAX_HALLAZGOS = 2_000;

/** Valida lo que manda el analizador. Todo texto pasa por textoSeguro (secretos ocultos). */
export function parsePublicacionAnalisis(body: unknown): PublicacionAnalisis {
  const b = (body ?? {}) as Record<string, unknown>;
  const idRun = entero(b.idRun, 1);
  if (!idRun) throw new AnalisisValidacionError('idRun inválido');
  if (!periodoValido(b.periodo)) throw new AnalisisValidacionError('periodo inválido (AAAA-MM)');
  if (!Array.isArray(b.hallazgos)) throw new AnalisisValidacionError('hallazgos debe ser una lista');
  if (b.hallazgos.length > MAX_HALLAZGOS) throw new AnalisisValidacionError(`Máximo ${MAX_HALLAZGOS} hallazgos por corrida`);
  const hallazgos: HallazgoEntrada[] = b.hallazgos.map((x, i) => {
    const h = (x ?? {}) as Record<string, unknown>;
    const idMessage = entero(h.idMessage, 1);
    const idConversation = entero(h.idConversation, 1);
    if (!idMessage || !idConversation) throw new AnalisisValidacionError(`Hallazgo ${i}: ids inválidos`);
    if (h.rol !== 'user' && h.rol !== 'agent') throw new AnalisisValidacionError(`Hallazgo ${i}: rol inválido`);
    if (typeof h.messageAt !== 'string' || Number.isNaN(Date.parse(h.messageAt)))
      throw new AnalisisValidacionError(`Hallazgo ${i}: fecha inválida`);
    if (!esCategoria(h.categoria)) throw new AnalisisValidacionError(`Hallazgo ${i}: categoría inválida`);
    if (!esSeveridad(h.severidad)) throw new AnalisisValidacionError(`Hallazgo ${i}: severidad inválida`);
    const detector = (DETECTORES as readonly string[]).includes(String(h.detector)) ? (h.detector as Detector) : 'ia';
    const cumplio = es(CUMPLIO, h.agenteCumplio) ? (h.agenteCumplio as Cumplio) : null;
    return {
      idMessage,
      idConversation,
      rol: h.rol,
      messageAt: new Date(h.messageAt).toISOString(),
      categoria: h.categoria,
      severidad: h.severidad,
      detector,
      reglas: textoSeguro(h.reglas, 300),
      evidencia: textoSeguro(h.evidencia, 800),
      explicacion: textoSeguro(h.explicacion, 1200),
      recomendacion: textoSeguro(h.recomendacion, 800),
      agenteCumplio: cumplio,
    };
  });
  return {
    idRun,
    periodo: b.periodo,
    conversaciones: entero(b.conversaciones),
    mensajesOperador: entero(b.mensajesOperador),
    mensajesAgente: entero(b.mensajesAgente),
    modelo: textoSeguro(b.modelo, 60),
    resumen: textoSeguro(b.resumen, 2000),
    hallazgos,
  };
}
