import { normalizeAnnotationsInput, SEAL_MAX_BYTES } from '../orion/annotations';
import { stampAnnotations, type SealImageBytes } from '../orion/annotationStamp';
import type { OrionDocumentAnnotation } from '../orion/types';

/**
 * Lo que el ingeniero biomédico escribe ENCIMA del formato vigente (2026-11-06).
 * Es el mismo «Texto y sellos» de la validación de documentos (Orion): mismas
 * reglas (normalizeAnnotationsInput: posición en % de la página, letra, tamaño,
 * negrita, quién y cuándo) y mismo estampado (stampAnnotations). Aquí solo va
 * lo propio del módulo: más elementos por formato y los sellos del registro.
 */

/** Un formato diligenciado lleva más datos que los 30 de Orion. */
export const MAX_ANOTACIONES = 300;
/** Sellos (imágenes) cargados en un mismo registro. */
export const MAX_SELLOS = 20;

export type BiomedAnotacion = OrionDocumentAnnotation;

/** Imagen de sello cargada en el registro (OneDrive, con su huella). */
export interface BiomedSello {
  itemId: string;
  fileName: string;
  mime: 'image/png' | 'image/jpeg';
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

/** Lo guardado en biomed_registro.data_json. */
export interface BiomedDatos {
  anotaciones: BiomedAnotacion[];
  sellos: BiomedSello[];
}

export class AnotacionInvalida extends Error {}

/** Primera versión del módulo (lista de { tipo: 'texto' | 'marca' }), en Helvetica 9 pt y «X» de 11 pt. */
type AnotacionV1 = { id?: unknown; tipo?: unknown; page?: unknown; x?: unknown; y?: unknown; texto?: unknown; negrilla?: unknown };
const V1_TEXTO_PT = 9;
const V1_MARCA_PT = 11;
const V1_ALTO_PAGINA_PT = 841.89;

/** Lo guardado con la primera versión, como datos de «Texto y sellos» (una línea por dato). */
function desdeV1(lista: AnotacionV1[]): BiomedAnotacion[] {
  const out: BiomedAnotacion[] = [];
  for (const a of lista) {
    const page = Number(a?.page);
    const x = Number(a?.x);
    const y = Number(a?.y);
    if (!Number.isFinite(page) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const id = String(a.id ?? out.length).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50) || `v1${out.length}`;
    const base = { kind: 'text' as const, page, x, width: 10, fontFamily: 'helvetica' as const, label: null, sealItemId: null, sealFileName: null, createdByEmail: '', createdAt: '' };
    if (a.tipo === 'marca') {
      out.push({ ...base, id, y, height: (V1_MARCA_PT / V1_ALTO_PAGINA_PT) * 100, text: 'X', fontSize: V1_MARCA_PT, bold: true });
      continue;
    }
    String(a.texto ?? '')
      .split('\n')
      .forEach((linea, i) => {
        if (!linea.trim()) return;
        const alto = (V1_TEXTO_PT * 1.15) / V1_ALTO_PAGINA_PT * 100;
        out.push({ ...base, id: `${id}-${i}`, y: y + i * alto, height: alto, text: linea.slice(0, 200), fontSize: V1_TEXTO_PT, bold: a.negrilla === true });
      });
  }
  return out;
}

export function leerDatos(json: string | null | undefined): BiomedDatos {
  if (!json) return { anotaciones: [], sellos: [] };
  try {
    const v = JSON.parse(json) as Partial<BiomedDatos> | AnotacionV1[] | null;
    if (Array.isArray(v)) return { anotaciones: desdeV1(v), sellos: [] };
    if (!v || typeof v !== 'object') return { anotaciones: [], sellos: [] };
    return {
      anotaciones: Array.isArray(v.anotaciones) ? v.anotaciones.filter((a) => a && (a.kind === 'text' || a.kind === 'seal')) : [],
      sellos: Array.isArray(v.sellos) ? v.sellos.filter((s) => s && typeof s.itemId === 'string') : [],
    };
  } catch {
    return { anotaciones: [], sellos: [] };
  }
}

/**
 * Valida lo que llega del navegador con las reglas de Orion (conserva quién creó cada
 * dato y marca quién lo cambió). Un sello solo vale si su imagen es de este registro.
 */
export function normalizarAnotaciones(
  raw: unknown,
  previas: BiomedAnotacion[],
  sellos: BiomedSello[],
  actor: { email: string; name?: string | null },
  now: string = new Date().toISOString()
): BiomedAnotacion[] {
  let list: BiomedAnotacion[];
  try {
    list = normalizeAnnotationsInput(raw, previas, actor, now, { maxItems: MAX_ANOTACIONES });
  } catch (e) {
    throw new AnotacionInvalida(e instanceof Error ? e.message : 'Datos inválidos.');
  }
  const propios = new Set(sellos.map((s) => s.itemId));
  if (list.some((a) => a.kind === 'seal' && !propios.has(String(a.sealItemId)))) {
    throw new AnotacionInvalida('El sello no pertenece a este registro: cárguelo de nuevo.');
  }
  return list;
}

/** PNG o JPG de verdad (por sus primeros bytes, no por lo que diga el navegador). */
export function tipoDeImagen(bytes: Uint8Array): BiomedSello['mime'] | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function validarImagenSello(bytes: Uint8Array): BiomedSello['mime'] {
  if (bytes.byteLength === 0 || bytes.byteLength > SEAL_MAX_BYTES) throw new AnotacionInvalida('La imagen del sello debe pesar máximo 2 MB.');
  const mime = tipoDeImagen(bytes);
  if (!mime) throw new AnotacionInvalida('El sello debe ser una imagen PNG o JPG.');
  return mime;
}

/** Dibuja lo diligenciado encima del PDF (el estampado de Orion). */
export function dibujarAnotaciones(
  pdfBytes: Uint8Array,
  anotaciones: readonly BiomedAnotacion[],
  sellos: Record<string, SealImageBytes | null | undefined> = {}
): Promise<Uint8Array> {
  return stampAnnotations(pdfBytes, [...anotaciones], sellos);
}
