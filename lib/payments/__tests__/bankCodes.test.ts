import { describe, it, expect } from 'vitest';
import { resolveBankCode, BANK_CODES } from '../bankCodes';

// Pruebas del resolver de códigos de compensación bancaria (ACH Colombia). No
// hay red ni SAP: es una función pura sobre una tabla estática.

describe('resolveBankCode', () => {
  it('resuelve por código de 3 dígitos exacto', () => {
    expect(resolveBankCode('001')).toBe('001');
    expect(resolveBankCode('007')).toBe('007');
    expect(resolveBankCode('013')).toBe('013');
  });

  it('rellena a 3 dígitos un código numérico corto', () => {
    expect(resolveBankCode('1')).toBe('001');
    expect(resolveBankCode('7')).toBe('007');
    expect(resolveBankCode('13')).toBe('013');
    expect(resolveBankCode('51')).toBe('051');
  });

  it('resuelve por nombre canónico (con y sin tildes, mayúsculas)', () => {
    expect(resolveBankCode('Banco de Bogotá')).toBe('001');
    expect(resolveBankCode('BANCO DE BOGOTA')).toBe('001');
    expect(resolveBankCode('Bancolombia')).toBe('007');
    expect(resolveBankCode('BBVA Colombia')).toBe('013');
    expect(resolveBankCode('Davivienda')).toBe('051');
    expect(resolveBankCode('Banco AV Villas')).toBe('052');
  });

  it('resuelve por alias', () => {
    expect(resolveBankCode('bogota')).toBe('001');
    expect(resolveBankCode('occidente')).toBe('023');
    expect(resolveBankCode('colpatria')).toBe('019');
    expect(resolveBankCode('scotiabank')).toBe('019');
    expect(resolveBankCode('itau')).toBe('006');
    expect(resolveBankCode('caja social')).toBe('032');
    expect(resolveBankCode('agrario')).toBe('040');
  });

  it('ignora la palabra "banco" y variaciones de espaciado al comparar', () => {
    expect(resolveBankCode('banco   popular')).toBe('002');
    expect(resolveBankCode('Popular')).toBe('002');
  });

  it('devuelve null cuando el banco no está en el catálogo', () => {
    expect(resolveBankCode('Banco Inexistente XYZ')).toBeNull();
    expect(resolveBankCode('999')).toBeNull();
    expect(resolveBankCode('12345')).toBeNull(); // más de 3 dígitos
  });

  it('devuelve null para entradas vacías o nulas', () => {
    expect(resolveBankCode('')).toBeNull();
    expect(resolveBankCode('   ')).toBeNull();
    expect(resolveBankCode(null)).toBeNull();
    expect(resolveBankCode(undefined)).toBeNull();
  });

  it('todos los códigos del catálogo tienen exactamente 3 dígitos', () => {
    for (const b of BANK_CODES) {
      expect(b.code).toMatch(/^\d{3}$/);
    }
  });

  it('no hay códigos duplicados en el catálogo', () => {
    const codes = BANK_CODES.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
