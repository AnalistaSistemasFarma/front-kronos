/** Códigos estables que Orion devuelve junto al mensaje de error (contrato v3). */
export type OrionErrorCode =
  | 'SIGNATURE_NOT_REGISTERED'
  | 'FINGERPRINT_NOT_REGISTERED'
  | 'NOT_YOUR_TURN'
  | 'SIGNER_ALREADY_SIGNED'
  | 'DOCUMENT_CLOSED'
  | 'SIGNER_NOT_FOUND'
  | 'SIGNED_SIGNER_LOCKED';

export const FINGERPRINT_NOT_REGISTERED_MESSAGE =
  'Este documento requiere su huella y aún no la tiene cargada. Ingrese a Firmas GSS, cargue su huella en "Mi huella" y vuelva a firmar.';

const MESSAGES: Record<OrionErrorCode, string> = {
  SIGNATURE_NOT_REGISTERED:
    'No tiene una firma registrada en Orion. Dibuje su firma para continuar o regístrela en "Mi firma".',
  FINGERPRINT_NOT_REGISTERED: FINGERPRINT_NOT_REGISTERED_MESSAGE,
  NOT_YOUR_TURN: 'Aún no es su turno para firmar este documento.',
  SIGNER_ALREADY_SIGNED: 'Su firma ya estaba registrada. Se actualizó el estado del documento.',
  DOCUMENT_CLOSED: 'El documento ya está cerrado (firmado, rechazado o devuelto).',
  SIGNER_NOT_FOUND: 'Su correo no figura como firmante de este documento.',
  SIGNED_SIGNER_LOCKED:
    'No se puede quitar ni mover a un firmante que ya firmó. Para corregir el documento cree una subversión nueva.',
};

export function isOrionErrorCode(value: unknown): value is OrionErrorCode {
  return typeof value === 'string' && value in MESSAGES;
}

/** Orion sin código estable: reconoce el "no tiene huella" por el texto del error. */
export function looksLikeFingerprintNotRegistered(message: unknown): boolean {
  const text = String(message || '').toLowerCase();
  if (!/huella|fingerprint/.test(text)) return false;
  if (/consent|autoriz/.test(text)) return false;
  return /no (tiene|hay|est[aá])|not (registered|found|set)|sin huella|missing|registr/.test(text);
}

export function orionErrorMessage(code: unknown, fallback?: string | null): string {
  if (isOrionErrorCode(code)) return MESSAGES[code];
  return String(fallback || '').trim() || 'No se pudo completar la operación en GSS Firma (Orion).';
}
