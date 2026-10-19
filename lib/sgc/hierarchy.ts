import type { SgcRelationType } from './relations';

/**
 * DOCUMENTOS PADRE E HIJOS del SGC (reunión con Calidad OLP del 2026-10-19,
 * RN rn-sgc-documento-padre-sin-padre) — funciones PURAS (cliente y servidor).
 *
 *   - El PROCEDIMIENTO (o el tipo documental que la empresa marque como
 *     «padre» en Configuración) es documento padre y NO TIENE PADRE: no se
 *     desprende de otro documento.
 *   - Los formatos, instructivos, anexos… que llevan su número son sus HIJOS.
 *     Un hijo tiene UN SOLO padre.
 *   - Desde el padre se ve todo lo que se desprende de él (vista en árbol del
 *     auditor y mapa de relaciones).
 *
 * La relación padre → hijo se guarda con los tipos de relación de siempre
 * (sgc.document_relation): «procedimiento padre» (se lee desde el padre) o
 * «formato» / «anexo» (se leen desde el hijo, como en las propuestas del S9).
 * «Referencia» NO es jerárquica: no cuenta como padre.
 */

/** Tipo documental para las reglas (código, nombre y la marca de la configuración). */
export interface SgcHierarchyType {
  code: string;
  name: string;
  isParentType: boolean;
}

/**
 * Códigos de los tipos documentales «padre» de la empresa: los marcados en
 * Configuración. Si la empresa no ha marcado ninguno, el procedimiento (código
 * PR o un nombre que empieza por «Procedimiento»), que es la regla de Calidad.
 */
export function parentTypeCodesOf(types: readonly SgcHierarchyType[]): string[] {
  const marked = types.filter((t) => t.isParentType).map((t) => t.code.trim().toUpperCase());
  if (marked.length) return [...new Set(marked)];
  return [...new Set(types.filter((t) => isProcedureType(t)).map((t) => t.code.trim().toUpperCase()))];
}

/**
 * 2026-10-19 (carga real de OLP): mientras ningún tipo está marcado, el
 * procedimiento es el padre por defecto. Al marcar el PRIMER tipo (p. ej. el
 * Manual), el procedimiento dejaría de ser padre sin que nadie lo pidiera y
 * sus formatos e instructivos quedarían sin poder relacionarse. Devuelve los
 * tipos procedimiento (activos, sin marcar) que deben quedar marcados junto
 * con `idMarking`; vacío si ya había algún tipo marcado (la configuración es
 * explícita) o si el que se marca es el propio procedimiento.
 */
export function defaultParentTypesToKeep<T extends SgcHierarchyType & { id: number; isActive: boolean }>(typesBefore: readonly T[], idMarking: number): T[] {
  if (typesBefore.some((t) => t.isParentType)) return [];
  return typesBefore.filter((t) => t.id !== idMarking && t.isActive && isProcedureType(t));
}

/** ¿Es un tipo «procedimiento» por su código o su nombre? (respaldo sin configuración). */
export function isProcedureType(t: Pick<SgcHierarchyType, 'code' | 'name'>): boolean {
  if (t.code.trim().toUpperCase() === 'PR') return true;
  const name = t.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  return name.startsWith('procedimiento');
}

export function isParentTypeCode(parentTypeCodes: readonly string[], code: string): boolean {
  return parentTypeCodes.includes(code.trim().toUpperCase());
}

/**
 * Tipo de relación según el tipo documental del HIJO: un formato «es formato
 * de» su procedimiento; un anexo «es anexo de»; el resto (instructivos…)
 * cuelga con «procedimiento padre». El mismo criterio de las propuestas del S9.
 */
export const SGC_HIERARCHY_TYPE_BY_CHILD: Readonly<Record<string, SgcRelationType>> = { FO: 'formato', FR: 'formato', AN: 'anexo' };

/** Relación que se guarda para «padre → hijo», con el sentido de su tipo. */
export function hierarchyRelationFor(idParent: number, idChild: number, childTypeCode: string): { idSource: number; idTarget: number; type: SgcRelationType } {
  const type = SGC_HIERARCHY_TYPE_BY_CHILD[childTypeCode.trim().toUpperCase()] ?? 'procedimiento_padre';
  // «formato» y «anexo» se leen desde el hijo («A es formato de B»); «procedimiento padre», desde el padre.
  return type === 'procedimiento_padre' ? { idSource: idParent, idTarget: idChild, type } : { idSource: idChild, idTarget: idParent, type };
}

/** Padre e hijo de una relación jerárquica (null si es «referencia»). */
export function hierarchyOf(rel: { source: number; target: number; type: string }): { parent: number; child: number } | null {
  if (rel.type === 'procedimiento_padre') return { parent: rel.source, child: rel.target };
  if (rel.type === 'formato' || rel.type === 'anexo') return { parent: rel.target, child: rel.source };
  return null;
}

export function isHierarchyRelationType(type: string): boolean {
  return type === 'procedimiento_padre' || type === 'formato' || type === 'anexo';
}

export interface SgcHierarchyDoc {
  id: number;
  code: string;
  status: string;
  documentTypeCode: string;
}

/**
 * ¿Se puede relacionar `child` como hijo de `parent`? Devuelve el motivo en
 * español si no se puede (o null). `parentOf` = padre actual de cada documento
 * (relaciones jerárquicas activas).
 */
export function parentChildError(parent: SgcHierarchyDoc, child: SgcHierarchyDoc, parentTypeCodes: readonly string[], parentOf: ReadonlyMap<number, number>): string | null {
  if (parent.id === child.id) return 'Un documento no puede ser padre de sí mismo.';
  if (parent.status === 'anulado' || child.status === 'anulado') return 'No se relacionan documentos anulados.';
  if (isParentTypeCode(parentTypeCodes, child.documentTypeCode)) {
    return `${child.code} es un documento padre (tipo ${child.documentTypeCode}): el documento padre no tiene padre.`;
  }
  if (!isParentTypeCode(parentTypeCodes, parent.documentTypeCode)) {
    const allowed = parentTypeCodes.length ? parentTypeCodes.join(', ') : 'ninguno configurado';
    return `${parent.code} no es de un tipo documental padre (tipos padre de la empresa: ${allowed}).`;
  }
  const current = parentOf.get(child.id);
  if (current !== undefined && current !== parent.id) return `${child.code} ya tiene documento padre: un hijo tiene un solo padre. Retire primero la relación actual.`;
  if (current === parent.id) return `${child.code} ya es hijo de ${parent.code}.`;
  return null;
}

/** Padre actual de cada documento según las relaciones jerárquicas (el primero, si hubiera datos viejos con más de uno). */
export function parentMapOf(edges: readonly { source: number; target: number; type: string }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of edges) {
    const h = hierarchyOf(e);
    if (h && !out.has(h.child)) out.set(h.child, h.parent);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vista en árbol del auditor
// ---------------------------------------------------------------------------

export interface SgcTreeDoc extends SgcHierarchyDoc {
  title: string;
  versionNumber: number | null;
  currentVersionId: number | null;
  documentType?: string;
  process?: string;
}

export interface SgcTreeNode<T extends SgcTreeDoc = SgcTreeDoc> {
  doc: T;
  /** Tipo de la relación con su padre (null en la raíz). */
  relationType: SgcRelationType | null;
  children: SgcTreeNode<T>[];
  /** Total de documentos que se desprenden (todos los niveles). */
  descendants: number;
}

export interface SgcDocumentTree<T extends SgcTreeDoc = SgcTreeDoc> {
  /** Documentos padre (los de tipo padre), cada uno con lo que se desprende de él. */
  roots: SgcTreeNode<T>[];
  /** Documentos que no son padre y no tienen padre (para relacionarlos). */
  orphans: T[];
  /** Hijos con más de un padre en datos anteriores a la regla (para que Calidad los corrija). */
  multipleParents: { doc: T; parents: T[] }[];
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, 'es', { numeric: true });

/**
 * Árbol documental: cada documento padre y, debajo, lo que se desprende de él
 * (recursivo y a prueba de ciclos de datos viejos). Solo con los documentos y
 * las relaciones que la persona puede consultar.
 */
export function buildDocumentTree<T extends SgcTreeDoc>(docs: readonly T[], edges: readonly { source: number; target: number; type: SgcRelationType }[], parentTypeCodes: readonly string[]): SgcDocumentTree<T> {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const childrenOf = new Map<number, { id: number; type: SgcRelationType }[]>();
  const parentsOf = new Map<number, number[]>();
  for (const e of edges) {
    const h = hierarchyOf(e);
    if (!h || !byId.has(h.parent) || !byId.has(h.child) || h.parent === h.child) continue;
    const list = childrenOf.get(h.parent) ?? [];
    if (!list.some((c) => c.id === h.child)) list.push({ id: h.child, type: e.type });
    childrenOf.set(h.parent, list);
    const ps = parentsOf.get(h.child) ?? [];
    if (!ps.includes(h.parent)) ps.push(h.parent);
    parentsOf.set(h.child, ps);
  }
  const build = (doc: T, relationType: SgcRelationType | null, path: Set<number>): SgcTreeNode<T> => {
    const next = new Set(path).add(doc.id);
    const children = (childrenOf.get(doc.id) ?? [])
      .filter((c) => !next.has(c.id))
      .map((c) => build(byId.get(c.id)!, c.type, next))
      .sort((a, b) => byCode(a.doc, b.doc));
    return { doc, relationType, children, descendants: children.reduce((n, c) => n + 1 + c.descendants, 0) };
  };
  const isParent = (d: T) => isParentTypeCode(parentTypeCodes, d.documentTypeCode);
  // Raíces: los documentos de tipo padre. Datos viejos: un documento con hijos que no es de tipo padre y no tiene padre también es raíz.
  const roots = docs
    .filter((d) => isParent(d) || ((childrenOf.get(d.id)?.length ?? 0) > 0 && !(parentsOf.get(d.id)?.length)))
    .sort(byCode)
    .map((d) => build(d, null, new Set()));
  const orphans = docs.filter((d) => !isParent(d) && !(parentsOf.get(d.id)?.length) && !(childrenOf.get(d.id)?.length)).sort(byCode);
  const multipleParents = [...parentsOf.entries()]
    .filter(([, ps]) => ps.length > 1)
    .map(([id, ps]) => ({ doc: byId.get(id)!, parents: ps.map((p) => byId.get(p)!).sort(byCode) }))
    .sort((a, b) => byCode(a.doc, b.doc));
  return { roots, orphans, multipleParents };
}

/** Filtra el árbol por texto (código o nombre): conserva las ramas donde hay coincidencias. */
export function filterTree<T extends SgcTreeDoc & { title: string }>(nodes: readonly SgcTreeNode<T>[], query: string): SgcTreeNode<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...nodes];
  const hit = (d: T) => d.code.toLowerCase().includes(q) || d.title.toLowerCase().includes(q);
  const walk = (n: SgcTreeNode<T>): SgcTreeNode<T> | null => {
    if (hit(n.doc)) return n;
    const children = n.children.map(walk).filter((c): c is SgcTreeNode<T> => c !== null);
    return children.length ? { ...n, children, descendants: children.reduce((s, c) => s + 1 + c.descendants, 0) } : null;
  };
  return nodes.map(walk).filter((n): n is SgcTreeNode<T> => n !== null);
}

// ---------------------------------------------------------------------------
// Código del padre que trae el listado maestro
// ---------------------------------------------------------------------------

/** Quita un sufijo «-<número>» final (la versión que algunos listados pegan al código: OLP-GGC-01-PR-1). */
export function stripTrailingNumber(code: string): string {
  return code.trim().toUpperCase().replace(/-\d{1,3}$/, '');
}

/**
 * Documento padre que indica el listado maestro: por el código exacto y, si no
 * existe, por el mismo código con o sin el sufijo de versión («OLP-GGC-01-PR»
 * ↔ «OLP-GGC-01-PR-1»), solo cuando hay UN candidato. Con `parentTypeCodes`,
 * solo entre documentos de tipo padre.
 */
export function findListedParent<D extends { code: string; documentTypeCode: string }>(listed: string, docs: readonly D[], parentTypeCodes?: readonly string[]): D | null {
  const want = listed.trim().toUpperCase();
  if (!want) return null;
  const pool = parentTypeCodes ? docs.filter((d) => isParentTypeCode(parentTypeCodes, d.documentTypeCode)) : docs;
  const exact = pool.find((d) => d.code.trim().toUpperCase() === want);
  if (exact) return exact;
  const base = stripTrailingNumber(want);
  const candidates = pool.filter((d) => {
    const c = d.code.trim().toUpperCase();
    return stripTrailingNumber(c) === want || c === base || stripTrailingNumber(c) === base;
  });
  return candidates.length === 1 ? candidates[0] : null;
}
