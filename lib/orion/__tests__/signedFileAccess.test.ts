import { describe, expect, it } from 'vitest';
import {
  buildOrionSignedFileApiUrl,
  isOrionIntegrationOrigin,
  resolveOrionAbsoluteUrl,
} from '../client';
import {
  buildOrionSignedFileProxyUrl,
  isAllowedServerPdfFetchUrl,
  isHostOrSubdomain,
  isOrionProtectedFileUrl,
  orionDocumentHasSignedCopy,
  resolveOrionPdfAccessUrl,
  resolveOrionVersionAccessUrl,
} from '../signedFileAccess';
import type { OrionSignatureState } from '../types';

function withOrionBase<T>(base: string, fn: () => T): T {
  const prev = process.env.ORION_API_BASE_URL;
  process.env.ORION_API_BASE_URL = base;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ORION_API_BASE_URL;
    else process.env.ORION_API_BASE_URL = prev;
  }
}

describe('orion client url helpers', () => {
  it('resolves relative Orion paths with api base from env', () => {
    withOrionBase('http://localhost:3000', () => {
      expect(
        resolveOrionAbsoluteUrl('/api/integrations/synerlink/documents/abc/signed-file')
      ).toBe('http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file');
    });
  });

  it('does not resolve absolute URLs outside ORION_API_BASE_URL', () => {
    withOrionBase('http://localhost:3000', () => {
      expect(resolveOrionAbsoluteUrl('https://evilmicrosoft.com/steal')).toBeNull();
      expect(
        resolveOrionAbsoluteUrl(
          'http://localhost:3000.attacker.com/api/integrations/synerlink/documents/abc/signed-file'
        )
      ).toBeNull();
      expect(
        isOrionIntegrationOrigin(
          'http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file'
        )
      ).toBe(true);
      expect(isOrionIntegrationOrigin('https://webhook.site/abc')).toBe(false);
    });
  });

  it('builds canonical signed-file API url', () => {
    withOrionBase('http://localhost:3000', () => {
      expect(buildOrionSignedFileApiUrl('doc-1')).toBe(
        'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file'
      );
    });
  });
});

describe('signedFileAccess', () => {
  it('detects Orion protected file URLs', () => {
    withOrionBase('http://localhost:3000', () => {
      expect(
        isOrionProtectedFileUrl(
          'http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file'
        )
      ).toBe(true);
      expect(
        isOrionProtectedFileUrl(
          'https://evil.com/api/integrations/synerlink/documents/abc/signed-file'
        )
      ).toBe(false);
      expect(isOrionProtectedFileUrl('https://onedrive.example.com/file.pdf')).toBe(false);
    });
  });

  it('rejects suffix-bypass hosts and metadata for server PDF fetch', () => {
    expect(isHostOrSubdomain('evilmicrosoft.com', 'microsoft.com')).toBe(false);
    expect(isHostOrSubdomain('graph.microsoft.com', 'microsoft.com')).toBe(true);
    expect(isAllowedServerPdfFetchUrl('http://127.0.0.1/secret.pdf')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('http://192.168.1.10/file.pdf')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('https://evilmicrosoft.com/file.pdf')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('https://attacker-sharepoint.com/file.pdf')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('https://webhook.site/abc')).toBe(false);
    expect(
      isAllowedServerPdfFetchUrl(
        'https://evil.com/api/integrations/synerlink/documents/abc/signed-file'
      )
    ).toBe(false);
    expect(
      isAllowedServerPdfFetchUrl(
        'https://contoso.sharepoint.com/sites/x/_layouts/15/download.aspx?UniqueId=abc'
      )
    ).toBe(true);
    expect(isAllowedServerPdfFetchUrl('https://graph.microsoft.com/v1.0/me/drive/items/x')).toBe(
      true
    );
    withOrionBase('http://localhost:3000', () => {
      expect(
        isAllowedServerPdfFetchUrl(
          'http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file'
        )
      ).toBe(true);
    });
  });

  it('builds proxy URL with requestId and fileId', () => {
    expect(buildOrionSignedFileProxyUrl({ requestId: 1, fileId: 'file-2' })).toBe(
      '/api/integrations/orion/signed-file?requestId=1&fileId=file-2'
    );
  });

  it('uses proxy for Orion signedFileUrl', () => {
    const doc: OrionSignatureState = {
      orionDocumentId: 'doc-1',
      status: 'EN_PROCESO',
      signedFileUrl:
        'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file',
      signers: [{ email: 'a@test.com', order: 1, status: 'FIRMADO' }],
    };
    expect(
      resolveOrionPdfAccessUrl(doc, 'https://onedrive.example.com/original.pdf', {
        requestId: 1,
        fileId: 'file-1',
      })
    ).toBe('/api/integrations/orion/signed-file?requestId=1&fileId=file-1');
  });

  it('does not pin current view to a partial versionId', () => {
    const doc: OrionSignatureState = {
      orionDocumentId: 'doc-1',
      signedFileUrl:
        'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file',
      versions: [
        {
          id: 'sign-a',
          kind: 'partial',
          label: 'A',
          url: 'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file',
          createdAt: '2026-01-02',
        },
        {
          id: 'sign-b',
          kind: 'partial',
          label: 'B',
          url: 'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file',
          createdAt: '2026-01-03',
        },
      ],
    };
    expect(
      resolveOrionPdfAccessUrl(doc, 'https://onedrive.example.com/original.pdf', {
        requestId: 1,
        fileId: 'file-1',
      })
    ).toBe('/api/integrations/orion/signed-file?requestId=1&fileId=file-1');
  });

  it('uses proxy when a signer already completed even without signedFileUrl', () => {
    const doc: OrionSignatureState = {
      orionDocumentId: 'doc-1',
      status: 'EN_PROCESO',
      signers: [
        { email: 'a@test.com', order: 1, status: 'FIRMADO' },
        { email: 'b@test.com', order: 2, status: 'PENDIENTE' },
      ],
    };
    expect(
      resolveOrionPdfAccessUrl(doc, 'https://onedrive.example.com/original.pdf', {
        requestId: 1,
        fileId: 'file-1',
      })
    ).toBe('/api/integrations/orion/signed-file?requestId=1&fileId=file-1');
  });

  it('detects signed copy only after a signer completed', () => {
    expect(orionDocumentHasSignedCopy({ orionDocumentId: 'doc-1' })).toBe(false);
    expect(
      orionDocumentHasSignedCopy({
        orionDocumentId: 'doc-1',
        status: 'BORRADOR',
        signers: [{ email: 'a@test.com', status: 'PENDIENTE' }],
      })
    ).toBe(false);
    expect(
      orionDocumentHasSignedCopy({
        orionDocumentId: 'doc-1',
        signers: [{ email: 'a@test.com', status: 'FIRMADO' }],
      })
    ).toBe(true);
  });

  it('returns null for draft so callers prefer live OneDrive', () => {
    const doc: OrionSignatureState = { orionDocumentId: 'doc-1' };
    const original = 'https://onedrive.example.com/original.pdf';
    expect(
      resolveOrionPdfAccessUrl(doc, original, { requestId: 1, fileId: 'file-1' })
    ).toBeNull();
  });

  it('does not proxy Orion signed-file while document is still BORRADOR', () => {
    const doc: OrionSignatureState = {
      orionDocumentId: 'doc-1',
      status: 'BORRADOR',
      signedFileUrl:
        'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file',
      signers: [{ email: 'a@test.com', order: 1, status: 'PENDIENTE' }],
    };
    const original = 'https://onedrive.example.com/original.pdf';
    expect(
      resolveOrionPdfAccessUrl(doc, original, { requestId: 1, fileId: 'file-1' })
    ).toBeNull();
  });

  it('builds version proxy URL for partial versions', () => {
    expect(
      resolveOrionVersionAccessUrl({
        requestId: 1,
        fileId: 'file-1',
        versionId: 'v1',
        url: 'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file',
        kind: 'partial',
      })
    ).toBe(
      '/api/integrations/orion/signed-file?requestId=1&fileId=file-1&versionId=v1&download=1'
    );
  });
});
