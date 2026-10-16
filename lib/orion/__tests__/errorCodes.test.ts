import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_NOT_REGISTERED_MESSAGE,
  looksLikeFingerprintNotRegistered,
  orionErrorMessage,
} from '../errorCodes';

describe('huella no registrada', () => {
  it('indica cargar la huella en Firmas GSS', () => {
    expect(orionErrorMessage('FINGERPRINT_NOT_REGISTERED')).toBe(FINGERPRINT_NOT_REGISTERED_MESSAGE);
    expect(FINGERPRINT_NOT_REGISTERED_MESSAGE).toContain('Firmas GSS');
  });

  it('reconoce el error de Orion sin código estable', () => {
    expect(looksLikeFingerprintNotRegistered('El firmante no tiene huella registrada')).toBe(true);
    expect(looksLikeFingerprintNotRegistered('Fingerprint not registered for signer')).toBe(true);
  });

  it('no confunde el consentimiento biométrico ni otros errores', () => {
    expect(looksLikeFingerprintNotRegistered('Falta el consentimiento de huella')).toBe(false);
    expect(looksLikeFingerprintNotRegistered('No es su turno')).toBe(false);
    expect(looksLikeFingerprintNotRegistered(null)).toBe(false);
  });
});
