import { describe, expect, it } from 'vitest';
import {
  PREF_COMPANY_COLORS,
  PREF_REQUEST_INDICATORS,
  isAllowedPrefKey,
  normalizeIndicatorPrefs,
  normalizePrefValue,
  parsePrefValue,
  widthsKey,
} from './preferences';

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
  it('indicator cards: only known cards, no duplicates, boolean hidden flag', () => {
    expect(isAllowedPrefKey(PREF_REQUEST_INDICATORS)).toBe(true);
    const raw = normalizePrefValue(PREF_REQUEST_INDICATORS, {
      slaHidden: 'yes',
      hiddenCards: ['sla.no_sla', 'sla.no_sla', 'status.done', 'drop table', 42],
      extra: 1,
    });
    expect(raw).toBe('{"slaHidden":false,"hiddenCards":["sla.no_sla","status.done"]}');
    expect(normalizeIndicatorPrefs(parsePrefValue(PREF_REQUEST_INDICATORS, raw!))).toEqual({
      slaHidden: false,
      hiddenCards: ['sla.no_sla', 'status.done'],
    });
    expect(normalizePrefValue(PREF_REQUEST_INDICATORS, [1])).toBeNull();
    expect(normalizeIndicatorPrefs(undefined)).toEqual({ slaHidden: false, hiddenCards: [] });
    expect(normalizeIndicatorPrefs({ slaHidden: true }).slaHidden).toBe(true);
  });
});
