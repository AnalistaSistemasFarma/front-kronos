import { describe, expect, it } from 'vitest';
import { isComputerType, maintenanceKindLabel, validateMaintenanceInput } from '../maintenance';

describe('maintenance', () => {
  it('detects computers only', () => {
    expect(isComputerType('COMPUTADORES')).toBe(true);
    expect(isComputerType('Portátil')).toBe(true);
    expect(isComputerType('IMPRESORAS')).toBe(false);
    expect(isComputerType(null)).toBe(false);
  });

  it('requires a valid date and kind; note is optional', () => {
    const ok = validateMaintenanceInput({ date: '2026-11-27', kind: 'preventivo' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.notes).toBe('');

    const bad = validateMaintenanceInput({ date: '2026-02-30', kind: 'predictivo', notes: 'x'.repeat(501) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['date', 'kind', 'notes']);

    expect(validateMaintenanceInput({ kind: 'correctivo' }).ok).toBe(false);
  });

  it('labels', () => {
    expect(maintenanceKindLabel('correctivo')).toBe('Correctivo');
  });
});
