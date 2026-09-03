import { describe, it, expect } from 'vitest';
import { parseDocumentIdParam } from '../validateDocumentId';

// Bug de producción (2026-09-03): un `id` no numérico en la URL de
// /process/document-management/[id] dejaba la pantalla cargando
// indefinidamente. Este guard es lo que ahora produce el estado de error en
// vez de quedarse en el loader.

describe('parseDocumentIdParam', () => {
  it('parsea un id numérico válido', () => {
    expect(parseDocumentIdParam('42')).toBe(42);
    expect(parseDocumentIdParam('1')).toBe(1);
  });

  it('devuelve null para un id no numérico (bug real, "abc")', () => {
    expect(parseDocumentIdParam('abc')).toBeNull();
    expect(parseDocumentIdParam('12abc')).toBeNull();
    expect(parseDocumentIdParam('undefined')).toBeNull();
  });

  it('devuelve null para undefined/null/vacío', () => {
    expect(parseDocumentIdParam(undefined)).toBeNull();
    expect(parseDocumentIdParam(null)).toBeNull();
    expect(parseDocumentIdParam('')).toBeNull();
  });

  it('devuelve null para "0" (mismo criterio que el guard original: falsy)', () => {
    expect(parseDocumentIdParam('0')).toBeNull();
  });

  it('acepta ids con espacios alrededor (Number los tolera)', () => {
    expect(parseDocumentIdParam(' 7 ')).toBe(7);
  });

  it('devuelve null para decimales con formato inválido tipo "NaN" literal', () => {
    expect(parseDocumentIdParam('NaN')).toBeNull();
  });
});
