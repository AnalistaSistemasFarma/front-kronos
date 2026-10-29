/**
 * MEMORIAS DE LOS AGENTES — reglas puras (validación del envío del recolector,
 * barrera contra secretos y tipos que viajan a la pantalla). La parte que toca
 * la base está en ./memories-db.ts.
 *
 * Dos mapas (Nicolás, 2026-10-29):
 *   - GENERAL: todos los agentes por empresa → departamento → agente → memorias.
 *     Lo ve quien tiene la Auditoría de agentes, con su mismo alcance por empresa.
 *   - PERSONAL: los agentes marcados como personales de un correo
 *     (agent_memory_setting.private_owner_email). Solo los ve ese correo y NO
 *     aparecen en el mapa general, ni siquiera para la administración.
 *
 * NUNCA SE GUARDAN SECRETOS: el recolector ya los oculta y aquí pasa todo otra
 * vez por `ocultarSecretos` (la misma barrera del inventario).
 */
import { ocultarSecretos } from "./inventory";

export const MEMORY_SOURCES = ["engram", "openclaw", "markdown"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** Tipos que se muestran; cualquier otro llega como 'otro'. */
export const MEMORY_TYPES = [
  "decision",
  "regla",
  "procedimiento",
  "hallazgo",
  "correccion",
  "preferencia",
  "arquitectura",
  "configuracion",
  "resumen",
  "otro",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  decision: "Decisión",
  regla: "Regla de negocio",
  procedimiento: "Procedimiento",
  hallazgo: "Hallazgo",
  correccion: "Corrección",
  preferencia: "Preferencia",
  arquitectura: "Arquitectura",
  configuracion: "Configuración",
  resumen: "Resumen de sesión",
  otro: "Otro",
};

/** Tipos de engram (y sinónimos) → tipo de la pantalla. */
const ALIAS_TIPO: Record<string, MemoryType> = {
  decision: "decision",
  manual: "procedimiento",
  procedure: "procedimiento",
  pattern: "procedimiento",
  convention: "regla",
  rule: "regla",
  rn: "regla",
  discovery: "hallazgo",
  learning: "hallazgo",
  reference: "hallazgo",
  project: "hallazgo",
  bugfix: "correccion",
  bug_fix: "correccion",
  bug: "correccion",
  solution: "correccion",
  feedback: "preferencia",
  user: "preferencia",
  preference: "preferencia",
  architecture: "arquitectura",
  config: "configuracion",
  session_summary: "resumen",
};

export function normalizarTipo(v: unknown): MemoryType {
  if (typeof v !== "string") return "otro";
  const k = v.trim().toLowerCase();
  if ((MEMORY_TYPES as readonly string[]).includes(k)) return k as MemoryType;
  return ALIAS_TIPO[k] ?? "otro";
}

export const LIMITES = {
  agentes: 60,
  memoriasPorAgente: 5000,
  enlacesPorAgente: 20000,
  titulo: 400,
  contenido: 20000,
  clave: 200,
  tema: 200,
  host: 120,
  errores: 50,
} as const;

export class MemoryValidationError extends Error {}

/** Cuenta cuántos fragmentos ocultó la barrera (para la cifra «Secretos ocultos»). */
export function limpiarTexto(
  v: unknown,
  max: number,
): { texto: string | null; ocultos: number } {
  if (typeof v !== "string") return { texto: null, ocultos: 0 };
  // Se conservan saltos de línea y tabuladores; el resto de controles, fuera.
  const crudo = v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  if (!crudo) return { texto: null, ocultos: 0 };
  const limpio = ocultarSecretos(crudo);
  const ocultos =
    (limpio.match(/<oculto>/g)?.length ?? 0) -
    (crudo.match(/<oculto>/g)?.length ?? 0);
  const texto = limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
  return { texto, ocultos: Math.max(0, ocultos) };
}

function fecha(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(
    v.includes("T") || v.endsWith("Z") ? v : `${v.replace(" ", "T")}Z`,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface MemoryInput {
  sourceKey: string;
  title: string;
  content: string | null;
  type: MemoryType;
  topic: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  secretsHidden: number;
}
export interface LinkInput {
  from: string;
  to: string;
  relation: string;
}
export interface AgentMemoriesInput {
  code: string;
  source: MemorySource;
  memories: MemoryInput[];
  links: LinkInput[];
}
export interface MemoriesPayload {
  host: string;
  collectorVersion: string | null;
  agents: AgentMemoriesInput[];
  errors: string[];
}

/** Valida y limpia lo que publica el recolector. Lanza MemoryValidationError. */
export function parseMemoriesPayload(body: unknown): MemoriesPayload {
  if (!body || typeof body !== "object")
    throw new MemoryValidationError("Cuerpo vacío.");
  const b = body as Record<string, unknown>;
  const host = limpiarTexto(b.host, LIMITES.host).texto;
  if (!host) throw new MemoryValidationError("Falta el equipo (host).");
  if (!Array.isArray(b.agents))
    throw new MemoryValidationError("Falta la lista de agentes.");
  if (b.agents.length > LIMITES.agentes)
    throw new MemoryValidationError("Demasiados agentes.");

  const agents: AgentMemoriesInput[] = b.agents.map((raw, i) => {
    const a = (raw ?? {}) as Record<string, unknown>;
    const code = typeof a.code === "string" ? a.code.trim().toLowerCase() : "";
    if (!/^[a-z0-9._-]{1,60}$/.test(code))
      throw new MemoryValidationError(`Agente ${i + 1}: código inválido.`);
    const source = (MEMORY_SOURCES as readonly string[]).includes(
      String(a.source),
    )
      ? (a.source as MemorySource)
      : null;
    if (!source)
      throw new MemoryValidationError(`Agente ${code}: origen inválido.`);
    const rawMems = Array.isArray(a.memories) ? a.memories : [];
    if (rawMems.length > LIMITES.memoriasPorAgente)
      throw new MemoryValidationError(`Agente ${code}: demasiadas memorias.`);

    const vistas = new Set<string>();
    const memories: MemoryInput[] = [];
    for (const rm of rawMems) {
      const m = (rm ?? {}) as Record<string, unknown>;
      const key =
        typeof m.sourceKey === "string"
          ? m.sourceKey.trim().slice(0, LIMITES.clave)
          : "";
      if (!key || vistas.has(key)) continue;
      const t = limpiarTexto(m.title, LIMITES.titulo);
      if (!t.texto) continue;
      const c = limpiarTexto(m.content, LIMITES.contenido);
      const tema = limpiarTexto(m.topic, LIMITES.tema);
      vistas.add(key);
      memories.push({
        sourceKey: key,
        title: t.texto,
        content: c.texto,
        type: normalizarTipo(m.type),
        topic: tema.texto,
        createdAt: fecha(m.createdAt),
        updatedAt: fecha(m.updatedAt),
        secretsHidden: t.ocultos + c.ocultos + tema.ocultos,
      });
    }

    const rawLinks = Array.isArray(a.links)
      ? a.links.slice(0, LIMITES.enlacesPorAgente)
      : [];
    const links: LinkInput[] = [];
    for (const rl of rawLinks) {
      const l = (rl ?? {}) as Record<string, unknown>;
      const from = typeof l.from === "string" ? l.from.trim() : "";
      const to = typeof l.to === "string" ? l.to.trim() : "";
      if (!vistas.has(from) || !vistas.has(to) || from === to) continue;
      const relation =
        typeof l.relation === "string" && /^[a-z_]{2,40}$/.test(l.relation)
          ? l.relation
          : "related";
      links.push({ from, to, relation });
    }
    return { code, source, memories, links };
  });

  const errors = Array.isArray(b.errors)
    ? b.errors
        .slice(0, LIMITES.errores)
        .map((e) => limpiarTexto(e, 300).texto)
        .filter((e): e is string => Boolean(e))
    : [];
  const collectorVersion = limpiarTexto(b.collectorVersion, 20).texto;
  return { host, collectorVersion, agents, errors };
}

// ── Lo que viaja a la pantalla ───────────────────────────────────────────────

/** general / personal = mapas de la Auditoría; agente = la memoria de UN agente (botón del chat). */
export type MemoryMap = "general" | "personal" | "agente";

export interface MapAgentDto {
  idAgent: number;
  code: string;
  displayName: string;
  companyId: number | null;
  companyName: string | null;
  department: string | null;
}
export interface MapMemoryDto {
  id: number;
  idAgent: number;
  title: string;
  type: MemoryType;
  topic: string | null;
  updatedAt: string | null;
}
export interface MapLinkDto {
  from: number;
  to: number;
  relation: string;
}
export interface MemoryMapDto {
  mapa: MemoryMap;
  agentes: MapAgentDto[];
  memorias: MapMemoryDto[];
  enlaces: MapLinkDto[];
  secretosOcultos: number;
  ultimaRecoleccion: string | null;
  tieneMapaPersonal: boolean;
}
export interface MemoryDetailDto extends MapMemoryDto {
  content: string | null;
  source: string;
  createdAt: string | null;
  secretsHidden: number;
}

/**
 * Tema del mapa personal: el prefijo del topic_key de engram
 * («sgc/encabezado» → «sgc»), o el tipo si no hay tema.
 */
export function temaPrincipal(m: Pick<MapMemoryDto, "topic" | "type">): string {
  const t = (m.topic ?? "").trim().toLowerCase();
  if (t) {
    const cabeza = t.split(/[/:.#]/)[0]?.trim();
    if (cabeza) return cabeza.slice(0, 40);
  }
  return MEMORY_TYPE_LABEL[m.type].toLowerCase();
}
