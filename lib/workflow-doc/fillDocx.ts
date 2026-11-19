/**
 * Motor «word» de la tarea Plantilla de documento: llena un .docx con marcas «@{Etiqueta}»
 * escritas en Word, conservando su formato (docxtemplater + pizzip, delimitadores «@{» y «}»).
 * Solo servidor (no depende de la BD).
 */
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { resolveWordLabel, type DocMarker, type DocResolvedValue } from './fields';

const DELIMITERS = { start: '@{', end: '}' };

export interface WordTagReport {
  /** Etiqueta tal como se escribió en Word. */
  tag: string;
  /** Clave de la marca a la que resuelve, o null si no corresponde a ningún campo. */
  key: string | null;
}

function newDoc(bytes: Uint8Array, valueOf: (tag: string) => string = () => ''): Docxtemplater {
  const zip = new PizZip(Buffer.from(bytes));
  return new Docxtemplater(zip, {
    delimiters: DELIMITERS,
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
    // Cada marca es una etiqueta libre (con espacios y tildes): se resuelve por etiqueta normalizada.
    parser: (tag: string) => ({ get: () => valueOf(tag) }),
  });
}

/** Mensaje legible de un error de docxtemplater (marca mal cerrada, etc.). */
export function docxErrorMessage(e: unknown): string {
  const errs = (e as { properties?: { errors?: Array<{ properties?: { explanation?: string } }> } })?.properties?.errors;
  if (Array.isArray(errs) && errs.length) {
    return errs
      .map((x) => x?.properties?.explanation)
      .filter(Boolean)
      .slice(0, 5)
      .join(' · ');
  }
  return e instanceof Error ? e.message : String(e);
}

/** Marcas «@{…}» del Word y si resuelven a un campo del proceso o a una variable del sistema. */
export function detectDocxTags(bytes: Uint8Array, catalog: readonly DocMarker[]): WordTagReport[] {
  let text: string;
  try {
    text = newDoc(bytes).getFullText();
  } catch (e) {
    throw new Error(`El Word de la plantilla tiene marcas mal escritas: ${docxErrorMessage(e)}`);
  }
  const seen = new Set<string>();
  const out: WordTagReport[] = [];
  for (const m of text.matchAll(/@\{([^{}]{1,100})\}/g)) {
    const tag = m[1].trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, key: resolveWordLabel(tag, catalog) });
  }
  return out;
}

export interface FillDocxResult {
  bytes: Uint8Array;
  /** Marcas del Word que no corresponden a ningún campo (quedaron vacías). */
  unknown: string[];
}

/** Llena el Word. Las marcas desconocidas quedan vacías y se reportan. */
export function fillDocx(bytes: Uint8Array, catalog: readonly DocMarker[], values: Readonly<Record<string, DocResolvedValue>>): FillDocxResult {
  const unknown = new Set<string>();
  let doc: Docxtemplater;
  try {
    doc = newDoc(bytes, (tag) => {
      const key = resolveWordLabel(tag, catalog);
      if (!key) {
        unknown.add(tag.trim());
        return '';
      }
      return values[key]?.text ?? '';
    });
    doc.render({});
  } catch (e) {
    throw new Error(`El Word de la plantilla tiene marcas mal escritas: ${docxErrorMessage(e)}`);
  }
  const out = doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;
  return { bytes: out, unknown: [...unknown] };
}
