/**
 * Listado maestro y mapa de procesos — funciones PURAS (probadas con Vitest).
 *
 * El listado maestro son los documentos que la persona puede consultar (para
 * todos menos Calidad: solo los VIGENTES), con código, versión y título
 * siempre visibles. El mapa de procesos es otra forma de recorrerlo, en
 * cascada como el sistema de referencia:
 *   tipo de proceso → proceso → carpeta por tipo documental → documento.
 */

export interface SgcMasterItem {
  idDocument: number;
  code: string;
  title: string;
  status: string;
  confidentiality: string;
  versionNumber: number | null;
  idVersion: number | null;
  effectiveDate: string | null;
  reviewDueDate: string | null;
  processType: { id: number; code: string; name: string; color: string };
  process: { id: number; code: string; name: string; department: string | null };
  /** 2026-10-03: área (departamento dueño) para la navegación área → tipo documental. */
  area?: { id: number; name: string } | null;
  documentType: { id: number; code: string; name: string; pluralName: string; alertMonths: number };
}

/** Clave y nombre del área de un documento («sin área» si no tiene departamento dueño). */
export const SGC_NO_AREA_ID = 0;
export function areaOf(item: Pick<SgcMasterItem, 'area'>): { id: number; name: string } {
  return item.area ?? { id: SGC_NO_AREA_ID, name: 'Sin área asignada' };
}

export interface SgcAreaGroup {
  id: number;
  name: string;
  count: number;
  types: { id: number; code: string; name: string; pluralName: string; count: number }[];
}

/**
 * NAVEGACIÓN POR ÁREA → TIPO DOCUMENTAL (pedida por Calidad OLP el
 * 2026-10-02): Documentación → área (p. ej. Compras) → tipo (manual,
 * procedimiento, instructivo…). Agrupa el listado maestro (ya filtrado por
 * permisos) por área y, dentro, por tipo documental, en orden alfabético; los
 * documentos sin área quedan al final.
 */
export function groupByAreaAndType(items: readonly SgcMasterItem[]): SgcAreaGroup[] {
  const areas = new Map<number, SgcAreaGroup>();
  for (const it of items) {
    const a = areaOf(it);
    if (!areas.has(a.id)) areas.set(a.id, { id: a.id, name: a.name, count: 0, types: [] });
    const g = areas.get(a.id)!;
    g.count += 1;
    let t = g.types.find((x) => x.id === it.documentType.id);
    if (!t) {
      t = { id: it.documentType.id, code: it.documentType.code, name: it.documentType.name, pluralName: it.documentType.pluralName, count: 0 };
      g.types.push(t);
    }
    t.count += 1;
  }
  const out = [...areas.values()];
  out.forEach((g) => g.types.sort((x, y) => x.pluralName.localeCompare(y.pluralName, 'es')));
  return out.sort((x, y) => (x.id === SGC_NO_AREA_ID ? 1 : y.id === SGC_NO_AREA_ID ? -1 : x.name.localeCompare(y.name, 'es')));
}

/** Documentos de un área y (opcional) de un tipo documental, ordenados por código. */
export function documentsOfArea(items: readonly SgcMasterItem[], areaId: number, documentTypeId?: number | null): SgcMasterItem[] {
  return sortMasterList(items.filter((it) => areaOf(it).id === areaId && (!documentTypeId || it.documentType.id === documentTypeId)));
}

export interface SgcMasterFilters {
  q?: string | null;
  processTypeId?: number | null;
  processId?: number | null;
  documentTypeId?: number | null;
  status?: string | null;
}

/** Quita tildes y pasa a minúsculas, para buscar "procedimiento" = "Procedimiento". */
export function foldText(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** true si el documento coincide con la búsqueda libre (código o título, sin tildes). */
export function matchesSearch(item: Pick<SgcMasterItem, 'code' | 'title'>, q: string | null | undefined): boolean {
  const needle = foldText(q ?? '');
  if (!needle) return true;
  const words = needle.split(/\s+/).filter(Boolean);
  const haystack = `${foldText(item.code)} ${foldText(item.title)}`;
  return words.every((w) => haystack.includes(w));
}

/** Aplica búsqueda y filtros al listado. */
export function filterMasterList(items: readonly SgcMasterItem[], filters: SgcMasterFilters): SgcMasterItem[] {
  return items.filter(
    (it) =>
      matchesSearch(it, filters.q) &&
      (!filters.processTypeId || it.processType.id === filters.processTypeId) &&
      (!filters.processId || it.process.id === filters.processId) &&
      (!filters.documentTypeId || it.documentType.id === filters.documentTypeId) &&
      (!filters.status || it.status === filters.status)
  );
}

/** Orden del listado maestro: por código (natural: PR-2 antes que PR-10). */
export function sortMasterList(items: readonly SgcMasterItem[]): SgcMasterItem[] {
  return [...items].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true, sensitivity: 'base' }));
}

export interface SgcCatalogProcessType {
  id: number;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}
export interface SgcCatalogProcess {
  id: number;
  idProcessType: number;
  code: string;
  name: string;
  sortOrder: number;
}
export interface SgcCatalogDocumentType {
  id: number;
  code: string;
  name: string;
  pluralName: string;
  sortOrder: number;
}

export interface SgcCascadeFolder {
  documentType: SgcCatalogDocumentType;
  documents: SgcMasterItem[];
}
export interface SgcCascadeProcess {
  process: SgcCatalogProcess;
  folders: SgcCascadeFolder[];
  total: number;
}
export interface SgcCascadeType {
  processType: SgcCatalogProcessType;
  processes: SgcCascadeProcess[];
  total: number;
}

const bySort = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es');

/**
 * Arma la cascada del mapa de procesos. Muestra TODOS los tipos de proceso y
 * procesos activos (aunque aún no tengan documentos, como en la referencia),
 * pero solo las carpetas de tipo documental que tienen documentos visibles.
 */
export function buildProcessCascade(
  processTypes: readonly SgcCatalogProcessType[],
  processes: readonly SgcCatalogProcess[],
  documentTypes: readonly SgcCatalogDocumentType[],
  items: readonly SgcMasterItem[]
): SgcCascadeType[] {
  const sortedDocTypes = [...documentTypes].sort(bySort);
  return [...processTypes].sort(bySort).map((pt) => {
    const procs = processes
      .filter((p) => p.idProcessType === pt.id)
      .sort(bySort)
      .map((p) => {
        const docs = sortMasterList(items.filter((it) => it.process.id === p.id));
        const folders = sortedDocTypes
          .map((dt) => ({ documentType: dt, documents: docs.filter((d) => d.documentType.id === dt.id) }))
          .filter((f) => f.documents.length > 0);
        return { process: p, folders, total: docs.length };
      });
    return { processType: pt, processes: procs, total: procs.reduce((n, p) => n + p.total, 0) };
  });
}
