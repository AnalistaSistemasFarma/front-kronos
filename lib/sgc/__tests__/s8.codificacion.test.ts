import { describe, expect, it } from 'vitest';
import {
  SGC_DEFAULT_CHILD_PATTERN,
  buildChildCode,
  buildChildCodeRoot,
  buildDocumentCode,
  codeFollowsGuide,
  inheritsParentNumber,
  nextChildSequence,
  parentNumberOf,
  parseChildSequence,
  parseChildTypeCodes,
  validateChildCoding,
  validateCodingGuide,
  type SgcCodingGuideInput,
} from '../coding';

/**
 * Sprint 8 — guía de codificación de OLP (socialización con Calidad del
 * 2026-10-07): «compañía + área + número» y los formatos e instructivos
 * HEREDAN el número de su procedimiento (OLP-GCC-02 → OLP-GCC-02-FO01).
 */
const OLP: SgcCodingGuideInput = {
  prefix: 'OLP',
  pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}',
  sequenceDigits: 2,
  childPattern: SGC_DEFAULT_CHILD_PATTERN,
  childTypeCodes: ['FO', 'IN'],
  childSequenceDigits: 2,
};
const PR = { processTypeCode: 'M', processCode: 'GCC', documentTypeCode: 'PR' };
const FO = { ...PR, documentTypeCode: 'FO' };
const parent = { code: 'OLP-GCC-02', sequence: 2, parts: PR };

describe('SGC · S8 · codificación con herencia del número del padre', () => {
  it('[SGC-REQ-113] el procedimiento toma «compañía + área + número» y su formato hereda el número: OLP-GCC-02 → OLP-GCC-02-FO01', () => {
    expect(buildDocumentCode(OLP, PR, 2)).toBe('OLP-GCC-02');
    expect(buildChildCodeRoot(OLP, FO, parent)).toBe('OLP-GCC-02-FO');
    expect(buildChildCode(OLP, FO, parent, 1)).toBe('OLP-GCC-02-FO01');
    expect(buildChildCode({ ...OLP, childPattern: '{PREFIJO}-{PROCESO}-{TIPO}-{NUMERO_PADRE}.{CONSECUTIVO}', childSequenceDigits: null }, { ...FO, documentTypeCode: 'IN' }, parent, 3)).toBe('OLP-GCC-IN-02.03');
    expect(() => buildChildCode(OLP, FO, parent, 0)).toThrow('entero positivo');
  });

  it('[SGC-REQ-113] el consecutivo de los hijos es propio de cada padre y sigue desde el mayor existente', () => {
    const existing = ['OLP-GCC-02-FO01', 'OLP-GCC-02-FO07', 'OLP-GCC-02-IN01', 'OLP-GCC-03-FO09', 'OLP-GCC-02-FOX', 'OLP-GCC-02-FO'];
    expect(nextChildSequence(OLP, FO, parent, existing)).toBe(8);
    expect(nextChildSequence(OLP, { ...FO, documentTypeCode: 'IN' }, parent, existing)).toBe(2);
    expect(nextChildSequence(OLP, FO, { code: 'OLP-GCC-05', sequence: 5 }, existing)).toBe(1);
    expect(parseChildSequence(OLP, FO, parent, 'olp-gcc-02-fo12')).toBe(12);
    expect(parseChildSequence(OLP, FO, parent, 'OLP-GCC-02-FO00')).toBeNull();
    // Con texto después del consecutivo.
    const suffix = { ...OLP, childPattern: '{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}-R' };
    expect(parseChildSequence(suffix, FO, parent, 'OLP-GCC-02-FO04-R')).toBe(4);
    expect(parseChildSequence(suffix, FO, parent, 'OLP-GCC-02-FO04')).toBeNull();
  });

  it('[SGC-REQ-113] el número del padre sale de su consecutivo, de su código con la guía o de los dígitos finales (códigos de la carga inicial)', () => {
    expect(parentNumberOf(OLP, { code: 'OLP-GCC-2', sequence: 2 })).toBe('02');
    expect(parentNumberOf(OLP, { code: 'OLP-GCC-07', parts: PR })).toBe('07');
    expect(parentNumberOf(OLP, { code: 'GCC-PR-0012', parts: PR })).toBe('0012');
    expect(parentNumberOf(OLP, { code: 'MANUAL-CALIDAD' })).toBeNull();
    expect(() => buildChildCode({ ...OLP, childPattern: '{PREFIJO}-{NUMERO_PADRE}-{TIPO}{CONSECUTIVO}' }, FO, { code: 'MANUAL-CALIDAD' }, 1)).toThrow('no termina en un número');
    expect(() => buildChildCodeRoot({ ...OLP, childPattern: null }, FO, parent)).toThrow('patrón de herencia');
  });

  it('[SGC-REQ-113] solo heredan los tipos configurados; sin patrón de herencia la guía funciona como antes', () => {
    expect(inheritsParentNumber(OLP, 'fo')).toBe(true);
    expect(inheritsParentNumber(OLP, 'PR')).toBe(false);
    expect(inheritsParentNumber({ ...OLP, childPattern: '  ' }, 'FO')).toBe(false);
    expect(inheritsParentNumber({ ...OLP, childTypeCodes: null }, 'FO')).toBe(false);
    expect(parseChildTypeCodes('fo, in;FO  ma')).toEqual(['FO', 'IN', 'MA']);
    expect(parseChildTypeCodes(['in', ' ', 'IN'])).toEqual(['IN']);
    expect(parseChildTypeCodes(null)).toEqual([]);
  });

  it('[SGC-REQ-113] ¿el código sigue la guía? (aviso de la carga del listado maestro)', () => {
    expect(codeFollowsGuide(OLP, PR, 'OLP-GCC-02')).toBe(true);
    expect(codeFollowsGuide(OLP, PR, 'GCC-PR-02')).toBe(false);
    expect(codeFollowsGuide(OLP, FO, 'OLP-GCC-02-FO01', parent)).toBe(true);
    expect(codeFollowsGuide(OLP, FO, 'OLP-GCC-02-F-1', parent)).toBe(false);
    // Sin padre conocido se compara con la guía principal.
    expect(codeFollowsGuide(OLP, FO, 'OLP-GCC-11')).toBe(true);
    // Padre sin número: no se puede heredar → no sigue la guía.
    expect(codeFollowsGuide(OLP, FO, 'MANUAL-FO01', { code: 'MANUAL' })).toBe(false);
  });

  it('[SGC-REQ-113] la herencia se valida con la guía: marcas, consecutivo, padre, tipos y dígitos', () => {
    expect(validateChildCoding({ childPattern: null })).toEqual([]);
    expect(validateCodingGuide(OLP)).toEqual([]);
    const errors = validateChildCoding({ childPattern: '{PADRE}-{TIPO}*', childTypeCodes: [], childSequenceDigits: 9 });
    expect(errors).toEqual([
      'Herencia: marcas desconocidas {PADRE}.',
      'Herencia: el patrón debe tener exactamente una marca {CONSECUTIVO}.',
      'Herencia: el patrón debe usar {CODIGO_PADRE} o {NUMERO_PADRE}.',
      'Herencia: fuera de las marcas, el patrón solo admite letras, números, punto, guion y guion bajo.',
      'Herencia: indique qué tipos documentales heredan el número (por ejemplo FO, IN).',
      'Herencia: los dígitos del consecutivo deben estar entre 1 y 6.',
    ]);
    expect(validateChildCoding({ childPattern: '{CODIGO_PADRE}{CONSECUTIVO}', childTypeCodes: ['FO-1'] })).toEqual(['Herencia, tipo «FO-1»: El código solo admite mayúsculas y números (máximo 10).']);
    expect(validateCodingGuide({ ...OLP, childPattern: '{CODIGO_PADRE}' })).toContain('Herencia: el patrón debe tener exactamente una marca {CONSECUTIVO}.');
  });
});
