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
import {
  allSignersCompleted,
  getCurrentPendingSigner,
  newlyCompletedSigners,
} from '../signerStatus';
import { resolveOrionPermissions } from '../permissions';

describe('orion signerStatus', () => {
  it('detecta firmante pendiente en orden secuencial', () => {
    const signers = [
      { email: 'a@test.com', order: 1, status: 'FIRMADO' },
      { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
    ];
    expect(getCurrentPendingSigner(signers)?.email).toBe('b@test.com');
    expect(allSignersCompleted(signers)).toBe(false);
  });

  it('detecta firmantes recién completados', () => {
    const previous = [{ email: 'a@test.com', order: 1, status: 'PENDIENTE' }];
    const next = [{ email: 'a@test.com', order: 1, status: 'FIRMADO' }];
    expect(newlyCompletedSigners(previous, next)).toHaveLength(1);
  });
});

describe('orion permissions', () => {
  it('coordinador en fase de configuración', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      state: { status: 'BORRADOR', orionDocumentId: 'doc-1', embedUrl: 'https://orion/embed' },
      hasAttachment: true,
    });
    expect(perms.userRole).toBe('coordinator');
    expect(perms.canAssignSigners).toBe(true);
    expect(perms.canPlaceSignatures).toBe(true);
    expect(perms.canAcceptSign).toBe(false);
  });

  it('firmante en turno durante fase de firma', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'b@test.com',
      hasPersonalSignature: true,
      state: {
        status: 'EN_PROCESO',
        orionDocumentId: 'doc-1',
        embedUrl: 'https://orion/embed',
        signers: [
          { email: 'a@test.com', order: 1, status: 'FIRMADO' },
          { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
        ],
      },
    });
    expect(perms.userRole).toBe('signer');
    expect(perms.canManageWorkflow).toBe(false);
    expect(perms.canAcceptSign).toBe(true);
    expect(perms.canPlaceSignatures).toBe(false);
  });

  it('firmante en espera no puede aceptar', () => {
    const perms = resolveOrionPermissions({
      canManage: false,
      currentUserEmail: 'b@test.com',
      state: {
        status: 'EN_PROCESO',
        orionDocumentId: 'doc-1',
        embedUrl: 'https://orion/embed',
        signers: [
          { email: 'a@test.com', order: 1, status: 'PENDIENTE' },
          { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
        ],
      },
    });
    expect(perms.userRole).toBe('waiting');
    expect(perms.canAcceptSign).toBe(false);
    expect(perms.canDrawSignature).toBe(false);
  });
});

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
