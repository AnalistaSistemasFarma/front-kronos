import { describe, expect, it } from 'vitest';
import { cameraStatusLabel, isDvrType, summarizeCameras, validateCameraInput } from '../cameras';

describe('cameras', () => {
  it('detects DVR / NVR types only', () => {
    expect(isDvrType('DVR')).toBe(true);
    expect(isDvrType('nvr')).toBe(true);
    expect(isDvrType('SERVIDOR')).toBe(false);
    expect(isDvrType(null)).toBe(false);
  });

  it('validates name and status; trims text', () => {
    const ok = validateCameraInput({ name: ' Cám 01 ', location: 'Entrada', brand: 'Hikvision', status: 'en_falla' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.name).toBe('Cám 01');

    const bad = validateCameraInput({ name: '', status: 'rota', brand: 'x'.repeat(61) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['brand', 'name', 'status']);
  });

  it('labels and summary', () => {
    expect(cameraStatusLabel('danado')).toBe('Dañado');
    expect(summarizeCameras([{ status: 'funcional' }, { status: 'funcional' }, { status: 'danado' }])).toEqual({
      funcional: 2,
      en_falla: 0,
      danado: 1,
    });
  });
});
