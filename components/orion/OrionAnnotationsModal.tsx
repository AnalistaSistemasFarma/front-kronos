'use client';

import { Text } from '@mantine/core';
import { documentFullySigned, latestAnnotatedCopy } from '../../lib/orion/annotations';
import type { OrionSignatureState } from '../../lib/orion/types';
import PdfAnnotationsModal, { type PdfAnnotationDraft } from '../pdf-annotations/PdfAnnotationsModal';

export type OrionAnnotationsModalProps = {
  opened: boolean;
  onClose: () => void;
  requestId: number;
  fileId: string;
  fileName: string;
  state: OrionSignatureState;
  onDocumentsUpdate?: (documents: Record<string, OrionSignatureState>) => void;
  /** Nombre para la leyenda de lo que aún no se ha guardado (vista previa). */
  currentUserName?: string | null;
};

/**
 * Texto y sellos DESPUÉS de firmar (p. ej. consecutivo, tipo de cambio y fecha del giro).
 * Como en un editor de PDF: "Texto", clic donde va, escribir. Se elige letra y tamaño.
 * No tocan las firmas: quedan como una capa aparte, con quién y cuándo, y nota en el historial.
 * El editor es el común (components/pdf-annotations); aquí va lo propio de Orion.
 */
export default function OrionAnnotationsModal({
  opened,
  onClose,
  requestId,
  fileId,
  fileName,
  state,
  onDocumentsUpdate,
  currentUserName = null,
}: OrionAnnotationsModalProps) {
  // El firmado limpio: sin los datos ya estampados (aquí se dibujan como cajas editables)
  // y sin la marca de agua de SynerLink encima.
  const pdfSrc = `/api/integrations/orion/signed-file?${new URLSearchParams({
    requestId: String(requestId),
    fileId,
    annotations: '0',
    watermark: '0',
  })}`;

  const sealSrc = (itemId: string) =>
    `/api/integrations/orion/annotations/seal?${new URLSearchParams({ requestId: String(requestId), fileId, itemId })}`;

  const uploadSeal = async (file: File) => {
    const form = new FormData();
    form.append('requestId', String(requestId));
    form.append('fileId', fileId);
    form.append('file', file);
    const res = await fetch('/api/integrations/orion/annotations/seal', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el sello');
    return { sealItemId: data.sealItemId as string, sealFileName: data.sealFileName as string };
  };

  const save = async (annotations: PdfAnnotationDraft[]) => {
    const res = await fetch('/api/integrations/orion/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, fileId, annotations }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudieron guardar los cambios');
    if (data.documents) onDocumentsUpdate?.(data.documents as Record<string, OrionSignatureState>);
    const copy = latestAnnotatedCopy(data.state as OrionSignatureState | undefined);
    return copy && copy.round > (latestAnnotatedCopy(state)?.round ?? 0)
      ? `Guardado. Quedó la copia "${copy.label}" en el historial de versiones.`
      : 'Guardado.';
  };

  return (
    <PdfAnnotationsModal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>Texto y sellos después de firmar · {fileName}</Text>}
      notice={
        <>
          Lo que agregue aquí no cambia las firmas: queda encima del documento firmado. Cada vez que
          guarde se crea una copia nueva (“Datos 1”, “Datos 2”…) en el historial de versiones; las
          anteriores no se borran.
        </>
      }
      pdfSrc={pdfSrc}
      initial={state.annotations ?? []}
      textEnabled={documentFullySigned(state)}
      textDisabledTooltip='Disponible cuando el documento tenga todas las firmas'
      textDisabledHint='El texto se agrega cuando el documento tenga todas las firmas. Por ahora solo puede ubicar sellos.'
      loadingLabel='Cargando el documento firmado…'
      sealSrc={sealSrc}
      uploadSeal={uploadSeal}
      onSave={save}
      currentUserName={currentUserName}
    />
  );
}
