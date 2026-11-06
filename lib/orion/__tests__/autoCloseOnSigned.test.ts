import { describe, expect, it } from 'vitest';
import { isSignatureTaskName } from '../autoCloseOnSigned';

describe('isSignatureTaskName', () => {
  it('reconoce las tareas de firma', () => {
    expect(isSignatureTaskName('Firmar documento')).toBe(true);
    expect(isSignatureTaskName('Firma del contrato')).toBe(true);
    expect(isSignatureTaskName('Recolección de firmas')).toBe(true);
    expect(isSignatureTaskName('Enviar a FIRMA')).toBe(true);
  });

  it('no confunde pasos normales del proceso que contienen "firma" dentro de otra palabra', () => {
    expect(isSignatureTaskName('Confirmar recepción')).toBe(false);
    expect(isSignatureTaskName('Confirmación de pago')).toBe(false);
    expect(isSignatureTaskName('Revisión jurídica')).toBe(false);
    expect(isSignatureTaskName(null)).toBe(false);
  });
});
