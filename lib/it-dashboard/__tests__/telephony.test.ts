import { describe, expect, it } from 'vitest';
import { telephonyServiceLabel, validateTelephonyInput } from '../telephony';

describe('validateTelephonyInput', () => {
  it('accepts empty and a full record', () => {
    expect(validateTelephonyInput({}).ok).toBe(true);
    const r = validateTelephonyInput({
      provider: ' Claro ',
      serviceType: 'ip',
      mainNumber: '+57 (601) 742-0000 ext 10',
      lines: '10',
      extensions: 40,
      plan: 'Troncal SIP 10 canales',
      monthlyCost: '850000',
      contractNumber: 'C-123',
      supportContact: '#776',
      notes: '',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.provider).toBe('Claro');
      expect(r.value.lines).toBe(10);
      expect(r.value.monthlyCost).toBe(850000);
    }
  });

  it('rejects bad service, number, counts and cost', () => {
    const r = validateTelephonyInput({ serviceType: 'radio', mainNumber: 'abc', lines: '1.5', extensions: -1, monthlyCost: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['extensions', 'lines', 'mainNumber', 'monthlyCost', 'serviceType']);
  });

  it('labels', () => {
    expect(telephonyServiceLabel('celular')).toBe('Plan celular');
    expect(telephonyServiceLabel('')).toBe('');
  });
});
