/**
 * Guía de codificación del SGC documental — funciones PURAS.
 *
 * Cada empresa configura su guía (sgc.coding_guide): un prefijo (OLP, FAR…)
 * y un patrón con marcas. La nomenclatura por defecto sigue el estilo de
 * Farmalógica con el prefijo de la empresa (reunión del 2026-09-30):
 *
 *   {PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}   →   OLP-GC-PR-001
 *
 * Marcas admitidas:
 *   {PREFIJO}       prefijo de la empresa (OLP)
 *   {TIPO_PROCESO}  código del tipo de proceso (E, M, S, F)
 *   {PROCESO}       código del proceso (GC, DT…)
 *   {TIPO}          código del tipo documental (MA, PR, IN, FO…)
 *   {CONSECUTIVO}   consecutivo con ceros a la izquierda (obligatoria)
 *
 * El consecutivo se lleva por combinación de todo lo que aparece en el patrón
 * antes del consecutivo (p. ej. por proceso y tipo), así que dos procesos
 * distintos pueden tener cada uno su PR-001.
 */

export const SGC_CODING_TOKENS = ['PREFIJO', 'TIPO_PROCESO', 'PROCESO', 'TIPO', 'CONSECUTIVO'] as const;
export type SgcCodingToken = (typeof SGC_CODING_TOKENS)[number];

export const SGC_DEFAULT_CODING_PATTERN = '{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}';
export const SGC_DEFAULT_SEQUENCE_DIGITS = 3;

export interface SgcCodingGuideInput {
  prefix: string;
  pattern: string;
  sequenceDigits: number;
  /**
   * Sprint 8 — HERENCIA del número del documento padre (codificación de OLP,
   * socialización del 2026-10-07): los formatos e instructivos de un
   * procedimiento heredan su número (OLP-GCC-02 → OLP-GCC-02-FO01). Sin
   * childPattern no hay herencia (comportamiento anterior).
   */
  childPattern?: string | null;
  /** Códigos de los tipos documentales que heredan (FO, IN…). */
  childTypeCodes?: readonly string[] | null;
  childSequenceDigits?: number | null;
}

/** Marcas del patrón de los documentos que heredan el número del padre. */
export const SGC_CHILD_CODING_TOKENS = ['PREFIJO', 'TIPO_PROCESO', 'PROCESO', 'TIPO', 'CODIGO_PADRE', 'NUMERO_PADRE', 'CONSECUTIVO'] as const;
/** Patrón de herencia por defecto que se propone: el código del padre, el tipo y un consecutivo propio. */
export const SGC_DEFAULT_CHILD_PATTERN = '{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}';

/** Documento padre del que se hereda el número. */
export interface SgcParentCode {
  code: string;
  /** Consecutivo registrado del padre (si se conoce). */
  sequence?: number | null;
  /** Partes del código del padre (para leer su consecutivo con la guía). */
  parts?: SgcCodeParts | null;
}

export interface SgcCodeParts {
  processTypeCode: string;
  processCode: string;
  documentTypeCode: string;
}

const TOKEN_RE = /\{([A-Z_]+)\}/g;
const DIGITS_RE = /^\d{1,9}$/;
const MASTER_CODE_RE = /^[A-Z0-9]{1,10}$/;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
// Nombres reservados de dispositivo en Windows: OneDrive/SharePoint los rechaza
// como nombre de carpeta (el código del documento es una carpeta).
const RESERVED_WINDOWS_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

/** Error de un código de maestro (prefijo, tipo de proceso, proceso, tipo documental), o null. */
export function getMasterCodeError(code: string): string | null {
  const value = (code ?? '').trim();
  if (!value) return 'El código es obligatorio.';
  if (!MASTER_CODE_RE.test(value)) return 'El código solo admite mayúsculas y números (máximo 10).';
  if (RESERVED_WINDOWS_DEVICE_NAMES.test(value)) return `"${value}" es un nombre reservado de Windows.`;
  return null;
}

/** Valida la guía de codificación. Devuelve la lista de errores (vacía si es válida). */
export function validateCodingGuide(guide: SgcCodingGuideInput): string[] {
  const errors: string[] = [];
  const prefixError = getMasterCodeError(guide.prefix);
  if (prefixError) errors.push(`Prefijo: ${prefixError}`);

  const pattern = (guide.pattern ?? '').trim();
  if (!pattern) {
    errors.push('El patrón es obligatorio.');
  } else {
    const tokens = [...pattern.matchAll(TOKEN_RE)].map((m) => m[1]);
    const unknown = tokens.filter((t) => !(SGC_CODING_TOKENS as readonly string[]).includes(t));
    if (unknown.length) errors.push(`Marcas desconocidas: ${unknown.map((t) => `{${t}}`).join(', ')}.`);
    const seq = tokens.filter((t) => t === 'CONSECUTIVO').length;
    if (seq !== 1) errors.push('El patrón debe tener exactamente una marca {CONSECUTIVO}.');
    const literal = pattern.replace(TOKEN_RE, '');
    if (/[^A-Za-z0-9._-]/.test(literal)) {
      errors.push('Fuera de las marcas, el patrón solo admite letras, números, punto, guion y guion bajo.');
    }
  }

  if (!Number.isInteger(guide.sequenceDigits) || guide.sequenceDigits < 1 || guide.sequenceDigits > 6) {
    errors.push('Los dígitos del consecutivo deben estar entre 1 y 6.');
  }
  errors.push(...validateChildCoding(guide));
  return errors;
}

/**
 * Sprint 8: valida la herencia del número del padre. Sin patrón de herencia
 * no hay nada que validar (la guía funciona como antes).
 */
export function validateChildCoding(guide: Pick<SgcCodingGuideInput, 'childPattern' | 'childTypeCodes' | 'childSequenceDigits'>): string[] {
  const pattern = (guide.childPattern ?? '').trim();
  if (!pattern) return [];
  const errors: string[] = [];
  const tokens = [...pattern.matchAll(TOKEN_RE)].map((m) => m[1]);
  const unknown = tokens.filter((t) => !(SGC_CHILD_CODING_TOKENS as readonly string[]).includes(t));
  if (unknown.length) errors.push(`Herencia: marcas desconocidas ${unknown.map((t) => `{${t}}`).join(', ')}.`);
  if (tokens.filter((t) => t === 'CONSECUTIVO').length !== 1) errors.push('Herencia: el patrón debe tener exactamente una marca {CONSECUTIVO}.');
  if (!tokens.includes('CODIGO_PADRE') && !tokens.includes('NUMERO_PADRE')) errors.push('Herencia: el patrón debe usar {CODIGO_PADRE} o {NUMERO_PADRE}.');
  if (/[^A-Za-z0-9._-]/.test(pattern.replace(TOKEN_RE, ''))) {
    errors.push('Herencia: fuera de las marcas, el patrón solo admite letras, números, punto, guion y guion bajo.');
  }
  const codes = guide.childTypeCodes ?? [];
  if (codes.length === 0) errors.push('Herencia: indique qué tipos documentales heredan el número (por ejemplo FO, IN).');
  for (const c of codes) {
    const e = getMasterCodeError(c);
    if (e) errors.push(`Herencia, tipo «${c}»: ${e}`);
  }
  const d = guide.childSequenceDigits ?? 2;
  if (!Number.isInteger(d) || d < 1 || d > 6) errors.push('Herencia: los dígitos del consecutivo deben estar entre 1 y 6.');
  return errors;
}

/** Lista de códigos de tipo documental (texto separado por comas o espacios) normalizada. */
export function parseChildTypeCodes(raw: string | readonly string[] | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/);
  return [...new Set(list.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
}

/** ¿El tipo documental hereda el número de un documento padre con esta guía? */
export function inheritsParentNumber(guide: SgcCodingGuideInput, documentTypeCode: string): boolean {
  if (!(guide.childPattern ?? '').trim()) return false;
  return (guide.childTypeCodes ?? []).map((c) => c.toUpperCase()).includes(documentTypeCode.trim().toUpperCase());
}

/**
 * Número del padre que heredan los hijos: su consecutivo con los dígitos de
 * la guía; si no está registrado, el que se lee de su código con la guía; si
 * el código no sigue la guía (carga inicial), los dígitos finales del código.
 */
export function parentNumberOf(guide: SgcCodingGuideInput, parent: SgcParentCode): string | null {
  if (parent.sequence && parent.sequence > 0) return String(parent.sequence).padStart(guide.sequenceDigits, '0');
  if (parent.parts) {
    const n = parseSequenceFromCode(guide, parent.parts, parent.code);
    if (n !== null) return String(n).padStart(guide.sequenceDigits, '0');
  }
  const tail = /(\d+)$/.exec(parent.code.trim());
  return tail ? tail[1] : null;
}

function childValues(guide: SgcCodingGuideInput, parts: SgcCodeParts, parent: SgcParentCode): Record<string, string> {
  const number = parentNumberOf(guide, parent);
  if (number === null) throw new Error(`El código del documento padre (${parent.code}) no termina en un número: no se puede heredar.`);
  return { ...tokenValues(guide, parts), CODIGO_PADRE: normalizeDocumentCode(parent.code), NUMERO_PADRE: number };
}

function childPatternOf(guide: SgcCodingGuideInput): { pattern: string; digits: number } {
  const pattern = (guide.childPattern ?? '').trim();
  if (!pattern) throw new Error('La guía no tiene patrón de herencia.');
  return { pattern, digits: guide.childSequenceDigits ?? 2 };
}

/** Raíz del código de un hijo (todo lo que va antes del consecutivo). */
export function buildChildCodeRoot(guide: SgcCodingGuideInput, parts: SgcCodeParts, parent: SgcParentCode): string {
  const { pattern } = childPatternOf(guide);
  const values = childValues(guide, parts, parent);
  return pattern.split('{CONSECUTIVO}')[0].replace(TOKEN_RE, (_, t: string) => values[t] ?? '');
}

/** Código completo de un hijo para un consecutivo. */
export function buildChildCode(guide: SgcCodingGuideInput, parts: SgcCodeParts, parent: SgcParentCode, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('El consecutivo debe ser un entero positivo.');
  const { pattern, digits } = childPatternOf(guide);
  const values = childValues(guide, parts, parent);
  const padded = String(sequence).padStart(digits, '0');
  return pattern.replace(TOKEN_RE, (_, t: string) => (t === 'CONSECUTIVO' ? padded : (values[t] ?? '')));
}

/** Consecutivo de un código de hijo (o null si no sigue el patrón para ese padre). */
export function parseChildSequence(guide: SgcCodingGuideInput, parts: SgcCodeParts, parent: SgcParentCode, code: string): number | null {
  const { pattern } = childPatternOf(guide);
  const values = childValues(guide, parts, parent);
  const [head, tail = ''] = pattern.split('{CONSECUTIVO}');
  const resolve = (x: string) => x.replace(TOKEN_RE, (_, t: string) => values[t] ?? '').toUpperCase();
  const prefix = resolve(head);
  const suffix = resolve(tail);
  const upper = code.trim().toUpperCase();
  if (!upper.startsWith(prefix) || !upper.endsWith(suffix) || upper.length <= prefix.length + suffix.length) return null;
  const middle = upper.slice(prefix.length, upper.length - suffix.length);
  return DIGITS_RE.test(middle) && Number(middle) >= 1 ? Number(middle) : null;
}

/** Siguiente consecutivo libre de los hijos de un padre. */
export function nextChildSequence(guide: SgcCodingGuideInput, parts: SgcCodeParts, parent: SgcParentCode, existingCodes: Iterable<string>): number {
  let max = 0;
  for (const code of existingCodes) {
    const n = parseChildSequence(guide, parts, parent, code);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

/**
 * ¿El código sigue la guía para estas partes? (con herencia si el tipo
 * hereda y se conoce el padre). Sirve para AVISAR en la carga del listado
 * maestro: los códigos reales de la empresa se respetan aunque no la sigan.
 */
export function codeFollowsGuide(guide: SgcCodingGuideInput, parts: SgcCodeParts, code: string, parent: SgcParentCode | null = null): boolean {
  if (inheritsParentNumber(guide, parts.documentTypeCode) && parent) {
    try {
      return parseChildSequence(guide, parts, parent, code) !== null;
    } catch {
      return false;
    }
  }
  return parseSequenceFromCode(guide, parts, code) !== null;
}

function tokenValues(guide: SgcCodingGuideInput, parts: SgcCodeParts): Record<Exclude<SgcCodingToken, 'CONSECUTIVO'>, string> {
  return {
    PREFIJO: guide.prefix.trim(),
    TIPO_PROCESO: parts.processTypeCode.trim(),
    PROCESO: parts.processCode.trim(),
    TIPO: parts.documentTypeCode.trim(),
  };
}

/**
 * Raíz del código: el patrón resuelto hasta antes de {CONSECUTIVO}. Todos los
 * documentos con la misma raíz comparten la serie del consecutivo.
 */
export function buildCodeRoot(guide: SgcCodingGuideInput, parts: SgcCodeParts): string {
  const values = tokenValues(guide, parts);
  const head = guide.pattern.split('{CONSECUTIVO}')[0];
  return head.replace(TOKEN_RE, (_, t: string) => values[t as keyof typeof values] ?? '');
}

/** Arma el código completo para un consecutivo dado. */
export function buildDocumentCode(guide: SgcCodingGuideInput, parts: SgcCodeParts, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('El consecutivo debe ser un entero positivo.');
  const values = tokenValues(guide, parts);
  const padded = String(sequence).padStart(guide.sequenceDigits, '0');
  return guide.pattern.replace(TOKEN_RE, (_, t: string) =>
    t === 'CONSECUTIVO' ? padded : (values[t as keyof typeof values] ?? '')
  );
}

/**
 * Si `code` sigue el patrón para estas partes, devuelve su consecutivo; si no,
 * null. Sirve para calcular el siguiente consecutivo a partir de los códigos
 * existentes, incluidos los que Calidad cargó con su código de siempre.
 */
export function parseSequenceFromCode(guide: SgcCodingGuideInput, parts: SgcCodeParts, code: string): number | null {
  const values = tokenValues(guide, parts);
  const [head, tail = ''] = guide.pattern.split('{CONSECUTIVO}');
  const resolve = (s: string) => s.replace(TOKEN_RE, (_, t: string) => values[t as keyof typeof values] ?? '');
  const prefix = resolve(head).toUpperCase();
  const suffix = resolve(tail).toUpperCase();
  const upper = code.trim().toUpperCase();
  if (!upper.startsWith(prefix) || !upper.endsWith(suffix)) return null;
  const middle = upper.slice(prefix.length, upper.length - suffix.length);
  if (!DIGITS_RE.test(middle)) return null;
  const n = Number(middle);
  return n >= 1 ? n : null;
}

/** Siguiente consecutivo libre dados los códigos existentes de la empresa. */
export function nextSequence(guide: SgcCodingGuideInput, parts: SgcCodeParts, existingCodes: Iterable<string>): number {
  let max = 0;
  for (const code of existingCodes) {
    const n = parseSequenceFromCode(guide, parts, code);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

/** Normaliza un código de documento (mayúsculas, sin espacios alrededor). */
export function normalizeDocumentCode(code: string): string {
  return (code ?? '').trim().toUpperCase();
}

/**
 * Valida el código de un documento. El código es además el nombre de su
 * carpeta en OneDrive, por eso se rechazan caracteres y nombres reservados.
 */
export function getDocumentCodeError(code: string): string | null {
  const value = (code ?? '').trim();
  if (!value) return 'El código es obligatorio.';
  if (!CODE_PATTERN.test(value)) {
    return 'El código solo admite letras, números, punto, guion y guion bajo (máximo 60 caracteres).';
  }
  if (RESERVED_WINDOWS_DEVICE_NAMES.test(value)) {
    return `"${value}" es un nombre reservado de Windows y OneDrive no permite usarlo como código.`;
  }
  return null;
}

/** Etiqueta visible de un documento: «código · V<n> · título». */
export function formatDocumentLabel(code: string, versionNumber: number | null | undefined, title: string): string {
  const version = versionNumber ? `V${versionNumber}` : 'sin versión';
  return `${code} · ${version} · ${title}`;
}
