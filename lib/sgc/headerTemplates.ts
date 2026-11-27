import { SgcError } from './errors';
import { normalizeHeaderGrid, type SgcHeaderGrid } from './headerGrid';

/**
 * PLANTILLAS DE ENCABEZADO POR TIPO DOCUMENTAL (S16, R31; decisión D20 de
 * Nicolás del 2026-10-13: «una plantilla de encabezado por defecto y las
 * demás se configuran por tipo documental») — funciones PURAS.
 *
 * La plantilla NO cambia la geometría del encabezado institucional (la misma
 * tabla de Calidad: logo, nombre, código, versión, página x de y, Elaboró /
 * Revisó / Aprobó con su recuadro «Firma», fecha de emisión y una fila
 * inferior), así no se mueven los recuadros donde se ubican las firmas ni el
 * espacio que el contenido deja arriba. Lo que se configura son los RÓTULOS y
 * la fila inferior (proceso y tipo documental, solo el proceso o una leyenda
 * propia), que es lo que distingue el encabezado de un instructivo, un
 * formato o un procedimiento. Las plantillas definitivas de Calidad (D20)
 * se cargan desde Configuración del SGC; los vigentes no cambian (su
 * encabezado quedó compuesto en el PDF controlado al aprobarse).
 *
 * 2026-10-19 (fase 1 de la grilla, lib/sgc/headerGrid.ts): una plantilla puede
 * traer además su GRILLA (filas, columnas, celdas combinadas y el campo de
 * cada celda). Con grilla, la tabla de la primera página sigue la grilla (los
 * recuadros de firma y la fecha de emisión salen de sus celdas); sin grilla,
 * la geometría institucional de siempre. Los rótulos de arriba siguen siendo
 * los de las celdas que no traen rótulo propio.
 */

export const SGC_HEADER_BOTTOM_ROWS = ['proceso_tipo', 'proceso', 'tipo', 'leyenda'] as const;
export type SgcHeaderBottomRow = (typeof SGC_HEADER_BOTTOM_ROWS)[number];

export const SGC_HEADER_BOTTOM_ROW_LABELS: Record<SgcHeaderBottomRow, string> = {
  proceso_tipo: 'Proceso y tipo documental',
  proceso: 'Solo el proceso',
  tipo: 'Solo el tipo documental',
  leyenda: 'Una leyenda propia',
};

export interface SgcHeaderTemplateConfig {
  /** Rótulo sobre el nombre (p. ej. «NOMBRE DEL DOCUMENTO», «NOMBRE DEL FORMATO»). */
  titleLabel: string;
  codeLabel: string;
  versionLabel: string;
  elaboroLabel: string;
  revisoLabel: string;
  aproboLabel: string;
  emissionLabel: string;
  bottomRow: SgcHeaderBottomRow;
  /** Texto de la fila inferior cuando es «leyenda» (o que se agrega a la derecha de las demás). */
  legend: string | null;
  /** 2026-10-19: grilla propia de la primera página (null = la tabla institucional). */
  grid: SgcHeaderGrid | null;
}

/** Encabezado institucional de hoy (el «por defecto»). */
export const SGC_DEFAULT_HEADER_TEMPLATE: SgcHeaderTemplateConfig = {
  titleLabel: 'NOMBRE DEL DOCUMENTO',
  codeLabel: 'CÓDIGO',
  versionLabel: 'VERSIÓN',
  elaboroLabel: 'ELABORÓ',
  revisoLabel: 'REVISÓ',
  aproboLabel: 'APROBÓ',
  emissionLabel: 'FECHA DE EMISIÓN',
  bottomRow: 'proceso_tipo',
  legend: null,
  grid: null,
};

const LABEL_MAX = 40;
const LEGEND_MAX = 160;

function label(raw: unknown, name: string, fallback: string): string {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const s = String(raw).replace(/\s+/g, ' ').trim().toUpperCase();
  if (!s) return fallback;
  if (s.length > LABEL_MAX) throw new SgcError(`${name}: máximo ${LABEL_MAX} caracteres.`);
  return s;
}

/** Valida y normaliza la configuración de una plantilla (lo que guarda Calidad). */
export function normalizeHeaderTemplateConfig(raw: unknown): SgcHeaderTemplateConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = SGC_DEFAULT_HEADER_TEMPLATE;
  const bottomRow = r.bottomRow === undefined || r.bottomRow === null || r.bottomRow === '' ? d.bottomRow : String(r.bottomRow);
  if (!(SGC_HEADER_BOTTOM_ROWS as readonly string[]).includes(bottomRow)) throw new SgcError('Fila inferior del encabezado no permitida.');
  const legendRaw = typeof r.legend === 'string' ? r.legend.replace(/\s+/g, ' ').trim() : '';
  if (legendRaw.length > LEGEND_MAX) throw new SgcError(`La leyenda admite máximo ${LEGEND_MAX} caracteres.`);
  if (bottomRow === 'leyenda' && legendRaw.length < 3) throw new SgcError('Escriba la leyenda de la fila inferior (mínimo 3 caracteres).');
  return {
    titleLabel: label(r.titleLabel, 'El rótulo del nombre', d.titleLabel),
    codeLabel: label(r.codeLabel, 'El rótulo del código', d.codeLabel),
    versionLabel: label(r.versionLabel, 'El rótulo de la versión', d.versionLabel),
    elaboroLabel: label(r.elaboroLabel, 'El rótulo de «Elaboró»', d.elaboroLabel),
    revisoLabel: label(r.revisoLabel, 'El rótulo de «Revisó»', d.revisoLabel),
    aproboLabel: label(r.aproboLabel, 'El rótulo de «Aprobó»', d.aproboLabel),
    emissionLabel: label(r.emissionLabel, 'El rótulo de la fecha de emisión', d.emissionLabel),
    bottomRow: bottomRow as SgcHeaderBottomRow,
    legend: legendRaw || null,
    grid: r.grid === undefined || r.grid === null ? null : normalizeHeaderGrid(r.grid),
  };
}

/** Lee la configuración guardada (JSON); si está dañada, la plantilla por defecto. */
export function parseHeaderTemplateConfig(json: string | null | undefined): SgcHeaderTemplateConfig {
  try {
    return normalizeHeaderTemplateConfig(JSON.parse(json ?? '{}'));
  } catch {
    return { ...SGC_DEFAULT_HEADER_TEMPLATE };
  }
}

/** Texto de la fila inferior del encabezado de la primera página. */
export function headerBottomText(cfg: Pick<SgcHeaderTemplateConfig, 'bottomRow' | 'legend'>, data: { process: string; documentType: string }): string {
  const legend = cfg.legend ? cfg.legend : '';
  switch (cfg.bottomRow) {
    case 'proceso':
      return `PROCESO: ${data.process}${legend ? `    ·    ${legend}` : ''}`;
    case 'tipo':
      return `TIPO DOCUMENTAL: ${data.documentType}${legend ? `    ·    ${legend}` : ''}`;
    case 'leyenda':
      return legend;
    default:
      return `PROCESO: ${data.process}    ·    TIPO DOCUMENTAL: ${data.documentType}${legend ? `    ·    ${legend}` : ''}`;
  }
}

/** Código de una plantilla (mayúsculas, números, guion y guion bajo). */
export function normalizeHeaderTemplateCode(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9_-]{1,29}$/.test(s)) throw new SgcError('Código de la plantilla: mayúsculas, números, guion o guion bajo (2 a 30, empezando por letra).');
  return s;
}

/** Qué cambió entre dos configuraciones (para el control de cambios). */
export function describeHeaderTemplateChanges(before: SgcHeaderTemplateConfig | null, after: SgcHeaderTemplateConfig): string[] {
  if (!before) return ['Plantilla creada.'];
  const out: string[] = [];
  for (const k of Object.keys(after) as (keyof SgcHeaderTemplateConfig)[]) {
    if (k === 'grid') {
      const describe = (g: SgcHeaderGrid | null | undefined) => (g ? `${g.rows.length} fila(s) × ${g.columns.length} columna(s), ${g.cells.length} celda(s)` : 'tabla institucional');
      if (JSON.stringify(before.grid ?? null) !== JSON.stringify(after.grid ?? null)) out.push(`grilla: «${describe(before.grid)}» → «${describe(after.grid)}»${before.grid && after.grid && describe(before.grid) === describe(after.grid) ? ' (cambió el contenido de las celdas)' : ''}`);
      continue;
    }
    if (before[k] !== after[k]) out.push(`${k}: «${before[k] ?? ''}» → «${after[k] ?? ''}»`);
  }
  return out.length ? out : ['Sin cambios en la plantilla.'];
}

/**
 * ¿Qué plantilla usa un tipo documental? La suya si está activa; si no, la
 * por defecto de la empresa; si no hay ninguna, el encabezado institucional
 * de siempre.
 */
export function resolveHeaderTemplate<T extends { id: number; isActive: boolean; isDefault: boolean }>(templates: readonly T[], idTypeTemplate: number | null | undefined): T | null {
  const own = idTypeTemplate ? templates.find((t) => t.id === idTypeTemplate && t.isActive) : undefined;
  if (own) return own;
  return templates.find((t) => t.isDefault && t.isActive) ?? null;
}

// ---------------------------------------------------------------------------
// S16 (R32, D17): formatos admitidos para el BORRADOR por tipo documental.
// ---------------------------------------------------------------------------

export const SGC_DRAFT_EXTENSIONS = ['docx', 'xlsx'] as const;
export type SgcDraftExtension = (typeof SGC_DRAFT_EXTENSIONS)[number];

export const SGC_DRAFT_EXTENSION_LABELS: Record<SgcDraftExtension, string> = {
  docx: 'Word (.docx)',
  xlsx: 'Excel (.xlsx)',
};

/** Por defecto (columna vacía): solo Word, como la RN del 2026-10-05 (rn-sgc-borrador-solo-word). */
export const SGC_DEFAULT_DRAFT_EXTENSIONS: readonly SgcDraftExtension[] = ['docx'];

export function parseDraftExtensions(raw: string | null | undefined): SgcDraftExtension[] {
  const list = (raw ?? '')
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase().replace(/^\./, ''))
    .filter((x): x is SgcDraftExtension => (SGC_DRAFT_EXTENSIONS as readonly string[]).includes(x));
  return list.length ? [...new Set(list)] : [...SGC_DEFAULT_DRAFT_EXTENSIONS];
}

/** Valor que se guarda (null = por defecto, solo Word). */
export function normalizeDraftExtensions(raw: unknown): string | null {
  const values = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  const clean = [...new Set(values.map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))];
  const bad = clean.filter((x) => !(SGC_DRAFT_EXTENSIONS as readonly string[]).includes(x));
  if (bad.length) throw new SgcError(`Formato de borrador no admitido: ${bad.join(', ')} (Word .docx o Excel .xlsx).`);
  if (clean.length === 0) return null;
  const ordered = SGC_DRAFT_EXTENSIONS.filter((x) => clean.includes(x));
  return ordered.length === 1 && ordered[0] === 'docx' ? null : ordered.join(',');
}

/**
 * Formatos que la pantalla ofrece para el borrador: los del tipo documental
 * (Word por defecto; .doc también, como hasta hoy) y el PDF solo si la
 * empresa NO tiene el encabezado obligatorio (carga de vigentes).
 */
export function draftFormatsFor(typeExtensions: string | null | undefined, headerMandatory: boolean): string[] {
  const exts = parseDraftExtensions(typeExtensions);
  const out: string[] = [];
  if (exts.includes('docx')) out.push('docx', 'doc');
  if (exts.includes('xlsx')) out.push('xlsx');
  if (!headerMandatory) out.push('pdf');
  return out;
}
