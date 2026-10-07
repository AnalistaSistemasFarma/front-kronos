import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOrionSignedFileApiUrl,
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

describe('orion client url helpers', () => {
  const prevApi = process.env.ORION_API_BASE_URL;
  const prevPublic = process.env.ORION_PUBLIC_URL;
  const prevEmbed = process.env.ORION_EMBED_ORIGIN;

  afterEach(() => {
    if (prevApi === undefined) delete process.env.ORION_API_BASE_URL;
    else process.env.ORION_API_BASE_URL = prevApi;
    if (prevPublic === undefined) delete process.env.ORION_PUBLIC_URL;
    else process.env.ORION_PUBLIC_URL = prevPublic;
    if (prevEmbed === undefined) delete process.env.ORION_EMBED_ORIGIN;
    else process.env.ORION_EMBED_ORIGIN = prevEmbed;
  });

  it('resolves relative Orion paths with api base from env', () => {
    delete process.env.ORION_PUBLIC_URL;
    delete process.env.ORION_EMBED_ORIGIN;
    process.env.ORION_API_BASE_URL = 'http://localhost:3000';
    expect(
      resolveOrionAbsoluteUrl('/api/integrations/synerlink/documents/abc/signed-file')
    ).toBe('http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file');
  });

  it('rewrites localhost absolute Orion urls to public base', () => {
    process.env.ORION_PUBLIC_URL = 'https://orion.example.com';
    process.env.ORION_API_BASE_URL = 'http://localhost:3000';
    expect(resolveOrionAbsoluteUrl('http://localhost:3000/sign/abc123')).toBe(
      'https://orion.example.com/sign/abc123'
    );
  });

  it('builds canonical signed-file API url', () => {
    delete process.env.ORION_PUBLIC_URL;
    delete process.env.ORION_EMBED_ORIGIN;
    process.env.ORION_API_BASE_URL = 'http://localhost:3000';
    expect(buildOrionSignedFileApiUrl('doc-1')).toBe(
      'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file'
    );
  });
});

describe('signedFileAccess', () => {
  it('detects Orion protected file URLs', () => {
    expect(
      isOrionProtectedFileUrl(
        'http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file'
      )
    ).toBe(true);
    expect(isOrionProtectedFileUrl('https://onedrive.example.com/file.pdf')).toBe(false);
  });

  it('isHostOrSubdomain avoids suffix spoofing', () => {
    expect(isHostOrSubdomain('contoso.sharepoint.com', 'sharepoint.com')).toBe(true);
    expect(isHostOrSubdomain('sharepoint.com', 'sharepoint.com')).toBe(true);
    expect(isHostOrSubdomain('evilsharepoint.com', 'sharepoint.com')).toBe(false);
    expect(isHostOrSubdomain('evilmicrosoft.com', 'microsoft.com')).toBe(false);
  });

  it('rejects loopback and private hosts for server PDF fetch', () => {
    const prev = process.env.ORION_API_BASE_URL;
    process.env.ORION_API_BASE_URL = 'http://localhost:3000';

    expect(isAllowedServerPdfFetchUrl('http://127.0.0.1/secret.pdf')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('http://192.168.1.10/file.pdf')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('https://evilmicrosoft.com/file.pdf')).toBe(false);
    expect(isAllowedServerPdfFetchUrl('https://evilsharepoint.com/file.pdf')).toBe(false);
    expect(
      isAllowedServerPdfFetchUrl(
        'https://contoso.sharepoint.com/sites/x/_layouts/15/download.aspx?UniqueId=abc'
      )
    ).toBe(true);
    expect(
      isAllowedServerPdfFetchUrl(
        'http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file'
      )
    ).toBe(true);
    // Misma ruta en host no configurado como Orion → rechazar (SSRF).
    expect(
      isAllowedServerPdfFetchUrl(
        'http://127.0.0.1:9999/api/integrations/synerlink/documents/abc/signed-file'
      )
    ).toBe(false);

    if (prev === undefined) delete process.env.ORION_API_BASE_URL;
    else process.env.ORION_API_BASE_URL = prev;
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
