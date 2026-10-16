import { describe, expect, it } from 'vitest';
import { isSgcConfidentiality, isSgcDocumentStatus, SGC_DOCUMENT_STATUS_LABELS } from '../constants';
import { SgcError, isSgcError, isUniqueViolation } from '../errors';

describe('SGC · estados y confidencialidad', () => {
  it('[SGC-REQ-022] los estados del documento son borrador, vigente, obsoleto y anulado (no hay "eliminado")', () => {
    expect(Object.keys(SGC_DOCUMENT_STATUS_LABELS)).toEqual(['borrador', 'vigente', 'obsoleto', 'anulado', 'pendiente_archivo']);
    expect(isSgcDocumentStatus('vigente')).toBe(true);
    expect(isSgcDocumentStatus('eliminado')).toBe(false);
    expect(isSgcDocumentStatus(3)).toBe(false);
  });

  it('[SGC-REQ-018] los niveles de confidencialidad son pública interna, por departamento y confidencial', () => {
    expect(isSgcConfidentiality('publica')).toBe(true);
    expect(isSgcConfidentiality('departamento')).toBe(true);
    expect(isSgcConfidentiality('confidencial')).toBe(true);
    expect(isSgcConfidentiality('secreta')).toBe(false);
  });

  it('[SGC-REQ-019] los errores de negocio llevan su código HTTP; los de clave única se reconocen', () => {
    const e = new SgcError('No', 409);
    expect(isSgcError(e)).toBe(true);
    expect(e.status).toBe(409);
    expect(new SgcError('x').status).toBe(400);
    expect(isSgcError(new Error('x'))).toBe(false);
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
