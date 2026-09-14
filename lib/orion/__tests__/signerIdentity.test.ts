import { describe, expect, it } from 'vitest';
import {
  normalizeSignerIdentity,
  validateSignerIdentity,
  formatSignerIdLabel,
  isCompanyNitDocumentType,
} from '../signerIdentity';

describe('signerIdentity', () => {
  it('valida nombre obligatorio', () => {
    expect(validateSignerIdentity({ fullName: 'Ab', idDocumentType: 'CC', idNumber: '' })).toMatch(
      /nombre/i
    );
    expect(
      validateSignerIdentity({ fullName: 'Ana Pérez', idDocumentType: 'CC', idNumber: '' })
    ).toBeNull();
  });

  it('valida NIT empresa', () => {
    expect(
      validateSignerIdentity({
        fullName: 'Empresa SAS',
        idDocumentType: 'NIT_EMPRESA',
        idNumber: '12',
      })
    ).toMatch(/NIT/i);
    expect(
      validateSignerIdentity({
        fullName: 'Empresa SAS',
        idDocumentType: 'NIT_EMPRESA',
        idNumber: '900.123.456-7',
        jobTitle: 'Gerente',
        companyName: 'Acme',
      })
    ).toBeNull();
  });

  it('normaliza NIT empresa y formatea label', () => {
    expect(isCompanyNitDocumentType('NIT_EMPRESA')).toBe(true);
    const identity = normalizeSignerIdentity({
      fullName: 'Ana',
      idDocumentType: 'NIT_EMPRESA',
      idNumber: '900123456',
      companyName: 'Acme',
      jobTitle: 'CEO',
    });
    expect(identity.companyNit).toBe('900123456');
    expect(formatSignerIdLabel(identity.idDocumentType, identity.idNumber)).toBe('NIT 900123456');
    expect(formatSignerIdLabel('CC', '123456')).toBe('CC 123456');
  });
});
