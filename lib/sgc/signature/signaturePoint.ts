import type { SgcSignatureMeaning } from '../flows/definition';
import { SGC_SIGNATURE_LABELS } from '../flows/definition';

/**
 * PUNTO DE FIRMA del SGC en cada cupo de una tarea (Sprint 2 → Sprint 3).
 *
 * El S2 dejó preparado el punto de firma de cada decisión (Elaboró, Revisó,
 * Aprobó…) como «pendiente_s3». Desde el S3 ese punto se cumple con la FIRMA
 * ELECTRÓNICA PROPIA del SGC (lib/sgc/signature/**, sgc.signature):
 * reautenticación con la contraseña de SynerLink, significado, motivo, sello
 * de tiempo del servidor, hash SHA-256 del contenido y evidencia en el espacio
 * de la empresa. Aprobar (o enviar) un paso con firma SIN firmar ya no es
 * posible: el motor lo rechaza.
 *
 * Estados:
 *   - no_aplica     la tarea no lleva firma;
 *   - pendiente     falta firmar;
 *   - firmada       firmada (id_signature apunta a sgc.signature);
 *   - sin_firma_s2  decidido en el S2 con la sesión, antes de existir la firma
 *                   propia (se deja constancia; no se inventa una firma).
 */

export type SgcSignatureStatus = 'no_aplica' | 'pendiente' | 'firmada' | 'sin_firma_s2';

export const SGC_SIGNATURE_STATUS_LABELS: Record<SgcSignatureStatus, string> = {
  no_aplica: 'Sin firma',
  pendiente: 'Firma pendiente',
  firmada: 'Firmada',
  sin_firma_s2: 'Decidida sin firma electrónica (Sprint 2)',
};

export const SGC_SIGNATURE_NOTICE =
  'Para aprobar este paso se firma electrónicamente: confirme su contraseña de SynerLink, el significado y el motivo. Queda el sello de tiempo del servidor y la huella del contenido que firma.';

export interface SgcSignaturePoint {
  signatureStatus: SgcSignatureStatus;
  signatureMeaning: SgcSignatureMeaning | null;
}

/** Punto de firma de un firmante al crearse la tarea. */
export function signaturePointFor(meaning: SgcSignatureMeaning | null): SgcSignaturePoint {
  return { signatureStatus: meaning ? 'pendiente' : 'no_aplica', signatureMeaning: meaning };
}

/** Texto para el historial: «Revisó (firmado)», «Aprobó (firma pendiente)». */
export function describeSignaturePoint(meaning: string | null | undefined, status: string): string | null {
  if (!meaning || status === 'no_aplica') return null;
  const label = SGC_SIGNATURE_LABELS[meaning as SgcSignatureMeaning] ?? meaning;
  if (status === 'firmada') return `${label} (firmado electrónicamente)`;
  if (status === 'sin_firma_s2') return `${label} (decidido en el Sprint 2, sin firma electrónica)`;
  return `${label} (firma pendiente)`;
}
