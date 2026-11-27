import { describe, expect, it } from 'vitest';
import { expiryState, kindLabel, licenseTypeLabel, validateSoftwareInput } from '../software';

const valid = {
  companyId: 8,
  kind: 'certificado',
  description: ' SSL *.gsslatam.com ',
  provider: 'Sectigo',
  purchaseDate: '2026-01-15',
  expirationDate: '2027-01-15',
  licenses: '1',
  assignedTo: 'Servidor web',
  cost: '850000.5',
  licenseType: 'anual',
};

describe('validateSoftwareInput', () => {
  it('accepts a full record and normalizes numbers and text', () => {
    const r = validateSoftwareInput(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.description).toBe('SSL *.gsslatam.com');
      expect(r.value.licenses).toBe(1);
      expect(r.value.cost).toBe(850000.5);
    }
  });

  it('only company, kind and description are required', () => {
    const r = validateSoftwareInput({ companyId: 1, kind: 'software', description: 'Office' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.licenses).toBeNull();
  });

  it('rejects missing data, bad dates, numbers and options', () => {
    const r = validateSoftwareInput({
      kind: 'hardware',
      description: '',
      purchaseDate: '2026-02-30',
      expirationDate: 'mañana',
      licenses: '1.5',
      cost: '-3',
      licenseType: 'trimestral',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ['companyId', 'cost', 'description', 'expirationDate', 'kind', 'licenseType', 'licenses', 'purchaseDate'].sort()
      );
    }
  });

  it('expiration cannot be before purchase', () => {
    const r = validateSoftwareInput({ ...valid, expirationDate: '2025-12-31' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.expirationDate).toMatch(/anterior/);
  });
});

describe('expiryState and labels', () => {
  const today = new Date('2026-11-27T15:00:00Z');
  it('expired, soon (30 days), ok, none', () => {
    expect(expiryState('2026-11-26', today)).toBe('expired');
    expect(expiryState('2026-11-27', today)).toBe('soon');
    expect(expiryState('2026-12-27', today)).toBe('soon');
    expect(expiryState('2026-12-28', today)).toBe('ok');
    expect(expiryState('', today)).toBe('none');
  });
  it('labels', () => {
    expect(kindLabel('certificado')).toBe('Certificado');
    expect(licenseTypeLabel('semestral')).toBe('Suscripción semestral');
  });
});
