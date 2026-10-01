/**
 * Relaciones entre documentos del SGC y mapa tipo Obsidian — funciones PURAS
 * (cliente y servidor).
 *
 * Tipos de relación (plan): procedimiento padre, formato, anexo y referencia,
 * cada uno con su color y su trazo. Las relaciones son solo entre documentos
 * de la misma empresa, nunca hacia módulos de proceso.
 */

export const SGC_RELATION_TYPES = ['procedimiento_padre', 'formato', 'anexo', 'referencia'] as const;
export type SgcRelationType = (typeof SGC_RELATION_TYPES)[number];

export const SGC_RELATION_LABELS: Record<SgcRelationType, string> = {
  procedimiento_padre: 'Procedimiento padre',
  formato: 'Formato',
  anexo: 'Anexo',
  referencia: 'Referencia',
};

/** Cómo se lee la relación desde el ORIGEN («A es … de B»). */
export const SGC_RELATION_PHRASES: Record<SgcRelationType, { out: string; in: string }> = {
  procedimiento_padre: { out: 'es procedimiento padre de', in: 'tiene como procedimiento padre a' },
  formato: { out: 'es formato de', in: 'usa el formato' },
  anexo: { out: 'es anexo de', in: 'tiene como anexo a' },
  referencia: { out: 'hace referencia a', in: 'es referenciado por' },
};

/** Color (hex de la paleta de Mantine, legible en claro y oscuro) y trazo de cada tipo. */
export const SGC_RELATION_STYLES: Record<SgcRelationType, { color: string; mantine: string; dash: string | null }> = {
  procedimiento_padre: { color: '#1c7ed6', mantine: 'blue', dash: null },
  formato: { color: '#2f9e44', mantine: 'green', dash: '6 4' },
  anexo: { color: '#e8590c', mantine: 'orange', dash: '2 4' },
  referencia: { color: '#7048e8', mantine: 'violet', dash: '10 4 2 4' },
};

export function isSgcRelationType(value: unknown): value is SgcRelationType {
  return typeof value === 'string' && (SGC_RELATION_TYPES as readonly string[]).includes(value);
}

export interface SgcGraphNode {
  id: number;
  code: string;
  title: string;
  versionNumber: number | null;
  status: string;
  idProcessType: number;
  processTypeCode: string;
  processType: string;
  processTypeColor: string;
  idProcess: number;
  process: string;
  idDepartment: number | null;
  idDocumentType: number;
  documentTypeCode: string;
}

export interface SgcGraphEdge {
  id: number;
  source: number;
  target: number;
  type: SgcRelationType;
  note: string | null;
}

export interface SgcGraphFilters {
  idProcessType?: number | null;
  idProcess?: number | null;
  idDepartment?: number | null;
  idDocumentType?: number | null;
  relationTypes?: readonly SgcRelationType[] | null;
  statuses?: readonly string[] | null;
  /** true: solo documentos con al menos una relación visible. */
  onlyConnected?: boolean;
}

/**
 * Aplica los filtros: un nodo queda si cumple los filtros de documento; una
 * arista queda si su tipo está permitido y sus DOS extremos quedaron.
 */
export function filterGraph(nodes: readonly SgcGraphNode[], edges: readonly SgcGraphEdge[], f: SgcGraphFilters): { nodes: SgcGraphNode[]; edges: SgcGraphEdge[] } {
  let keep = nodes.filter(
    (n) =>
      (!f.idProcessType || n.idProcessType === f.idProcessType) &&
      (!f.idProcess || n.idProcess === f.idProcess) &&
      (!f.idDepartment || n.idDepartment === f.idDepartment) &&
      (!f.idDocumentType || n.idDocumentType === f.idDocumentType) &&
      (!f.statuses || f.statuses.length === 0 || f.statuses.includes(n.status))
  );
  const ids = new Set(keep.map((n) => n.id));
  const keptEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && (!f.relationTypes || f.relationTypes.length === 0 || f.relationTypes.includes(e.type)));
  if (f.onlyConnected) {
    const linked = new Set(keptEdges.flatMap((e) => [e.source, e.target]));
    keep = keep.filter((n) => linked.has(n.id));
  }
  return { nodes: keep, edges: keptEdges };
}

/** Busca por código (exacto primero, luego por prefijo y luego contenido). */
export function findNodeByCode(nodes: readonly SgcGraphNode[], query: string): SgcGraphNode | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  return nodes.find((n) => n.code.toUpperCase() === q) ?? nodes.find((n) => n.code.toUpperCase().startsWith(q)) ?? nodes.find((n) => n.code.toUpperCase().includes(q)) ?? null;
}

export type SgcLayout = Record<string, { x: number; y: number }>;

/**
 * Posición inicial determinista: una columna por tipo de proceso (en orden) y,
 * dentro, los documentos agrupados por proceso. Las posiciones guardadas por
 * la persona tienen prioridad.
 */
export function initialLayout(nodes: readonly SgcGraphNode[], saved: SgcLayout = {}, order: readonly number[] = []): SgcLayout {
  const columns = [...new Set([...order, ...nodes.map((n) => n.idProcessType)])].filter((id) => nodes.some((n) => n.idProcessType === id));
  const out: SgcLayout = {};
  columns.forEach((col, ci) => {
    const inCol = nodes
      .filter((n) => n.idProcessType === col)
      .sort((a, b) => a.process.localeCompare(b.process, 'es') || a.code.localeCompare(b.code, 'es', { numeric: true }));
    inCol.forEach((n, ri) => {
      out[String(n.id)] = saved[String(n.id)] ?? { x: ci * 340, y: ri * 110 };
    });
  });
  return out;
}

/** Valida y limpia el diseño guardado (solo números finitos, máximo 2.000 nodos). */
export function sanitizeLayout(raw: unknown): SgcLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: SgcLayout = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 2000) return null;
  for (const [k, v] of entries) {
    if (!/^\d{1,9}$/.test(k) || !v || typeof v !== 'object') return null;
    const { x, y } = v as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
    out[k] = { x: Math.round(x), y: Math.round(y) };
  }
  return out;
}
