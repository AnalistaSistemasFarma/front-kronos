/**
 * EQUIPO DE SUBAGENTES de un proyecto (F2, orquestador, 2026-10-18) — reglas
 * PURAS (sin base de datos). Pedido de Nicolás Rivera: «para el tema de
 * proyectos quiero que puedas, de primeras, sugerir subagentes especializados
 * para hacer las actividades que ellos requieran».
 *
 * Flujo:
 *   1. «Sugerir equipo» (al crear el proyecto o desde la sección Equipo) deja
 *      un PEDIDO; el puente de hilos del agente lo atiende con un `claude -p`
 *      sin herramientas y devuelve de 3 a 6 subagentes PROPUESTOS.
 *   2. El dueño aprueba, edita o descarta cada uno (el editor también, solo si
 *      PROYECTOS_EQUIPO_EDITOR_APRUEBA=1: decisión pendiente de Nicolás).
 *   3. Solo lo APROBADO va en el contexto del puente, que lo convierte en la
 *      definición `--agents` de Claude Code, con topes (puente-hilos/src/equipo.mjs).
 *
 * El catálogo de herramientas es CERRADO. La intersección real con los
 * conectores del perfil la hace el puente (que es quien conoce los MCP); aquí
 * se valida lo que la persona puede escoger y se recorta a lo que el perfil
 * admite, para no prometer en pantalla lo que el puente no dará.
 */
import { isKnownProfile } from '../chat/projects-rules';
import type { ProjectRole } from '../chat/projects-rules';

/* ───────────────────────────── Catálogo ───────────────────────────── */

export const HERRAMIENTAS_EQUIPO = ['archivos', 'trabajo', 'web', 'conectores'] as const;
export type HerramientaEquipo = (typeof HERRAMIENTAS_EQUIPO)[number];

export const HERRAMIENTA_INFO: Record<HerramientaEquipo, { label: string; description: string }> = {
  archivos: { label: 'Leer el proyecto', description: 'Archivos, vinculados y cronograma del proyecto.' },
  trabajo: { label: 'Escribir borradores', description: 'Documentos en su carpeta de trabajo. No escribe en SynerLink ni en SAP.' },
  web: { label: 'Navegar en internet', description: 'Buscar y leer páginas web públicas. Nunca envía datos de la empresa.' },
  conectores: { label: 'Consultar sistemas', description: 'Conectores de SOLO LECTURA del perfil del proyecto (por ejemplo, SAP).' },
};

export const MODELOS_SUBAGENTE = ['haiku', 'sonnet', 'opus'] as const;
export type ModeloSubagente = (typeof MODELOS_SUBAGENTE)[number];

export const MODELO_INFO: Record<ModeloSubagente, string> = {
  haiku: 'Haiku (rápido y económico)',
  sonnet: 'Sonnet (análisis)',
  opus: 'Opus (el más capaz, el más costoso)',
};

/** Perfiles con navegación web (el puente tiene la última palabra: perfiles.json). */
const PERFILES_CON_WEB = new Set(['farmalogica', 'olp', 'gss', 'comex-latam']);

/** Qué del catálogo admite un perfil. 'sin-conectores' no tiene conectores; los demás, sí. */
export function herramientasDisponibles(profileKey: string): HerramientaEquipo[] {
  if (!isKnownProfile(profileKey)) return ['archivos'];
  const out: HerramientaEquipo[] = ['archivos', 'trabajo'];
  if (PERFILES_CON_WEB.has(profileKey)) out.push('web');
  if (profileKey !== 'sin-conectores') out.push('conectores');
  return out;
}

/* ───────────────────────────── Límites ─────────────────────────────── */

export const MIN_SUGERIDOS = 3;
export const MAX_SUGERIDOS = 6;
/** Subagentes APROBADOS por proyecto (Anthropic recomienda de 3 a 5 en paralelo). */
export const MAX_EQUIPO = 6;
/** Filas no descartadas (propuestas + aprobadas). */
export const MAX_SUBAGENTES_VIVOS = 12;
export const MAX_NOMBRE_SUBAGENTE = 60;
export const MAX_ROL_SUBAGENTE = 300;
export const MAX_INSTRUCCIONES_SUBAGENTE = 4_000;

/** Topes por defecto (el puente los acota con los suyos). */
export const TOPE_SIMULTANEOS_DEFECTO = 3;
export const TOPE_SIMULTANEOS_MAX = 5;
export const PROFUNDIDAD_SUBAGENTES = 1;

/** Un pedido sin reclamar vence a los 30 min; uno reclamado y sin respuesta, a los 15. */
export const PEDIDO_PENDIENTE_VENCE_MS = 30 * 60_000;
export const PEDIDO_EN_CURSO_VENCE_MS = 15 * 60_000;
/** Pedidos por proyecto en 24 h (cada uno consume del plan del agente). */
export const MAX_PEDIDOS_DIA = 10;
/** Corridas que el puente reporta en un turno. */
export const MAX_CORRIDAS_POR_TURNO = 20;

/** Nombres que Claude Code ya usa para sus agentes incorporados (y los de la herramienta). */
export const NOMBRES_RESERVADOS = new Set([
  'general-purpose',
  'claude',
  'statusline-setup',
  'explore',
  'plan',
  'claude-code-guide',
  'output-style-setup',
  'agent',
  'task',
]);

/* ───────────────────────────── Estados ─────────────────────────────── */

export type EstadoSubagente = 'propuesto' | 'aprobado' | 'descartado';
export const ESTADO_SUBAGENTE_LABELS: Record<EstadoSubagente, string> = {
  propuesto: 'Propuesto',
  aprobado: 'Aprobado',
  descartado: 'Descartado',
};
export function esEstadoSubagente(v: unknown): v is EstadoSubagente {
  return v === 'propuesto' || v === 'aprobado' || v === 'descartado';
}

export type EstadoPedido = 'pendiente' | 'en_curso' | 'lista' | 'fallida' | 'vencida';

/* ───────────────────────────── Permisos ─────────────────────────────── */

export interface CapacidadesEquipo {
  /** Ver el equipo, la actividad y el consumo. */
  ver: boolean;
  /** Pedir una sugerencia (consume del plan del agente: dueño y editor, como escribirle). */
  sugerir: boolean;
  /** Aprobar, editar, descartar y restaurar subagentes. */
  aprobar: boolean;
  /** Encender o apagar el equipo y cambiar el tope de simultáneos. */
  configurar: boolean;
}

/**
 * ¿Puede el EDITOR aprobar el equipo? Por defecto NO (lo más seguro: aprobar
 * un subagente le da herramientas y gasto). Decisión pendiente de Nicolás; se
 * enciende con PROYECTOS_EQUIPO_EDITOR_APRUEBA=1 sin tocar código.
 */
export function editorApruebaEquipo(env: Record<string, string | undefined> = process.env): boolean {
  return (env.PROYECTOS_EQUIPO_EDITOR_APRUEBA ?? '').trim() === '1';
}

export function capacidadesEquipo(role: ProjectRole | null | undefined, archivado: boolean, editorAprueba: boolean): CapacidadesEquipo {
  const owner = role === 'owner';
  const editor = role === 'editor';
  const ver = owner || editor || role === 'reader';
  if (archivado) return { ver, sugerir: false, aprobar: false, configurar: false };
  return {
    ver,
    sugerir: owner || editor,
    aprobar: owner || (editor && editorAprueba),
    configurar: owner,
  };
}

/* ───────────────────────────── Validación ─────────────────────────────── */

export type Validacion<T> = { ok: true; value: T } | { ok: false; error: string };

/** Identificador para Claude Code a partir del nombre: sin tildes, [a-z0-9-], 3 a 40. */
export function slugDe(nombre: string, ocupados: Iterable<string> = []): string {
  const base =
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34)
      .replace(/-+$/g, '') || 'subagente';
  const usados = new Set(ocupados);
  let slug = base.length >= 3 ? base : `${base}-sub`.slice(0, 34);
  if (NOMBRES_RESERVADOS.has(slug)) slug = `${slug}-equipo`;
  let n = 2;
  const raiz = slug;
  while (usados.has(slug)) {
    slug = `${raiz}-${n}`;
    n += 1;
  }
  return slug;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export function esSlugValido(v: unknown): v is string {
  return typeof v === 'string' && SLUG.test(v) && !NOMBRES_RESERVADOS.has(v);
}

export interface MiembroValores {
  name: string;
  purpose: string;
  instructions: string | null;
  tools: HerramientaEquipo[];
  model: ModeloSubagente | null;
}

function texto(raw: unknown, max: number, campo: string, obligatorio: boolean): Validacion<string> {
  if (raw === undefined || raw === null) {
    return obligatorio ? { ok: false, error: `Falta ${campo}.` } : { ok: true, value: '' };
  }
  if (typeof raw !== 'string') return { ok: false, error: `${campo} debe ser texto.` };
  return { ok: true, value: raw.trim().slice(0, max) };
}

/**
 * Valida un subagente (de la persona o de la sugerencia del agente, que es
 * entrada NO confiable). Las herramientas se recortan a las que el perfil
 * admite; 'archivos' va siempre. Un modelo desconocido se rechaza (de la
 * persona) o se ignora (de la sugerencia, con `tolerante`).
 */
export function normalizarMiembro(
  raw: Record<string, unknown>,
  disponibles: readonly HerramientaEquipo[],
  opciones: { tolerante?: boolean } = {}
): Validacion<MiembroValores> {
  const nombre = texto(raw.name, MAX_NOMBRE_SUBAGENTE, 'el nombre', true);
  if (!nombre.ok) return nombre;
  const name = nombre.value.replace(/\s+/g, ' ');
  if (name.length < 3) return { ok: false, error: 'El nombre debe tener al menos 3 caracteres.' };
  const rol = texto(raw.purpose, MAX_ROL_SUBAGENTE, 'el rol', true);
  if (!rol.ok) return rol;
  const purpose = rol.value.replace(/\s+/g, ' ');
  if (!purpose) return { ok: false, error: 'Describa el rol del subagente.' };
  const ins = texto(raw.instructions, MAX_INSTRUCCIONES_SUBAGENTE, 'las instrucciones', false);
  if (!ins.ok) return ins;

  if (raw.tools !== undefined && !Array.isArray(raw.tools)) return { ok: false, error: 'Las herramientas deben ser una lista.' };
  const pedidas = (Array.isArray(raw.tools) ? raw.tools : []).map((t) => String(t));
  const fuera = pedidas.filter((t) => !(HERRAMIENTAS_EQUIPO as readonly string[]).includes(t));
  if (fuera.length > 0 && !opciones.tolerante) return { ok: false, error: `Herramienta fuera del catálogo: ${fuera[0]}.` };
  const noAdmitidas = pedidas.filter((t) => (HERRAMIENTAS_EQUIPO as readonly string[]).includes(t) && !disponibles.includes(t as HerramientaEquipo));
  if (noAdmitidas.length > 0 && !opciones.tolerante) {
    return { ok: false, error: `El perfil del proyecto no admite «${HERRAMIENTA_INFO[noAdmitidas[0] as HerramientaEquipo].label}».` };
  }
  const tools = HERRAMIENTAS_EQUIPO.filter((t) => t === 'archivos' || (pedidas.includes(t) && disponibles.includes(t)));

  let model: ModeloSubagente | null = null;
  if (raw.model !== undefined && raw.model !== null && raw.model !== '') {
    if ((MODELOS_SUBAGENTE as readonly unknown[]).includes(raw.model)) model = raw.model as ModeloSubagente;
    else if (!opciones.tolerante) return { ok: false, error: 'Modelo no admitido.' };
  }
  return { ok: true, value: { name, purpose, instructions: ins.value || null, tools, model } };
}

/** Herramientas guardadas (CSV) → lista del catálogo. Lo desconocido se ignora (falla hacia menos). */
export function herramientasDeDb(csv: string | null | undefined): HerramientaEquipo[] {
  const set = new Set((csv ?? '').split(',').map((x) => x.trim()));
  return HERRAMIENTAS_EQUIPO.filter((t) => t === 'archivos' || set.has(t));
}

export function herramientasADb(tools: readonly HerramientaEquipo[]): string {
  return HERRAMIENTAS_EQUIPO.filter((t) => t === 'archivos' || tools.includes(t)).join(',');
}

export function modeloDeDb(raw: string | null | undefined): ModeloSubagente | null {
  return (MODELOS_SUBAGENTE as readonly unknown[]).includes(raw) ? (raw as ModeloSubagente) : null;
}

/** Configuración del equipo del proyecto (solo el dueño). */
export function normalizarConfig(raw: Record<string, unknown>): Validacion<{ enabled?: boolean; maxParallel?: number }> {
  const out: { enabled?: boolean; maxParallel?: number } = {};
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'enabled debe ser verdadero o falso.' };
    out.enabled = raw.enabled;
  }
  if (raw.maxParallel !== undefined) {
    const n = Number(raw.maxParallel);
    if (!Number.isInteger(n) || n < 1 || n > TOPE_SIMULTANEOS_MAX) {
      return { ok: false, error: `El tope de subagentes a la vez va de 1 a ${TOPE_SIMULTANEOS_MAX}.` };
    }
    out.maxParallel = n;
  }
  if (out.enabled === undefined && out.maxParallel === undefined) return { ok: false, error: 'No hay cambios.' };
  return { ok: true, value: out };
}

/** Diferencias legibles para la auditoría: { campo: [antes, después] }. */
export function diferencias(antes: MiembroValores, despues: MiembroValores): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of ['name', 'purpose', 'instructions', 'model'] as const) {
    if ((antes[k] ?? null) !== (despues[k] ?? null)) out[k] = [antes[k] ?? null, despues[k] ?? null];
  }
  if (herramientasADb(antes.tools) !== herramientasADb(despues.tools)) out.tools = [antes.tools, despues.tools];
  return out;
}

/* ───────────────────────────── Corridas ─────────────────────────────── */

export interface CorridaValores {
  slug: string;
  description: string;
  status: 'ok' | 'error' | 'cancelado';
  startedAt: Date | null;
  endedAt: Date | null;
  durationMs: number | null;
  totalTokens: number;
  toolUses: number;
  model: string | null;
}

const MAX_ENTERO = 2_000_000_000;
function entero(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), MAX_ENTERO);
}
function fecha(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Una corrida que reporta el puente (entrada NO confiable: se recorta y se valida). */
export function normalizarCorrida(raw: unknown): CorridaValores | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!esSlugValido(r.slug)) return null;
  const status = r.status === 'ok' || r.status === 'error' ? r.status : 'cancelado';
  const description = typeof r.description === 'string' ? r.description.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  return {
    slug: r.slug,
    description: description || 'Sin descripción',
    status,
    startedAt: fecha(r.startedAt),
    endedAt: fecha(r.endedAt),
    durationMs: r.durationMs === null || r.durationMs === undefined ? null : entero(r.durationMs),
    totalTokens: entero(r.totalTokens),
    toolUses: entero(r.toolUses),
    model: typeof r.model === 'string' ? r.model.slice(0, 80) : null,
  };
}
