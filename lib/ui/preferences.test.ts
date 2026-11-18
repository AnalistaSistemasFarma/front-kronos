import { describe, expect, it } from 'vitest';
import { PREF_COMPANY_COLORS, isAllowedPrefKey, normalizePrefValue, widthsKey } from './preferences';

describe('preferencias de interfaz', () => {
  it('solo acepta claves conocidas', () => {
    expect(isAllowedPrefKey(PREF_COMPANY_COLORS)).toBe(true);
    expect(isAllowedPrefKey(widthsKey('mis-solicitudes'))).toBe(true);
    expect(isAllowedPrefKey('cualquier.cosa')).toBe(false);
  });
  it('anchos: números acotados y nombres de columna seguros', () => {
    expect(normalizePrefValue(widthsKey('x'), { asunto: 5000, id: 10, 'mal nombre': 100 })).toBe('{"asunto":1200,"id":60}');
  });
  it('colores: booleano', () => {
    expect(normalizePrefValue(PREF_COMPANY_COLORS, true)).toBe('true');
    expect(normalizePrefValue(PREF_COMPANY_COLORS, 'x')).toBe('false');
  });
});
