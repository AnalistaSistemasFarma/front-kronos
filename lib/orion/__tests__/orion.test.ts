import { describe, expect, it } from 'vitest';
import {
  adoptLegacyOrionDocument,
  mergeOrionSignatureState,
  parseOrionSignatureBagBag,
  parseOrionSignatureState,
  resolveOrionDocumentForAttachment,
  serializeOrionSignatureBagBag,
  serializeOrionSignatureState,
} from '../formValue';
import {
  ORION_LEGACY_FILE_ID,
  buildOrionExternalRef,
  parseFileIdFromExternalRef,
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

  it('respeta el orden del array cuando falta order en Orion', () => {
    const signers = [
      { email: 'juan@test.com', status: 'PENDIENTE' },
      { email: 'nicolas@test.com', status: 'PENDIENTE' },
    ];
    expect(getCurrentPendingSigner(signers)?.email).toBe('juan@test.com');
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

  it('permite editar asignación durante firma si la tarea sigue abierta', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      state: {
        status: 'EN_PROCESO',
        orionDocumentId: 'doc-1',
        embedUrl: 'https://orion/embed',
        signers: [{ email: 'a@test.com', order: 1, status: 'PENDIENTE' }],
      },
      workflowLocked: false,
    });
    expect(perms.canEditAssignments).toBe(true);
    expect(perms.userRole).toBe('coordinator');
  });

  it('bloquea edición cuando tarea o solicitud cerrada', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      state: {
        status: 'EN_PROCESO',
        orionDocumentId: 'doc-1',
        embedUrl: 'https://orion/embed',
      },
      workflowLocked: true,
    });
    expect(perms.canEditAssignments).toBe(false);
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
  it('parsea y serializa bag documents', () => {
    const raw = serializeOrionSignatureBagBag({
      documents: {
        fileA: { orionDocumentId: 'abc', status: 'EN_PROCESO', fileId: 'fileA' },
      },
    });
    const bag = parseOrionSignatureBagBag(raw);
    expect(bag.documents.fileA?.orionDocumentId).toBe('abc');
    expect(bag.documents.fileA?.status).toBe('EN_PROCESO');
    expect(bag.updatedAt).toBeTruthy();
  });

  it('migra JSON legacy plano a documents[_legacy]', () => {
    const raw = JSON.stringify({
      orionDocumentId: 'legacy-doc',
      status: 'BORRADOR',
      externalRef: 'synerlink://request/10',
    });
    const bag = parseOrionSignatureBagBag(raw);
    expect(bag.documents[ORION_LEGACY_FILE_ID]?.orionDocumentId).toBe('legacy-doc');
    expect(parseOrionSignatureState(raw).orionDocumentId).toBe('legacy-doc');
  });

  it('adopta legacy a un fileId real', () => {
    const bag = parseOrionSignatureBagBag(
      JSON.stringify({ orionDocumentId: 'x', status: 'BORRADOR' })
    );
    const next = adoptLegacyOrionDocument(bag, 'onedrive-1', 'contrato.pdf');
    expect(next.documents[ORION_LEGACY_FILE_ID]).toBeUndefined();
    expect(next.documents['onedrive-1']?.orionDocumentId).toBe('x');
    expect(next.documents['onedrive-1']?.fileName).toBe('contrato.pdf');
  });

  it('resuelve adjunto por nombre o documento único si el fileId no coincide', () => {
    const documents = {
      'other-id': {
        orionDocumentId: 'doc-1',
        status: 'EN_PROCESO',
        fileName: 'Documento escaneado 6.pdf',
        signers: [{ email: 'a@test.com', status: 'PENDIENTE', order: 1 }],
      },
    };
    const resolved = resolveOrionDocumentForAttachment({
      fileId: 'onedrive-xyz',
      fileName: 'Documento escaneado 6.pdf',
      documents,
    });
    expect(resolved.orionDocumentId).toBe('doc-1');
    expect(resolved.signers?.[0]?.email).toBe('a@test.com');
  });

  it('merge no degrada firmante FIRMADO a PENDIENTE', () => {
    const merged = mergeOrionSignatureState(
      {
        signers: [{ email: 'a@test.com', order: 1, status: 'FIRMADO', signedAt: '2026-01-01' }],
      },
      {
        status: 'EN_PROCESO',
        signers: [{ email: 'a@test.com', order: 1, status: 'PENDIENTE' }],
      }
    );
    expect(merged.signers?.[0]?.status).toBe('FIRMADO');
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

  it('serializeOrionSignatureState escribe bag de un documento', () => {
    const raw = serializeOrionSignatureState({
      orionDocumentId: 'abc',
      status: 'EN_PROCESO',
      fileId: 'f1',
    });
    const bag = parseOrionSignatureBagBag(raw);
    expect(bag.documents.f1?.orionDocumentId).toBe('abc');
  });
});

describe('orion config', () => {
  it('construye y parsea externalRef por archivo', () => {
    expect(buildOrionExternalRef(456)).toBe('synerlink://request/456');
    expect(buildOrionExternalRef(456, 'abc-file')).toBe('synerlink://request/456/file/abc-file');
    expect(parseRequestIdFromExternalRef('synerlink://request/456')).toBe(456);
    expect(parseRequestIdFromExternalRef('synerlink://request/456/file/abc-file')).toBe(456);
    expect(parseFileIdFromExternalRef('synerlink://request/456/file/abc-file')).toBe('abc-file');
    expect(parseFileIdFromExternalRef('synerlink://request/456')).toBeNull();
    expect(parseRequestIdFromExternalRef('invalid')).toBeNull();
  });

  it('resuelve tenant desde ORION_TENANT_MAP', () => {
    const prev = process.env.ORION_TENANT_MAP;
    process.env.ORION_TENANT_MAP = '{"7":"farmaceutica-abc"}';
    expect(resolveOrionTenantId(7)).toBe('farmaceutica-abc');
    process.env.ORION_TENANT_MAP = prev;
  });
});

describe('documentVersions', () => {
  it('resolveOrionPdfUrl prefiere la última versión firmada', async () => {
    const { resolveOrionPdfUrl } = await import('../documentVersions');
    const url = resolveOrionPdfUrl(
      {
        originalFileUrl: 'https://example.com/original.pdf',
        signedFileUrl: 'https://example.com/final.pdf',
        versions: [
          { id: 'original', kind: 'original', label: 'Original', url: 'https://example.com/original.pdf', createdAt: '2026-01-01' },
          { id: 'v1', kind: 'partial', label: 'Parcial', url: 'https://example.com/partial.pdf', createdAt: '2026-01-02' },
        ],
      },
      'https://example.com/fallback.pdf'
    );
    expect(url).toBe('https://example.com/partial.pdf');
  });

  it('canViewOrionDocumentVersions solo admin o solicitante', async () => {
    const { canViewOrionDocumentVersions } = await import('../documentVersions');
    expect(canViewOrionDocumentVersions({ isAdmin: true, currentUserId: 'a', requesterId: 'b' })).toBe(true);
    expect(canViewOrionDocumentVersions({ isAdmin: false, currentUserId: 'a', requesterId: 'a' })).toBe(true);
    expect(canViewOrionDocumentVersions({ isAdmin: false, currentUserId: 'a', requesterId: 'b' })).toBe(false);
  });
});
