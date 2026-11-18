/**
 * Tarea «Plantilla de documento» (task_kind = 'doc_template') — catálogo de MARCAS y
 * formateo de valores. Módulo PURO (sin BD ni imports de servidor): lo usan el motor,
 * las rutas y el modal de configuración.
 *
 * Marcas:
 *  - Motor editor: el HTML guardado lleva tokens «{{CAMPO_FLUJO:<clave>}}» (en el editor se
 *    ven como menciones «@Etiqueta» con data-field="<clave>").
 *  - Motor word: el .docx lleva «@{Etiqueta del campo}»; la etiqueta se compara sin
 *    mayúsculas, tildes ni espacios (fieldKeyOf del Generador del SGC).
 * Claves: «f:<id_form_field>» para campos del formulario y «sys:<nombre>» para variables del sistema.
 */
import { fieldKeyOf } from '../sgc/generator';
import { parseTableConfig, parseTableValue, type TableColumn } from '../requests-general/tableField';

export const DOC_TEMPLATE_TASK_KIND = 'doc_template';

export type DocMarkerKind = 'field' | 'system';

export interface DocMarker {
  /** «f:12» o «sys:empresa». */
  key: string;
  label: string;
  kind: DocMarkerKind;
  fieldType?: string;
}

/** Campo del formulario con su valor en la solicitud (misma forma que request-form-values). */
export interface DocFormValue {
  id_form_field: number;
  field_label: string;
  field_type: string;
  config_json?: string | null;
  id_option?: number | null;
  option_label?: string | null;
  value_text?: string | null;
}

/** Datos de la solicitud para las variables del sistema. */
export interface DocRequestContext {
  idRequest: number;
  requestDate?: Date | string | null;
  requester?: string | null;
  company?: string | null;
  assignee?: string | null;
  generatedAt?: Date;
}

/** Valor resuelto de una marca: texto plano (Word, nombre de archivo) y HTML seguro (editor). */
export interface DocResolvedValue {
  text: string;
  html: string;
}

export const SYSTEM_MARKERS: readonly DocMarker[] = [
  { key: 'sys:numero_solicitud', label: 'N.º de solicitud', kind: 'system' },
  { key: 'sys:fecha_solicitud', label: 'Fecha de la solicitud', kind: 'system' },
  { key: 'sys:solicitante', label: 'Solicitante', kind: 'system' },
  { key: 'sys:empresa', label: 'Empresa', kind: 'system' },
  { key: 'sys:responsable', label: 'Responsable de la tarea', kind: 'system' },
  { key: 'sys:fecha_generacion', label: 'Fecha de generación', kind: 'system' },
];

/** Token de una marca en el HTML guardado del motor editor. */
export const HTML_TOKEN_RE = /\{\{\s*CAMPO_FLUJO\s*:\s*((?:f|sys):[a-z0-9_]{1,60})\s*\}\}/gi;
export function htmlToken(key: string): string {
  return `{{CAMPO_FLUJO:${key}}}`;
}

/** Marca de Word para una etiqueta (lo que el usuario copia y pega en su .docx). */
export function wordTag(label: string): string {
  return `@{${label}}`;
}

/** Catálogo de marcas: campos activos del proceso (en su orden) + variables del sistema. */
export function buildMarkerCatalog(fields: ReadonlyArray<Pick<DocFormValue, 'id_form_field' | 'field_label' | 'field_type'>>): DocMarker[] {
  const seen = new Set<number>();
  const out: DocMarker[] = [];
  for (const f of fields) {
    if (seen.has(f.id_form_field)) continue;
    seen.add(f.id_form_field);
    out.push({ key: `f:${f.id_form_field}`, label: String(f.field_label ?? '').trim() || `Campo ${f.id_form_field}`, kind: 'field', fieldType: f.field_type });
  }
  return [...out, ...SYSTEM_MARKERS];
}

/** Clave de comparación de una etiqueta (sin mayúsculas, tildes ni espacios). */
export function labelKey(label: string): string {
  return fieldKeyOf(String(label ?? ''));
}

/** Resuelve la etiqueta escrita en Word («@{Etiqueta}») a la clave de una marca, o null. */
export function resolveWordLabel(label: string, catalog: readonly DocMarker[]): string | null {
  const k = labelKey(label);
  if (!k) return null;
  // Los campos del formulario ganan sobre las variables del sistema si comparten etiqueta.
  const hit = catalog.find((m) => m.kind === 'field' && labelKey(m.label) === k) ?? catalog.find((m) => m.kind === 'system' && labelKey(m.label) === k);
  return hit?.key ?? null;
}

// ---------------------------------------------------------------------------
// Formateo
// ---------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const NUMBER_FMT = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 });
const MONEY_FMT = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function toNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(/\s|\$/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatNumber(raw: unknown): string {
  const n = toNumber(raw);
  return n == null ? String(raw ?? '').trim() : NUMBER_FMT.format(n);
}

/** «$ 1.234.567» (separador de miles es-CO). */
export function formatMoney(raw: unknown): string {
  const n = toNumber(raw);
  return n == null ? String(raw ?? '').trim() : `$ ${MONEY_FMT.format(n)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** dd/mm/aaaa. Una fecha «AAAA-MM-DD» se toma tal cual (sin correr por zona horaria). */
export function formatDate(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? '' : `${pad(raw.getDate())}/${pad(raw.getMonth() + 1)}/${raw.getFullYear()}`;
  }
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : formatDate(d);
}

function formatYesNo(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (['1', 'true', 'si', 'sí', 'yes', 's'].includes(s)) return 'Sí';
  if (['0', 'false', 'no', 'n'].includes(s)) return 'No';
  return String(raw);
}

function formatCell(col: TableColumn, value: unknown): string {
  if (value == null || value === '') return '';
  switch (col.type) {
    case 'money':
      return formatMoney(value);
    case 'number':
      return formatNumber(value);
    case 'date':
      return formatDate(value);
    case 'yesno':
      return formatYesNo(value);
    default:
      if (typeof value === 'object') {
        const o = value as Record<string, unknown>;
        return String(o.label ?? o.name ?? o.CardName ?? o.ItemName ?? o.code ?? o.value ?? JSON.stringify(value));
      }
      return String(value);
  }
}

function tableValue(f: DocFormValue): DocResolvedValue {
  const { columns } = parseTableConfig(f.config_json);
  const { rows } = parseTableValue(f.value_text);
  if (!columns.length || !rows.length) return { text: '', html: '' };
  const cells = rows.map((r) => columns.map((c) => formatCell(c, r[c.key])));
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr>`;
  const body = cells.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('');
  const text = cells.map((row) => columns.map((c, i) => `${c.label}: ${row[i]}`).join('; ')).join('\n');
  return { text, html: `<table><tbody>${head}${body}</tbody></table>` };
}

function plain(text: string): DocResolvedValue {
  return { text, html: escapeHtml(text).replace(/\r?\n/g, '<br>') };
}

/** Formatea el valor de un campo del formulario según su field_type. Vacío → ''. */
export function formatFieldValue(f: DocFormValue): DocResolvedValue {
  const raw = f.value_text;
  switch (f.field_type) {
    case 'table':
      return tableValue(f);
    case 'select':
      return plain(String(f.option_label ?? raw ?? '').trim());
    case 'money':
      return plain(raw == null || raw === '' ? '' : formatMoney(raw));
    case 'number':
      return plain(raw == null || raw === '' ? '' : formatNumber(raw));
    case 'date':
      return plain(formatDate(raw));
    case 'yesno':
      return plain(formatYesNo(raw));
    default:
      // text, textarea, url, sap_business_partners, …: el valor guardado.
      return plain(String(raw ?? '').trim());
  }
}

/** Valores de todas las marcas (campos + sistema) para una solicitud. */
export function resolveMarkerValues(fields: readonly DocFormValue[], ctx: DocRequestContext): Record<string, DocResolvedValue> {
  const out: Record<string, DocResolvedValue> = {};
  for (const f of fields) out[`f:${f.id_form_field}`] = formatFieldValue(f);
  out['sys:numero_solicitud'] = plain(String(ctx.idRequest));
  out['sys:fecha_solicitud'] = plain(formatDate(ctx.requestDate ?? null));
  out['sys:solicitante'] = plain(String(ctx.requester ?? '').trim());
  out['sys:empresa'] = plain(String(ctx.company ?? '').trim());
  out['sys:responsable'] = plain(String(ctx.assignee ?? '').trim());
  out['sys:fecha_generacion'] = plain(formatDate(ctx.generatedAt ?? new Date()));
  return out;
}

/** Marcas usadas en un HTML del motor editor (tokens y menciones). */
export function htmlMarkerKeys(html: string): string[] {
  const keys = new Set<string>();
  for (const m of String(html ?? '').matchAll(HTML_TOKEN_RE)) keys.add(m[1].toLowerCase());
  for (const m of String(html ?? '').matchAll(/data-field="((?:f|sys):[a-z0-9_]{1,60})"/gi)) keys.add(m[1].toLowerCase());
  return [...keys];
}

/** Marcas del HTML que no corresponden a ningún campo activo ni variable del sistema. */
export function unresolvedHtmlMarkers(html: string, catalog: readonly DocMarker[]): string[] {
  const known = new Set(catalog.map((m) => m.key));
  return htmlMarkerKeys(html).filter((k) => !known.has(k));
}

/** Nombre del archivo generado a partir del patrón (admite marcas «@{Etiqueta}»). Sin extensión. */
export function buildFileName(pattern: string | null | undefined, fallback: string, catalog: readonly DocMarker[], values: Record<string, DocResolvedValue>): string {
  const base = String(pattern ?? '').trim() || fallback;
  const filled = base.replace(/@\{([^{}]{1,100})\}/g, (_, label: string) => {
    const key = resolveWordLabel(label, catalog);
    return key ? (values[key]?.text ?? '').split('\n')[0] : '';
  });
  const clean = filled
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(pdf|docx)$/i, '')
    .slice(0, 150)
    .trim();
  return clean || fallback;
}
