/**
 * PROYECTOS (hilos de agente) del chat — reglas PURAS (sin base de datos).
 *
 * F1 piloto aprobado por Nicolás Rivera el 2026-10-17. Ver el encabezado de
 * `ChatProject` en prisma/schema.prisma para el porqué.
 *
 * Aquí vive todo lo que se puede probar sin Prisma: el interruptor del módulo
 * (qué agentes tienen proyectos y con qué perfiles de conectores), el catálogo
 * de perfiles y las validaciones de nombre, instrucciones y miembros. La parte
 * que toca la base está en lib/chat/projects.ts.
 *
 * -------------------------------------------------------------------------
 * INTERRUPTOR: CHAT_PROJECTS_AGENTS
 * -------------------------------------------------------------------------
 * JSON en el .env del servidor (nunca en el repo):
 *
 *   CHAT_PROJECTS_AGENTS={"play":["farmalogica","olp","comex-latam"]}
 *
 * La clave es el `code` del agente; el valor, los PERFILES de conectores que
 * se pueden escoger al crear un proyecto con ese agente. CERRADO POR DEFECTO:
 * sin la variable, o con un JSON inválido, ningún agente tiene proyectos y
 * todas las rutas del módulo responden 404.
 */

/** Un perfil de conectores. El PUENTE (puente-hilos/) decide qué MCP monta. */
export interface ProjectProfile {
  key: string;
  label: string;
  description: string;
}

/**
 * Catálogo de perfiles. Es solo la ETIQUETA que ve la persona; la lista real
 * de conectores de cada perfil vive en la configuración del puente
 * (puente-hilos/config/perfiles.json), porque es allí donde se lanzan.
 * Agregar un perfil aquí no le da acceso a nada si el puente no lo conoce:
 * el puente rechaza un perfil desconocido (falla cerrado).
 */
export const PROJECT_PROFILES: readonly ProjectProfile[] = [
  {
    key: 'sin-conectores',
    label: 'Sin conectores',
    description: 'Solo conversación, instrucciones y archivos del proyecto.',
  },
  {
    key: 'farmalogica',
    label: 'Farmalógica',
    description: 'SAP Business One de Farmalógica (solo lectura) y consulta de páginas web públicas.',
  },
  {
    key: 'olp',
    label: 'One Latam Pharma',
    description: 'SAP Business One de OLP (solo lectura) y consulta de páginas web públicas.',
  },
  { key: 'ryan', label: 'Laboratorios Ryan', description: 'SAP Business One de Ryan (solo lectura).' },
  { key: 'abamia', label: 'Abamia', description: 'SAP Business One de Abamia (solo lectura).' },
  { key: 'kelab', label: 'Kelab', description: 'SAP Business One de Kelab (solo lectura).' },
  { key: 'meditrack', label: 'Meditrack', description: 'SAP Business One de Meditrack (solo lectura).' },
  {
    key: 'comex-latam',
    label: 'Comex Latam',
    description: 'Comercio exterior: búsqueda y lectura de páginas web, y SAP de OLP (solo lectura).',
  },
];

const PROFILE_KEYS = new Set(PROJECT_PROFILES.map((p) => p.key));

export function isKnownProfile(key: unknown): key is string {
  return typeof key === 'string' && PROFILE_KEYS.has(key);
}

export function profileLabel(key: string): string {
  return PROJECT_PROFILES.find((p) => p.key === key)?.label ?? key;
}

/* ───────────────────────────── Límites ─────────────────────────────── */

export const MAX_PROJECT_NAME_CHARS = 120;
/** Instrucciones del proyecto. Van en cada turno: un tope evita quemar fichas. */
export const MAX_PROJECT_INSTRUCTIONS_CHARS = 8_000;
/** Miembros por proyecto, contando al dueño. */
export const MAX_PROJECT_MEMBERS = 20;
/** Archivos por proyecto. */
export const MAX_PROJECT_FILES = 20;
/** Proyectos ACTIVOS que una persona puede ser dueña con un mismo agente. */
export const MAX_OWNED_PROJECTS_PER_AGENT = 10;
/** Conversaciones activas por proyecto. */
export const MAX_PROJECT_CONVERSATIONS = 50;

export type ProjectRole = 'owner' | 'member';

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === 'owner' || value === 'member';
}

/* ─────────────────────────── Interruptor ───────────────────────────── */

/**
 * Valida el JSON de CHAT_PROJECTS_AGENTS. Lanza con un mensaje claro: es
 * mejor fallar ruidosamente que quedar con una configuración que "casi" vale.
 */
export function parseProjectAgents(raw: string): Map<string, string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`CHAT_PROJECTS_AGENTS no es JSON válido: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('CHAT_PROJECTS_AGENTS debe ser un objeto {"<code del agente>": ["perfil", …]}.');
  }

  const out = new Map<string, string[]>();
  for (const [code, perfiles] of Object.entries(parsed as Record<string, unknown>)) {
    const agentCode = code.trim().toLowerCase();
    if (!agentCode) throw new Error('CHAT_PROJECTS_AGENTS tiene un agente sin código.');
    if (!Array.isArray(perfiles) || perfiles.length === 0) {
      throw new Error(`El agente "${agentCode}" debe tener al menos un perfil.`);
    }
    const lista: string[] = [];
    for (const p of perfiles) {
      if (!isKnownProfile(p)) {
        throw new Error(`Perfil desconocido para "${agentCode}": ${String(p)}.`);
      }
      if (!lista.includes(p)) lista.push(p);
    }
    out.set(agentCode, lista);
  }
  return out;
}

let cache: { raw: string; value: Map<string, string[]> } | null = null;

/**
 * Agentes con proyectos habilitados. Mapa VACÍO si no hay configuración o es
 * inválida (cerrado por defecto).
 */
export function loadProjectAgents(env: NodeJS.ProcessEnv = process.env): Map<string, string[]> {
  const raw = (env.CHAT_PROJECTS_AGENTS ?? '').trim();
  if (!raw) return new Map();
  if (cache && cache.raw === raw) return cache.value;
  try {
    cache = { raw, value: parseProjectAgents(raw) };
  } catch (err) {
    console.error('[chat/projects] configuración inválida:', (err as Error).message);
    cache = { raw, value: new Map() };
  }
  return cache.value;
}

/** Solo para pruebas. */
export function __resetProjectAgentsCache(): void {
  cache = null;
}

export function projectsEnabledFor(
  agentCode: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!agentCode) return false;
  return loadProjectAgents(env).has(agentCode.trim().toLowerCase());
}

export function profilesFor(
  agentCode: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (!agentCode) return [];
  return loadProjectAgents(env).get(agentCode.trim().toLowerCase()) ?? [];
}

/* ─────────────────────────── Validaciones ──────────────────────────── */

export type Validacion<T> = { ok: true; value: T } | { ok: false; error: string };

export function normalizeProjectName(raw: unknown): Validacion<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'El nombre del proyecto es obligatorio.' };
  // Sin saltos de línea ni espacios repetidos: es un título.
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'El nombre del proyecto es obligatorio.' };
  if (value.length > MAX_PROJECT_NAME_CHARS) {
    return { ok: false, error: `El nombre no puede pasar de ${MAX_PROJECT_NAME_CHARS} caracteres.` };
  }
  return { ok: true, value };
}

/** Instrucciones: opcionales. Vacías = null. */
export function normalizeProjectInstructions(raw: unknown): Validacion<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Las instrucciones deben ser texto.' };
  const value = raw.replace(/\r\n/g, '\n').trim();
  if (!value) return { ok: true, value: null };
  if (value.length > MAX_PROJECT_INSTRUCTIONS_CHARS) {
    return {
      ok: false,
      error: `Las instrucciones no pueden pasar de ${MAX_PROJECT_INSTRUCTIONS_CHARS} caracteres.`,
    };
  }
  return { ok: true, value };
}

/** Perfil: debe estar habilitado PARA ESE AGENTE, no solo existir. */
export function validateProfileForAgent(
  profile: unknown,
  agentCode: string,
  env: NodeJS.ProcessEnv = process.env
): Validacion<string> {
  const permitidos = profilesFor(agentCode, env);
  if (typeof profile !== 'string' || !permitidos.includes(profile)) {
    return { ok: false, error: 'Ese perfil de conectores no está habilitado para este asistente.' };
  }
  return { ok: true, value: profile };
}

/* ─────────────────────────── Miembros ─────────────────────────────── */

/** Solo el dueño administra el proyecto (miembros, instrucciones, archivos). */
export function canManageProject(role: ProjectRole | null | undefined): boolean {
  return role === 'owner';
}

/**
 * ¿Puede `actor` retirar a `target` del proyecto?
 *   - El dueño retira a cualquier miembro, pero NO a sí mismo (el proyecto
 *     se quedaría sin dueño; en F1 no hay traspaso).
 *   - Un miembro solo puede retirarse a sí mismo (salir del proyecto).
 */
export function canRemoveMember(opciones: {
  actorId: string;
  actorRole: ProjectRole;
  targetId: string;
  targetRole: ProjectRole;
}): { ok: true } | { ok: false; error: string } {
  const { actorId, actorRole, targetId, targetRole } = opciones;
  if (targetRole === 'owner') {
    return { ok: false, error: 'El dueño no se puede retirar del proyecto.' };
  }
  if (actorRole === 'owner') return { ok: true };
  if (actorId === targetId) return { ok: true };
  return { ok: false, error: 'Solo el dueño del proyecto puede retirar a otras personas.' };
}

/**
 * Normaliza la lista de ids que llega del cliente para invitar: sin
 * duplicados, sin vacíos y sin el propio actor.
 */
export function normalizeInviteIds(raw: unknown, actorId: string): Validacion<string[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'Debe indicar a quién invitar.' };
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, error: 'Identificador de persona inválido.' };
    const id = item.trim();
    if (!id || id.length > 1000) return { ok: false, error: 'Identificador de persona inválido.' };
    if (id !== actorId && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return { ok: false, error: 'Debe indicar a quién invitar.' };
  return { ok: true, value: ids };
}
