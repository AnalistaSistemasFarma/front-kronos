'use client';

import type { SealImageBytes } from '../../lib/orion/annotationStamp';
import type { OrionDocumentAnnotation, OrionSignatureState } from '../../lib/orion/types';
import { fetchPdfArrayBuffer } from './pdfFetchCache';

/** Lo que se ve en pantalla (aún sin guardar): sin autor, se completa con quien previsualiza. */
export type PreviewAnnotation = Pick<
  OrionDocumentAnnotation,
  'id' | 'kind' | 'page' | 'x' | 'y' | 'width' | 'height'
> &
  Partial<OrionDocumentAnnotation>;

type AnnotatedPdfParams = {
  /** PDF base SIN sellos/datos de SynerLink (annotations=0 o blob ya cargado). */
  pdfUrl: string;
  annotations: PreviewAnnotation[];
  sealImageSrc: (sealItemId: string) => string;
  viewerName: string;
};

async function loadSeal(url: string): Promise<SealImageBytes | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get('content-type') || 'image/png',
    };
  } catch {
    return null;
  }
}

/**
 * El documento con los sellos y datos que hay en pantalla estampados encima y, si se pasa
 * `validatorState`, también el visto bueno (chulito, nombre y fecha) de cada validador que
 * aprobó, en la caja donde se ubicó (sin caja: esquina inferior derecha de la última hoja).
 */
async function buildAnnotatedPdf(
  params: AnnotatedPdfParams & { validatorState?: OrionSignatureState }
): Promise<Uint8Array> {
  const now = new Date().toISOString();
  const list: OrionDocumentAnnotation[] = params.annotations.map((a) => ({
    ...a,
    text: a.text ?? null,
    sealItemId: a.sealItemId ?? null,
    createdByEmail: a.createdByEmail || params.viewerName,
    createdByName: a.createdByName || params.viewerName,
    createdAt: a.createdAt || now,
  }));

  const sealIds = [
    ...new Set(list.filter((a) => a.kind === 'seal' && a.sealItemId).map((a) => String(a.sealItemId))),
  ];
  const [pdf, ...sealImages] = await Promise.all([
    fetchPdfArrayBuffer(params.pdfUrl),
    ...sealIds.map((id) => loadSeal(params.sealImageSrc(id))),
  ]);
  const seals = Object.fromEntries(sealIds.map((id, i) => [id, sealImages[i]]));

  // pdf-lib se descarga solo al pedir el PDF, no al abrir la pantalla.
  const [{ stampAnnotations }, { buildValidatorMarks, stampValidatorMarks }] = await Promise.all([
    import('../../lib/orion/annotationStamp'),
    import('../../lib/orion/validatorStamp'),
  ]);
  let bytes: Uint8Array = new Uint8Array(pdf);
  if (params.validatorState) {
    bytes = await stampValidatorMarks(bytes, buildValidatorMarks(params.validatorState));
  }
  return stampAnnotations(bytes, list, seals);
}

/**
 * Abre en una pestaña nueva el PDF tal como quedará: el documento (sin la capa ya guardada)
 * con los sellos y datos que hay en pantalla estampados encima.
 */
export async function openAnnotatedPdfPreview(params: AnnotatedPdfParams): Promise<void> {
  // La pestaña se abre ya (en el clic) para que el navegador no la bloquee como ventana emergente.
  const tab = window.open('', '_blank');
  try {
    if (tab) {
      tab.document.title = 'Vista previa';
      tab.document.body.innerHTML =
        '<p style="font-family:sans-serif;padding:24px">Preparando la vista previa del documento…</p>';
    }
    const stamped = await buildAnnotatedPdf(params);
    const url = URL.createObjectURL(new Blob([stamped as BlobPart], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    // La pestaña ya cargó el PDF; se libera la memoria después.
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (err) {
    tab?.close();
    throw err instanceof Error ? err : new Error('No se pudo armar la vista previa');
  }
}

/** Nombre del archivo del borrador: «Contrato (borrador con validadores).pdf». */
export function draftPdfFileName(fileName: string | null | undefined): string {
  const base = String(fileName || 'Documento').replace(/\.pdf$/i, '').trim() || 'Documento';
  return `${base} (borrador con validadores).pdf`;
}

/**
 * Descarga el BORRADOR del documento en preparación: el PDF con el visto bueno de los
 * validadores donde quedaron ubicados (los que validaron en el Word también, porque su
 * aprobación pasa al PDF) y los sellos que hay en pantalla. Las firmas de los firmantes aún
 * no existen: sus cajas no se dibujan.
 */
export async function downloadDraftPdfWithValidators(
  params: AnnotatedPdfParams & { validatorState: OrionSignatureState; fileName: string }
): Promise<void> {
  const stamped = await buildAnnotatedPdf(params);
  const url = URL.createObjectURL(new Blob([stamped as BlobPart], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = params.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}
