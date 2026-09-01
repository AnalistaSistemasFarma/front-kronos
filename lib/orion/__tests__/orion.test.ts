import { describe, expect, it } from 'vitest';
import {
  mergeOrionSignatureState,
  parseOrionSignatureState,
  serializeOrionSignatureState,
} from '../formValue';
import {
  buildOrionExternalRef,
  parseRequestIdFromExternalRef,
  resolveOrionTenantId,
} from '../config';

describe('orion formValue', () => {
  it('parsea y serializa estado JSON', () => {
    const raw = serializeOrionSignatureState({
      orionDocumentId: 'abc',
      status: 'EN_PROCESO',
    });
    const parsed = parseOrionSignatureState(raw);
    expect(parsed.orionDocumentId).toBe('abc');
    expect(parsed.status).toBe('EN_PROCESO');
    expect(parsed.updatedAt).toBeTruthy();
  });

  it('merge conserva campos previos', () => {
    const merged = mergeOrionSignatureState(
      { orionDocumentId: 'x', status: 'BORRADOR' },
      { status: 'FIRMADO', signedFileUrl: 'https://example.com/doc.pdf' }
    );
    expect(merged.orionDocumentId).toBe('x');
    expect(merged.status).toBe('FIRMADO');
    expect(merged.signedFileUrl).toContain('doc.pdf');
  });
});

describe('orion config', () => {
  it('construye y parsea externalRef', () => {
    expect(buildOrionExternalRef(456)).toBe('synerlink://request/456');
    expect(parseRequestIdFromExternalRef('synerlink://request/456')).toBe(456);
    expect(parseRequestIdFromExternalRef('invalid')).toBeNull();
  });

  it('resuelve tenant desde ORION_TENANT_MAP', () => {
    const prev = process.env.ORION_TENANT_MAP;
    process.env.ORION_TENANT_MAP = '{"7":"farmaceutica-abc"}';
    expect(resolveOrionTenantId(7)).toBe('farmaceutica-abc');
    process.env.ORION_TENANT_MAP = prev;
  });
});
