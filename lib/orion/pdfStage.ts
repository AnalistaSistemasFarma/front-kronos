/**
 * Etapa de un PDF "Para firmar" en la tabla de adjuntos:
 *   0 Validación PDF → 1 Ubicar firmas → 2 Firmas → 3 listo (firmado).
 * Se calcula solo con el estado guardado del documento, para que la barra diga lo mismo que
 * la insignia de estado y la columna de firmantes.
 */
export const PDF_STAGES = ['Validación PDF', 'Ubicar firmas', 'Firmas'] as const;

export type PdfStageTone = 'normal' | 'returned' | 'rejected';

export type PdfStageInfo = {
  /** 0..2 = etapa en curso; 3 = todo firmado. */
  stage: number;
  tone: PdfStageTone;
  /** Texto bajo la barra cuando no basta con "Etapa X de 3 · nombre". */
  note: string | null;
};

export function pdfStageOf(input: {
  status?: string | null;
  orionDocumentId?: string | null;
  signersTotal: number;
  signersDone: number;
  /** La validación del PDF quedó aprobada o no hace falta (null = aún no se sabe). */
  readyForSigning: boolean | null;
}): PdfStageInfo {
  const status = String(input.status || '').trim().toUpperCase();
  const total = Math.max(0, input.signersTotal);
  const done = Math.min(Math.max(0, input.signersDone), total);

  if (status === 'FIRMADO' || (total > 0 && done === total)) {
    return { stage: 3, tone: 'normal', note: null };
  }
  if (status === 'RECHAZADO') {
    return { stage: 2, tone: 'rejected', note: 'Rechazado: no se firmará' };
  }
  if (status === 'DEVUELTO') {
    // Vuelve a corrección: el PDF corregido pasa otra vez por la validación.
    return { stage: 0, tone: 'returned', note: 'Devuelto para corrección' };
  }
  // Enviado a firmar (igual que la insignia: con documento en Orion y sin estado, está en proceso).
  const sent =
    status === 'PENDIENTE_FIRMA' ||
    status === 'EN_PROCESO' ||
    (!status && Boolean(input.orionDocumentId));
  if (sent && total > 0) {
    return { stage: 2, tone: 'normal', note: `Etapa 3 de 3 · Firmas (${done} de ${total})` };
  }
  // Borrador: con firmantes asignados aún falta ubicarlos y enviar.
  return { stage: input.readyForSigning === true ? 1 : 0, tone: 'normal', note: null };
}
