import { describe, expect, it } from 'vitest';
import { protocoloNabucoPermitido } from '../nabucoClient';

describe('protocoloNabucoPermitido', () => {
  it('acepta https siempre', () => {
    expect(protocoloNabucoPermitido(new URL('https://nabucoapi.azurewebsites.net'), {})).toBe(true);
  });
  it('rechaza http sin NABUCO_PERMITIR_HTTP', () => {
    expect(protocoloNabucoPermitido(new URL('http://40.88.126.40:90'), {})).toBe(false);
  });
  it('acepta http solo con NABUCO_PERMITIR_HTTP=1', () => {
    expect(protocoloNabucoPermitido(new URL('http://40.88.126.40:90'), { NABUCO_PERMITIR_HTTP: '1' })).toBe(true);
    expect(protocoloNabucoPermitido(new URL('http://40.88.126.40:90'), { NABUCO_PERMITIR_HTTP: 'true' })).toBe(false);
  });
  it('rechaza otros protocolos', () => {
    expect(protocoloNabucoPermitido(new URL('ftp://x.com'), { NABUCO_PERMITIR_HTTP: '1' })).toBe(false);
  });
});
