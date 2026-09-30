import type { SgcSignatureMeaning } from '../flows/definition';
import { SGC_SIGNATURE_LABELS } from '../flows/definition';

/**
 * PUNTO DE FIRMA del SGC — ⚠️ STUB DEL SPRINT 2.
 *
 * La firma electrónica PROPIA del SGC (reautenticación, motivo/significado,
 * sello de tiempo del servidor, hash SHA-256 del documento, evidencias en el
 * espacio de OLP; copia congelada de GSS Firma/Orión, sin llamarla) llega en
 * el Sprint 3 (plan, «Sprint 3 — Firma electrónica propia»). En el S2 cada
 * decisión de un paso con firma (Elaboró, Revisó, Aprobó…) deja registrado
 * QUÉ firma corresponde y queda en estado «pendiente_s3»; el S3 reemplaza
 * esta función por la firma real en el mismo punto, sin cambiar el motor.
 *
 * No hay reautenticación en el S2: la decisión se toma con la sesión activa
 * y queda en el historial y en la auditoría.
 */

export type SgcSignatureStatus = 'no_aplica' | 'pendiente_s3' | 'firmada';

export const SGC_SIGNATURE_STUB_NOTICE =
  'La firma electrónica propia del SGC (con reautenticación y motivo) se habilita en el Sprint 3. Por ahora la decisión queda registrada con su sesión.';

export interface SgcSignaturePoint {
  signatureStatus: SgcSignatureStatus;
  signatureMeaning: SgcSignatureMeaning | null;
}

/** Punto de firma de un firmante al crearse la tarea. */
export function signaturePointFor(meaning: SgcSignatureMeaning | null): SgcSignaturePoint {
  return { signatureStatus: meaning ? 'pendiente_s3' : 'no_aplica', signatureMeaning: meaning };
}

/** Texto para el historial: «Revisó (firma electrónica pendiente — Sprint 3)». */
export function describeSignaturePoint(meaning: string | null | undefined, status: string): string | null {
  if (!meaning || status === 'no_aplica') return null;
  const label = SGC_SIGNATURE_LABELS[meaning as SgcSignatureMeaning] ?? meaning;
  return status === 'firmada' ? `${label} (firmado)` : `${label} (firma electrónica pendiente — Sprint 3)`;
}
