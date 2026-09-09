import { describe, expect, it } from 'vitest';
import {
  adoptLegacyOrionDocument,
  isOrionSignDocument,
  mergeOrionSignatureState,
  parseOrionSignatureBagBag,
  parseOrionSignatureState,
  resolveOrionDocumentForAttachment,
  resolveOrionSignatureIntent,
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
import {
  isHubHiddenSubprocess,
  isOrionFirmaPrepareSubprocess,
  isOrionFirmaSignSubprocess,
  ORION_FIRMA_MANAGE_URL,
  ORION_FIRMA_PREPARE_URL,
  ORION_FIRMA_SIGN_URL,
} from '../access';

describe('orion access subprocesses', () => {
  it('detecta Preparar (prepare y legacy manage)', () => {
    expect(
      isOrionFirmaPrepareSubprocess({
        subprocess: 'Preparar firma',
        subprocess_url: ORION_FIRMA_PREPARE_URL,
      })
    ).toBe(true);
    expect(
      isOrionFirmaPrepareSubprocess({
        subprocess: 'Firma digital',
        subprocess_url: ORION_FIRMA_MANAGE_URL,
      })
    ).toBe(true);
    expect(
      isOrionFirmaPrepareSubprocess({
        subprocess: 'Otra cosa',
        subprocess_url: '/process/other',
      })
    ).toBe(false);
  });

  it('detecta Firmar documento y no confunde con preparar', () => {
    expect(
      isOrionFirmaSignSubprocess({
        subprocess: 'Firmar documento',
        subprocess_url: ORION_FIRMA_SIGN_URL,
      })
    ).toBe(true);
    expect(
      isOrionFirmaSignSubprocess({
        subprocess: 'Preparar firma',
        subprocess_url: ORION_FIRMA_PREPARE_URL,
      })
    ).toBe(false);
  });

  it('oculta prepare y sign en el hub', () => {
    expect(isHubHiddenSubprocess({ url: ORION_FIRMA_PREPARE_URL, name: 'Preparar firma' })).toBe(
      true
    );
    expect(isHubHiddenSubprocess({ url: ORION_FIRMA_SIGN_URL, name: 'Firmar documento' })).toBe(
      true
    );
    expect(isHubHiddenSubprocess({ url: ORION_FIRMA_MANAGE_URL, name: 'Firma digital' })).toBe(
      true
    );
    expect(isHubHiddenSubprocess({ url: '/process/other', name: 'Otro' })).toBe(false);
  });
});

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

  it('permite el mismo email en varios slots y detecta el siguiente turno', () => {
    const signers = [
      { email: 'a@test.com', order: 1, status: 'FIRMADO' },
      { email: 'b@test.com', order: 2, status: 'FIRMADO' },
      { email: 'a@test.com', order: 3, status: 'PENDIENTE' },
    ];
    expect(getCurrentPendingSigner(signers)?.order).toBe(3);
    expect(getCurrentPendingSigner(signers)?.email).toBe('a@test.com');
  });

  it('detecta firmantes recién completados por slot (mismo email dos veces)', () => {
    const previous = [
      { email: 'a@test.com', order: 1, status: 'FIRMADO' },
      { email: 'a@test.com', order: 2, status: 'PENDIENTE' },
    ];
    const next = [
      { email: 'a@test.com', order: 1, status: 'FIRMADO' },
      { email: 'a@test.com', order: 2, status: 'FIRMADO' },
    ];
    const completed = newlyCompletedSigners(previous, next);
    expect(completed).toHaveLength(1);
    expect(completed[0]?.order).toBe(2);
  });
});

describe('orion signerDeadline', () => {
  it('aplica expiresAt +24h al firmante pendiente', async () => {
    const { applyPendingSignerTurnDeadline, isSignerTurnExpired, ORION_SIGNER_TURN_HOURS } =
      await import('../signerDeadline');
    expect(ORION_SIGNER_TURN_HOURS).toBe(24);
    const now = new Date('2026-09-09T12:00:00.000Z');
    const next = applyPendingSignerTurnDeadline(
      [
        { email: 'a@test.com', order: 1, status: 'FIRMADO' },
        { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
      ],
      now
    );
    expect(next[1]?.expiresAt).toBe('2026-09-10T12:00:00.000Z');
    expect(isSignerTurnExpired(next[1], now)).toBe(false);
    expect(isSignerTurnExpired(next[1], new Date('2026-09-10T12:00:01.000Z'))).toBe(true);
  });
});

describe('orion permissions', () => {
  it('coordinador creador en fase de configuración', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      createdByEmail: 'coord@test.com',
      state: { status: 'BORRADOR', orionDocumentId: 'doc-1', embedUrl: 'https://orion/embed' },
      hasAttachment: true,
    });
    expect(perms.userRole).toBe('coordinator');
    expect(perms.canAssignSigners).toBe(true);
    expect(perms.canPlaceSignatures).toBe(true);
    expect(perms.canAcceptSign).toBe(false);
  });

  it('sin canManage no edita (gestión = permiso Preparar vía API)', () => {
    const perms = resolveOrionPermissions({
      canManage: false,
      currentUserEmail: 'otro@test.com',
      createdByEmail: 'coord@test.com',
      state: { status: 'BORRADOR', orionDocumentId: 'doc-1', embedUrl: 'https://orion/embed' },
      hasAttachment: true,
    });
    expect(perms.canEditAssignments).toBe(false);
    expect(perms.canManageWorkflow).toBe(false);
  });

  it('canManage permite editar aunque el email no coincida (permiso Preparar ya validado en API)', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'admin@test.com',
      createdByEmail: 'coord@test.com',
      state: { status: 'BORRADOR', orionDocumentId: 'doc-1', embedUrl: 'https://orion/embed' },
      hasAttachment: true,
    });
    expect(perms.userRole).toBe('coordinator');
    expect(perms.canManageWorkflow).toBe(true);
  });

  it('creador listado como firmante en BORRADOR sigue siendo coordinador', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      createdByEmail: 'coord@test.com',
      state: {
        status: 'BORRADOR',
        orionDocumentId: 'doc-1',
        embedUrl: 'https://orion/embed',
        signers: [
          { email: 'coord@test.com', order: 1, status: 'PENDIENTE' },
          { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
        ],
      },
      hasAttachment: true,
    });
    expect(perms.userRole).toBe('coordinator');
    expect(perms.canAssignSigners).toBe(true);
    expect(perms.canPlaceSignatures).toBe(true);
    expect(perms.canAcceptSign).toBe(false);
  });

  it('documento DEVUELTO permite al creador gestionar de nuevo si nadie firmó', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      createdByEmail: 'coord@test.com',
      state: {
        status: 'DEVUELTO',
        orionDocumentId: 'doc-1',
        embedUrl: 'https://orion/embed',
        signers: [
          { email: 'a@test.com', order: 1, status: 'PENDIENTE' },
          { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
        ],
      },
      hasAttachment: true,
    });
    expect(perms.userRole).toBe('coordinator');
    expect(perms.canEditAssignments).toBe(true);
    expect(perms.canManageWorkflow).toBe(true);
    expect(perms.canAcceptSign).toBe(false);
    expect(perms.roleLabel).toContain('devuelto');
  });

  it('bloquea edición si ya hay una firma completada', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      createdByEmail: 'coord@test.com',
      state: {
        status: 'EN_PROCESO',
        orionDocumentId: 'doc-1',
        embedUrl: 'https://orion/embed',
        signers: [
          { email: 'a@test.com', order: 1, status: 'FIRMADO' },
          { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
        ],
      },
      workflowLocked: false,
    });
    expect(perms.canEditAssignments).toBe(false);
    expect(perms.canRenewDeadline).toBe(true);
  });

  it('permite editar en EN_PROCESO sin firmas si es el creador', () => {
    const perms = resolveOrionPermissions({
      canManage: true,
      currentUserEmail: 'coord@test.com',
      createdByEmail: 'coord@test.com',
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
      createdByEmail: 'coord@test.com',
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
      createdByEmail: 'coord@test.com',
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

  it('sin canManage no gestiona aunque isAdmin en el cliente', () => {
    const perms = resolveOrionPermissions({
      canManage: false,
      isAdmin: true,
      currentUserEmail: 'admin@test.com',
      createdByEmail: 'admin@test.com',
      state: { status: 'BORRADOR', orionDocumentId: 'doc-1', embedUrl: 'https://orion/embed' },
      hasAttachment: true,
    });
    expect(perms.userRole).toBe('viewer');
    expect(perms.canAssignSigners).toBe(false);
    expect(perms.canManageWorkflow).toBe(false);
  });
});

describe('orion signatureIntent', () => {
  it('infiere sign si hay flujo Orion y view si está vacío', () => {
    expect(resolveOrionSignatureIntent({})).toBe('view');
    expect(resolveOrionSignatureIntent({ signatureIntent: 'sign' })).toBe('sign');
    expect(resolveOrionSignatureIntent({ signatureIntent: 'view' })).toBe('view');
    expect(isOrionSignDocument({ orionDocumentId: 'x', status: 'BORRADOR' })).toBe(true);
    expect(isOrionSignDocument({ signatureIntent: 'view', orionDocumentId: 'x' })).toBe(false);
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

  it('no reutiliza el estado de otro PDF cuando el fileId no coincide', () => {
    const documents = {
      'file-a': {
        orionDocumentId: 'doc-1',
        status: 'EN_PROCESO',
        fileName: 'Documento escaneado-firmado (1).pdf',
        fileId: 'file-a',
        signers: [{ email: 'a@test.com', status: 'PENDIENTE', order: 1 }],
      },
    };
    const resolved = resolveOrionDocumentForAttachment({
      fileId: 'file-b',
      fileName: 'Documento escaneado.pdf',
      documents,
    });
    expect(resolved.orionDocumentId).toBeUndefined();
    expect(resolved.status).toBeUndefined();
    expect(resolved.signers).toBeUndefined();
  });

  it('adopta solo el documento legacy cuando no hay clave por fileId', () => {
    const documents = {
      [ORION_LEGACY_FILE_ID]: {
        orionDocumentId: 'doc-legacy',
        status: 'BORRADOR',
        fileName: 'contrato.pdf',
      },
    };
    const resolved = resolveOrionDocumentForAttachment({
      fileId: 'onedrive-xyz',
      fileName: 'contrato.pdf',
      documents,
    });
    expect(resolved.orionDocumentId).toBe('doc-legacy');
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

  it('ordena original → firmantes por order → final', async () => {
    const { listOrionDocumentVersions } = await import('../documentVersions');
    const ordered = listOrionDocumentVersions({
      signers: [
        { email: 'b@test.com', order: 2 },
        { email: 'a@test.com', order: 1 },
      ],
      versions: [
        {
          id: 'final-1',
          kind: 'final',
          label: 'Final',
          url: 'https://example.com/final.pdf',
          createdAt: '2026-01-04',
        },
        {
          id: 'sign-b',
          kind: 'partial',
          label: 'B',
          url: 'https://example.com/b.pdf',
          createdAt: '2026-01-03',
          signerEmail: 'b@test.com',
        },
        {
          id: 'original',
          kind: 'original',
          label: 'Original',
          url: 'https://example.com/original.pdf',
          createdAt: '2026-01-01',
        },
        {
          id: 'sign-a',
          kind: 'partial',
          label: 'A',
          url: 'https://example.com/a.pdf',
          createdAt: '2026-01-02',
          signerEmail: 'a@test.com',
        },
      ],
    });
    expect(ordered.map((v) => v.id)).toEqual(['original', 'sign-a', 'sign-b', 'final-1']);
  });

  it('firmante solo ve la última versión firmada', async () => {
    const { listOrionDocumentVersionsForViewer } = await import('../documentVersions');
    const state = {
      signers: [
        { email: 'a@test.com', order: 1 },
        { email: 'b@test.com', order: 2 },
      ],
      versions: [
        {
          id: 'original',
          kind: 'original' as const,
          label: 'Original',
          url: 'https://example.com/original.pdf',
          createdAt: '2026-01-01',
        },
        {
          id: 'sign-a',
          kind: 'partial' as const,
          label: 'A',
          url: 'https://example.com/a.pdf',
          createdAt: '2026-01-02',
          signerEmail: 'a@test.com',
        },
        {
          id: 'sign-b',
          kind: 'partial' as const,
          label: 'B',
          url: 'https://example.com/b.pdf',
          createdAt: '2026-01-03',
          signerEmail: 'b@test.com',
        },
      ],
    };
    expect(listOrionDocumentVersionsForViewer(state, { fullHistory: true }).map((v) => v.id)).toEqual([
      'original',
      'sign-a',
      'sign-b',
    ]);
    expect(listOrionDocumentVersionsForViewer(state, { fullHistory: false }).map((v) => v.id)).toEqual([
      'sign-b',
    ]);
  });

  it('rebuildOrionVersionHistory reconstruye original + firmantes en orden', async () => {
    const { rebuildOrionVersionHistory } = await import('../documentVersions');
    const rebuilt = rebuildOrionVersionHistory(
      {
        status: 'EN_PROCESO',
        originalFileUrl: 'https://example.com/original.pdf',
        signedFileUrl: 'https://example.com/signed.pdf',
        signers: [
          {
            email: 'b@test.com',
            name: 'B',
            order: 2,
            status: 'FIRMADO',
            signedAt: '2026-01-03',
          },
          {
            email: 'a@test.com',
            name: 'A',
            order: 1,
            status: 'FIRMADO',
            signedAt: '2026-01-02',
          },
        ],
        versions: [{ id: 'broken', kind: 'partial', label: 'x', url: 'old', createdAt: '2026-01-01' }],
      },
      null,
      null
    );
    expect(rebuilt.versions?.map((v) => v.kind)).toEqual(['original', 'partial', 'final']);
    expect(rebuilt.versions?.[1]?.signerEmail).toBe('a@test.com');
    expect(rebuilt.versions?.[2]?.signerEmail).toBe('b@test.com');
  });

  it('canViewOrionDocumentVersions solo admin o solicitante', async () => {
    const { canViewOrionDocumentVersions } = await import('../documentVersions');
    expect(canViewOrionDocumentVersions({ isAdmin: true, currentUserId: 'a', requesterId: 'b' })).toBe(true);
    expect(canViewOrionDocumentVersions({ isAdmin: false, currentUserId: 'a', requesterId: 'a' })).toBe(true);
    expect(canViewOrionDocumentVersions({ isAdmin: false, currentUserId: 'a', requesterId: 'b' })).toBe(false);
  });
});
