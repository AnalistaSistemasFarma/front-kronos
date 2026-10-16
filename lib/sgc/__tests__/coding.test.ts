import { describe, expect, it } from 'vitest';
import {
  SGC_DEFAULT_CODING_PATTERN,
  buildCodeRoot,
  buildDocumentCode,
  formatDocumentLabel,
  getDocumentCodeError,
  getMasterCodeError,
  nextSequence,
  normalizeDocumentCode,
  parseSequenceFromCode,
  validateCodingGuide,
} from '../coding';

const OLP = { prefix: 'OLP', pattern: SGC_DEFAULT_CODING_PATTERN, sequenceDigits: 3 };
const GC_PR = { processTypeCode: 'M', processCode: 'GC', documentTypeCode: 'PR' };

describe('SGC · guía de codificación', () => {
  it('[SGC-REQ-013] arma el código estilo Farmalógica con el prefijo OLP', () => {
    expect(buildDocumentCode(OLP, GC_PR, 1)).toBe('OLP-GC-PR-001');
    expect(buildDocumentCode(OLP, GC_PR, 27)).toBe('OLP-GC-PR-027');
    expect(buildDocumentCode(OLP, GC_PR, 1234)).toBe('OLP-GC-PR-1234');
  });

  it('[SGC-REQ-013] admite patrones configurables por empresa (tipo de proceso, otros separadores, dígitos)', () => {
    const g = { prefix: 'FAR', pattern: '{TIPO_PROCESO}{PROCESO}-{TIPO}.{CONSECUTIVO}', sequenceDigits: 2 };
    expect(buildDocumentCode(g, GC_PR, 5)).toBe('MGC-PR.05');
    expect(buildCodeRoot(g, GC_PR)).toBe('MGC-PR.');
  });

  it('[SGC-REQ-013] la raíz del consecutivo es lo que va antes de {CONSECUTIVO}', () => {
    expect(buildCodeRoot(OLP, GC_PR)).toBe('OLP-GC-PR-');
  });

  it('[SGC-REQ-013] rechaza consecutivos no positivos', () => {
    expect(() => buildDocumentCode(OLP, GC_PR, 0)).toThrow();
    expect(() => buildDocumentCode(OLP, GC_PR, 1.5)).toThrow();
  });

  it('[SGC-REQ-013] lee el consecutivo de un código que sigue el patrón (sin importar mayúsculas)', () => {
    expect(parseSequenceFromCode(OLP, GC_PR, 'OLP-GC-PR-007')).toBe(7);
    expect(parseSequenceFromCode(OLP, GC_PR, 'olp-gc-pr-012')).toBe(12);
    expect(parseSequenceFromCode(OLP, GC_PR, 'OLP-GC-IN-007')).toBeNull();
    expect(parseSequenceFromCode(OLP, GC_PR, 'OLP-GC-PR-ABC')).toBeNull();
    expect(parseSequenceFromCode(OLP, GC_PR, 'OLP-GC-PR-000')).toBeNull();
  });

  it('[SGC-REQ-013] con sufijo después del consecutivo también lo reconoce', () => {
    const g = { prefix: 'OLP', pattern: '{PREFIJO}-{CONSECUTIVO}-{TIPO}', sequenceDigits: 3 };
    expect(parseSequenceFromCode(g, GC_PR, 'OLP-004-PR')).toBe(4);
    expect(parseSequenceFromCode(g, GC_PR, 'OLP-004-IN')).toBeNull();
  });

  it('[SGC-REQ-013] el siguiente consecutivo continúa la serie, incluidos los códigos cargados a mano', () => {
    expect(nextSequence(OLP, GC_PR, [])).toBe(1);
    expect(nextSequence(OLP, GC_PR, ['OLP-GC-PR-001', 'OLP-GC-PR-009', 'OLP-GC-IN-050', 'OTRO'])).toBe(10);
  });

  it('[SGC-REQ-013] valida la guía: prefijo, marcas conocidas, un solo {CONSECUTIVO}, caracteres y dígitos', () => {
    expect(validateCodingGuide(OLP)).toEqual([]);
    expect(validateCodingGuide({ prefix: '', pattern: '', sequenceDigits: 0 })).toHaveLength(3);
    expect(validateCodingGuide({ prefix: 'OLP', pattern: '{PREFIJO}-{AREA}-{CONSECUTIVO}', sequenceDigits: 3 })[0]).toContain('{AREA}');
    expect(validateCodingGuide({ prefix: 'OLP', pattern: '{PREFIJO}-{TIPO}', sequenceDigits: 3 })[0]).toContain('CONSECUTIVO');
    expect(validateCodingGuide({ prefix: 'OLP', pattern: '{CONSECUTIVO}{CONSECUTIVO}', sequenceDigits: 3 })[0]).toContain('exactamente una');
    expect(validateCodingGuide({ prefix: 'OLP', pattern: '{PREFIJO}/{CONSECUTIVO}', sequenceDigits: 3 })[0]).toContain('solo admite');
    expect(validateCodingGuide({ prefix: 'OLP', pattern: '{CONSECUTIVO}', sequenceDigits: 7 })[0]).toContain('dígitos');
  });

  it('[SGC-REQ-013] los códigos de maestros son cortos, en mayúsculas y no reservados', () => {
    expect(getMasterCodeError('GC')).toBeNull();
    expect(getMasterCodeError('')).toContain('obligatorio');
    expect(getMasterCodeError('gc')).toContain('mayúsculas');
    expect(getMasterCodeError('CON')).toContain('reservado');
  });

  it('[SGC-REQ-013] valida y normaliza el código del documento (es nombre de carpeta en OneDrive)', () => {
    expect(getDocumentCodeError('OLP-GC-PR-001')).toBeNull();
    expect(getDocumentCodeError(' ')).toContain('obligatorio');
    expect(getDocumentCodeError('OLP/GC')).toContain('solo admite');
    expect(getDocumentCodeError('NUL')).toContain('reservado');
    expect(normalizeDocumentCode('  olp-gc-pr-001 ')).toBe('OLP-GC-PR-001');
  });

  it('[SGC-REQ-015] la etiqueta visible siempre lleva código, versión y título', () => {
    expect(formatDocumentLabel('GT-MA-007', 3, 'Manual de Tecnovigilancia')).toBe('GT-MA-007 · V3 · Manual de Tecnovigilancia');
    expect(formatDocumentLabel('X', null, 'Y')).toBe('X · sin versión · Y');
  });
});
