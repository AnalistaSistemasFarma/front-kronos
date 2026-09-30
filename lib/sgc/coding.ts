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
}

export interface SgcCodeParts {
  processTypeCode: string;
  processCode: string;
  documentTypeCode: string;
}

const TOKEN_RE = /\{([A-Z_]+)\}/g;
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
  return errors;
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
  if (!/^\d{1,9}$/.test(middle)) return null;
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
