import { SgcError } from './errors';
import type { SgcCompanyAccess } from './permissions';

/**
 * GENERADOR DE DOCUMENTOS DESDE PLANTILLAS APROBADAS POR CALIDAD — funciones
 * PURAS (probadas con Vitest).
 *
 * Origen: el «Generador de documentos» que existía solo como cambios a mano en
 * la demo de PiSA (2026-10-05, rama rescate/pisa-demo-generador-2026-10-10).
 * Allá se editaba LIBREMENTE una copia de trabajo de un vigente y se bajaba un
 * PDF «No es copia controlada» sin autorización. Nicolás decidió el
 * 2026-10-10 que el generador va en SynerLink, pero con la idea que Calidad
 * explicó el 2026-10-07: plantillas APROBADAS POR CALIDAD (cartas, políticas)
 * de las que la persona genera un documento modificando SOLO lo permitido.
 *
 * Modelo:
 *   - La PLANTILLA parte de un documento VIGENTE del SGC cuyo contenido es
 *     Word o del editor (RN «borrador solo Word»: un vigente con solo PDF no
 *     sirve). Ese contenido ya pasó por el flujo documental completo
 *     (elaboración, revisión, aprobación y verificación de Calidad).
 *   - Los CAMPOS EDITABLES son marcas en el contenido: {{CAMPO:Etiqueta}} o
 *     {{CAMPO:Etiqueta|tipo}} (tipo: texto, parrafo, fecha, numero). Todo lo
 *     demás es texto FIJO: la persona solo envía valores de campos, nunca HTML.
 *   - Cada configuración de la plantilla es una VERSIÓN (v1, v2…) que congela
 *     el contenido y los campos; la propone gestión documental o Calidad y la
 *     APRUEBA SOLO Aseguramiento de Calidad, con motivo y nunca la propia.
 *     Si el documento de origen cambia de versión, la plantilla queda
 *     «desactualizada» hasta que Calidad apruebe una versión nueva.
 *   - Lo que se genera es un REGISTRO (información documentada conservada,
 *     ISO 9001 7.5.3), no un documento nuevo del listado maestro: lleva su
 *     propio consecutivo de registro (GEN-012-0001), la versión de la
 *     plantilla y del documento de origen, el encabezado institucional del
 *     origen y una leyenda de trazabilidad.
 *   - S19 (R34, RN del 2026-10-13): el Generador es SOLO para documentos SIN
 *     CODIFICACIÓN. La plantilla parte de un vigente de un tipo documental
 *     marcado como «plantilla guía»; lo que se genera NO lleva código
 *     documental (el encabezado y {{CODIGO}} dicen «Sin codificación»). Los
 *     documentos codificados van siempre por solicitud. Es INMUTABLE (se anula con motivo, nunca se
 *     edita ni se borra) y se consulta en el VISOR, sin descarga
 *     (RN «Ver documento sin descarga»).
 */

/** Tipos de campo editable. */
export const SGC_GENERATOR_FIELD_TYPES = ['texto', 'parrafo', 'fecha', 'numero'] as const;
export type SgcGeneratorFieldType = (typeof SGC_GENERATOR_FIELD_TYPES)[number];

export const SGC_GENERATOR_FIELD_TYPE_LABELS: Record<SgcGeneratorFieldType, string> = {
  texto: 'Texto corto',
  parrafo: 'Párrafo',
  fecha: 'Fecha',
  numero: 'Número',
};

/** Largo máximo permitido por tipo (Calidad puede bajarlo, nunca subirlo). */
export const SGC_GENERATOR_MAX_LENGTH: Record<SgcGeneratorFieldType, number> = {
  texto: 200,
  parrafo: 2000,
  fecha: 10,
  numero: 30,
};

/** Máximo de campos editables por plantilla. */
export const SGC_GENERATOR_MAX_FIELDS = 40;

export interface SgcGeneratorField {
  key: string;
  label: string;
  type: SgcGeneratorFieldType;
  required: boolean;
  maxLength: number;
  help: string | null;
}

/** Estados de una versión de plantilla. */
export const SGC_TEMPLATE_VERSION_STATUSES = ['pendiente', 'aprobada', 'rechazada', 'reemplazada'] as const;
export type SgcTemplateVersionStatus = (typeof SGC_TEMPLATE_VERSION_STATUSES)[number];
export const SGC_TEMPLATE_VERSION_STATUS_LABELS: Record<SgcTemplateVersionStatus, string> = {
  pendiente: 'Pendiente de Calidad',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  reemplazada: 'Reemplazada',
};

/** Estado de uso de una plantilla (para la persona que genera). */
export type SgcTemplateState = 'disponible' | 'sin_aprobar' | 'desactualizada' | 'documento_no_vigente' | 'tipo_no_guia' | 'retirada';
export const SGC_TEMPLATE_STATE_LABELS: Record<SgcTemplateState, string> = {
  disponible: 'Disponible',
  sin_aprobar: 'Sin versión aprobada',
  desactualizada: 'Desactualizada',
  documento_no_vigente: 'Documento de origen no vigente',
  tipo_no_guia: 'Origen codificado (no es plantilla guía)',
  retirada: 'Retirada',
};

/** Estados de un registro generado. */
export const SGC_GENERATED_STATUSES = ['emitido', 'anulado'] as const;
export type SgcGeneratedStatus = (typeof SGC_GENERATED_STATUSES)[number];
export const SGC_GENERATED_STATUS_LABELS: Record<SgcGeneratedStatus, string> = {
  emitido: 'Emitido',
  anulado: 'Anulado',
};

/** Motivos (propuesta, decisión, retiro, anulación): mínimo y máximo. */
export const SGC_GENERATOR_REASON_MIN = 10;
export const SGC_GENERATOR_REASON_MAX = 1000;

// ---------------------------------------------------------------------------
// Permisos (las dos llaves del módulo ya vienen resueltas en SgcCompanyAccess).
// ---------------------------------------------------------------------------

/** Proponer o retirar una configuración de plantilla: gestión documental o Calidad. */
export function canProposeTemplate(access: Pick<SgcCompanyAccess, 'canManage' | 'canQuality'> | null | undefined): boolean {
  return Boolean(access && (access.canManage || access.canQuality));
}

/** Aprobar o rechazar una plantilla: SOLO Aseguramiento de Calidad. */
export function canApproveTemplate(access: Pick<SgcCompanyAccess, 'canQuality'> | null | undefined): boolean {
  return Boolean(access?.canQuality);
}

/** Generar desde una plantilla aprobada: cualquiera con consulta del SGC en la empresa. */
export function canGenerate(access: Pick<SgcCompanyAccess, 'canRead'> | null | undefined): boolean {
  return Boolean(access?.canRead);
}

// ---------------------------------------------------------------------------
// Marcas de campos editables en el contenido.
// ---------------------------------------------------------------------------

// Marca completa (el interior se separa en etiqueta y tipo con código, sin expresiones anidadas).
const MARKER = /\{\{\s*CAMPO\s*:([^{}<>]{1,100})\}\}/gi;

/** Etiqueta y tipo escritos dentro de una marca: «Etiqueta» o «Etiqueta|tipo». */
function splitMarker(inner: string): { label: string; type: string | undefined } {
  const bar = inner.indexOf('|');
  return bar === -1 ? { label: inner, type: undefined } : { label: inner.slice(0, bar), type: inner.slice(bar + 1) };
}

/** Clave estable de un campo a partir de su etiqueta (sin tildes, minúsculas, con «_»). */
export function fieldKeyOf(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function typeOf(raw: string | undefined): SgcGeneratorFieldType {
  const t = fieldKeyOf(raw ?? '');
  return (SGC_GENERATOR_FIELD_TYPES as readonly string[]).includes(t) ? (t as SgcGeneratorFieldType) : 'texto';
}

/** Deshace las entidades HTML más comunes del texto de una marca (el editor escapa «&»). */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Campos editables que declara el contenido (en orden de aparición, sin
 * repetir: una misma etiqueta usada dos veces es UN campo que se llena en los
 * dos lugares). Una marca partida por formato (p. ej. media palabra en
 * negrita) no se reconoce: por eso Calidad revisa la lista antes de proponer.
 */
export function detectTemplateFields(html: string): SgcGeneratorField[] {
  const out = new Map<string, SgcGeneratorField>();
  for (const m of String(html ?? '').matchAll(MARKER)) {
    const parts = splitMarker(m[1]);
    const label = decodeEntities(parts.label);
    const key = fieldKeyOf(label);
    if (!key || label.length > 80 || out.has(key)) continue;
    const type = typeOf(parts.type);
    out.set(key, { key, label, type, required: true, maxLength: SGC_GENERATOR_MAX_LENGTH[type], help: null });
  }
  return [...out.values()];
}

/**
 * Configuración de los campos que propone gestión documental o Calidad sobre
 * los campos DETECTADOS: tipo, obligatorio, largo máximo (nunca mayor que el
 * del tipo) y ayuda. No se pueden inventar campos que no estén en el contenido.
 */
export function normalizeTemplateFields(detected: readonly SgcGeneratorField[], raw: unknown): SgcGeneratorField[] {
  if (detected.length === 0) throw new SgcError('El contenido no tiene campos editables: marque en el documento lo que la persona puede cambiar con {{CAMPO:Etiqueta}}.', 409);
  if (detected.length > SGC_GENERATOR_MAX_FIELDS) throw new SgcError(`Una plantilla admite máximo ${SGC_GENERATOR_MAX_FIELDS} campos editables.`, 409);
  const list = Array.isArray(raw) ? raw : [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key : '';
    if (!detected.some((d) => d.key === key)) throw new SgcError(`El campo «${key || '(sin clave)'}» no existe en el contenido de la plantilla.`);
    byKey.set(key, r);
  }
  return detected.map((d) => {
    const r = byKey.get(d.key);
    if (!r) return { ...d };
    const type = r.type === undefined ? d.type : (SGC_GENERATOR_FIELD_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as SgcGeneratorFieldType) : null;
    if (!type) throw new SgcError(`Tipo inválido para el campo «${d.label}».`);
    const cap = SGC_GENERATOR_MAX_LENGTH[type];
    const maxLength = r.maxLength === undefined || r.maxLength === null || r.maxLength === '' ? cap : Number(r.maxLength);
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > cap) throw new SgcError(`El largo máximo del campo «${d.label}» debe estar entre 1 y ${cap}.`);
    const help = typeof r.help === 'string' && r.help.trim() ? r.help.trim().slice(0, 300) : null;
    return { key: d.key, label: d.label, type, required: r.required === undefined ? true : r.required === true, maxLength, help };
  });
}

/** Lee la configuración de campos guardada (JSON de la versión). */
export function parseTemplateFields(json: string | null | undefined): SgcGeneratorField[] {
  try {
    const parsed = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as SgcGeneratorField[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Valores que envía la persona.
// ---------------------------------------------------------------------------

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function isValidDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Valida los valores contra los campos PERMITIDOS de la versión aprobada:
 * rechaza cualquier clave que no sea un campo (la persona no edita nada más),
 * exige los obligatorios, el largo y el formato de fecha y número. Devuelve
 * los valores limpios (texto plano; los saltos de línea solo en «párrafo»).
 */
export function validateGeneratorValues(fields: readonly SgcGeneratorField[], raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SgcError('Envíe los valores de los campos de la plantilla.');
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!fields.some((f) => f.key === key)) throw new SgcError(`«${key}» no es un campo editable de esta plantilla: solo se modifican los campos que permitió Calidad.`);
  }
  const out: Record<string, string> = {};
  for (const f of fields) {
    const value = input[f.key];
    if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') throw new SgcError(`Valor inválido en «${f.label}».`);
    let v = String(value ?? '').replace(CONTROL, '').replace(/\r\n?/g, '\n');
    v = f.type === 'parrafo' ? v.trim() : v.replace(/\s+/g, ' ').trim();
    if (!v) {
      if (f.required) throw new SgcError(`Complete el campo «${f.label}».`);
      out[f.key] = '';
      continue;
    }
    if (v.length > f.maxLength) throw new SgcError(`«${f.label}» admite máximo ${f.maxLength} caracteres.`);
    if (f.type === 'fecha' && !isValidDate(v)) throw new SgcError(`«${f.label}» debe ser una fecha válida (AAAA-MM-DD).`);
    if (f.type === 'numero' && !/^-?\d{1,20}$/.test(v) && !/^-?\d{1,20}[.,]\d{1,8}$/.test(v)) throw new SgcError(`«${f.label}» debe ser un número.`);
    out[f.key] = v;
  }
  return out;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * Reemplaza las marcas por los valores (escapados: un valor nunca se
 * interpreta como HTML). El resto del contenido queda IGUAL al aprobado.
 * Un campo opcional vacío deja el espacio vacío.
 */
export function fillTemplate(html: string, fields: readonly SgcGeneratorField[], values: Readonly<Record<string, string>>): string {
  const types = new Map(fields.map((f) => [f.key, f.type]));
  return String(html ?? '').replace(MARKER, (whole, inner: string) => {
    const key = fieldKeyOf(decodeEntities(splitMarker(inner).label));
    if (!types.has(key)) return whole;
    const v = escapeHtml(values[key] ?? '');
    return types.get(key) === 'parrafo' ? v.replace(/\n/g, '<br>') : v;
  });
}

// ---------------------------------------------------------------------------
// Estado de la plantilla, códigos y textos del registro.
// ---------------------------------------------------------------------------

/** ¿Se puede generar hoy desde la plantilla? */
export function templateState(t: {
  templateStatus: string;
  approvedVersion: { idDocumentVersion: number } | null;
  documentStatus: string;
  documentCurrentVersionId: number | null;
  /** S19 (R34): ¿el tipo documental del origen es de plantillas guía? (omitido = sí, compatibilidad). */
  guideType?: boolean;
}): SgcTemplateState {
  if (t.templateStatus !== 'activa') return 'retirada';
  if (t.guideType === false) return 'tipo_no_guia';
  if (!t.approvedVersion) return 'sin_aprobar';
  if (t.documentStatus !== 'vigente') return 'documento_no_vigente';
  if (t.documentCurrentVersionId !== t.approvedVersion.idDocumentVersion) return 'desactualizada';
  return 'disponible';
}

/** Mensaje para la persona cuando la plantilla no está disponible. */
export function templateStateMessage(state: SgcTemplateState): string {
  switch (state) {
    case 'retirada':
      return 'La plantilla fue retirada por Calidad.';
    case 'sin_aprobar':
      return 'La plantilla aún no tiene una versión aprobada por Calidad.';
    case 'documento_no_vigente':
      return 'El documento de origen de la plantilla ya no está vigente.';
    case 'tipo_no_guia':
      return SGC_GENERATOR_CODED_MESSAGE;
    case 'desactualizada':
      return 'El documento de origen tiene una versión nueva: Calidad debe aprobar la plantilla actualizada antes de generar.';
    default:
      return '';
  }
}

/** S19 (R34): por qué un documento codificado no puede ser origen del Generador. */
export const SGC_GENERATOR_CODED_MESSAGE = 'El Generador es solo para documentos sin codificación: el tipo documental del origen no está marcado como «plantilla guía». Los documentos codificados van por solicitud.';

/** S19 (R34): texto que reemplaza al código documental en lo que se genera. */
export const SGC_GENERATOR_NO_CODE = 'Sin codificación';

/**
 * Consecutivo del REGISTRO generado (S19, R34): GEN-<plantilla>-<consecutivo>,
 * p. ej. GEN-012-0001. No reutiliza el código documental del origen: lo
 * generado no lleva codificación del listado maestro.
 */
export function generatedCode(idTemplate: number, sequence: number): string {
  if (!Number.isInteger(idTemplate) || idTemplate < 1) throw new Error('Plantilla inválida.');
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Consecutivo inválido.');
  return `GEN-${String(idTemplate).padStart(3, '0')}-${String(sequence).padStart(4, '0')}`;
}

/** Fecha y hora de Colombia (UTC-5, sin horario de verano) como «YYYY-MM-DD HH:mm». */
export function formatGeneratedAt(at: Date): string {
  return new Date(at.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Leyenda de trazabilidad al pie de cada página del registro (o de su vista previa). */
export function generatorLegend(input: {
  recordCode: string | null;
  documentCode: string;
  documentVersion: number;
  templateVersion: number;
  approvedBy: string;
  approvedAt: Date;
  user: string;
  at: Date;
}): string {
  const head = input.recordCode ? `Registro ${input.recordCode}` : 'VISTA PREVIA - sin validez, no se registró';
  return `${head} · generado por ${input.user} el ${formatGeneratedAt(input.at)} · plantilla ${input.documentCode} V${input.documentVersion} (configuración v${input.templateVersion}, aprobada por Calidad: ${input.approvedBy}, ${formatGeneratedAt(input.approvedAt).slice(0, 10)})`;
}

/** Nombre del archivo del registro en OneDrive. */
export function generatedFileName(recordCode: string): string {
  return `${recordCode}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
}

/** Valida un motivo (propuesta, decisión, retiro o anulación). */
export function normalizeGeneratorReason(raw: unknown, what = 'el motivo'): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < SGC_GENERATOR_REASON_MIN) throw new SgcError(`Explique ${what} (mínimo ${SGC_GENERATOR_REASON_MIN} caracteres): queda en el historial.`);
  return reason.slice(0, SGC_GENERATOR_REASON_MAX);
}

export const SGC_GENERATOR_MODES = ['vista', 'emitir'] as const;
export type SgcGeneratorMode = (typeof SGC_GENERATOR_MODES)[number];

export function parseGeneratorMode(value: unknown): SgcGeneratorMode | null {
  return typeof value === 'string' && (SGC_GENERATOR_MODES as readonly string[]).includes(value) ? (value as SgcGeneratorMode) : null;
}

/** Formato editable del archivo fuente de una versión, o null (solo PDF o Word antiguo). */
export function generatorSourceFormat(sourceFileName: string | null | undefined): 'docx' | 'html' | null {
  const n = (sourceFileName ?? '').trim().toLowerCase();
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.html') || n.endsWith('.htm')) return 'html';
  return null;
}
