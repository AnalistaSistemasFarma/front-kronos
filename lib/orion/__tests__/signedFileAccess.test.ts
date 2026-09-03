import { describe, expect, it } from 'vitest';
import {
  buildOrionSignedFileApiUrl,
  resolveOrionAbsoluteUrl,
} from '../client';
import {
  buildOrionSignedFileProxyUrl,
  isOrionProtectedFileUrl,
  resolveOrionPdfAccessUrl,
  resolveOrionVersionAccessUrl,
} from '../signedFileAccess';
import type { OrionSignatureState } from '../types';

describe('orion client url helpers', () => {
  it('resolves relative Orion paths with api base from env', () => {
    const prev = process.env.ORION_API_BASE_URL;
    process.env.ORION_API_BASE_URL = 'http://localhost:3000';
    expect(
      resolveOrionAbsoluteUrl('/api/integrations/synerlink/documents/abc/signed-file')
    ).toBe('http://localhost:3000/api/integrations/synerlink/documents/abc/signed-file');
    if (prev === undefined) delete process.env.ORION_API_BASE_URL;
    else process.env.ORION_API_BASE_URL = prev;
  });

  it('builds canonical signed-file API url', () => {
    const prev = process.env.ORION_API_BASE_URL;
    process.env.ORION_API_BASE_URL = 'http://localhost:3000';
    expect(buildOrionSignedFileApiUrl('doc-1')).toBe(
      'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file'
    );
    if (prev === undefined) delete process.env.ORION_API_BASE_URL;
    else process.env.ORION_API_BASE_URL = prev;
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

  it('builds proxy URL with requestId and fileId', () => {
    expect(buildOrionSignedFileProxyUrl({ requestId: 1, fileId: 'file-2' })).toBe(
      '/api/integrations/orion/signed-file?requestId=1&fileId=file-2'
    );
  });

  it('uses proxy for Orion signedFileUrl', () => {
    const doc: OrionSignatureState = {
      orionDocumentId: 'doc-1',
      signedFileUrl:
        'http://localhost:3000/api/integrations/synerlink/documents/doc-1/signed-file',
    };
    expect(
      resolveOrionPdfAccessUrl(doc, 'https://onedrive.example.com/original.pdf', {
        requestId: 1,
        fileId: 'file-1',
      })
    ).toBe('/api/integrations/orion/signed-file?requestId=1&fileId=file-1');
  });

  it('keeps OneDrive URL when no Orion signed file', () => {
    const doc: OrionSignatureState = { orionDocumentId: 'doc-1' };
    const original = 'https://onedrive.example.com/original.pdf';
    expect(
      resolveOrionPdfAccessUrl(doc, original, { requestId: 1, fileId: 'file-1' })
    ).toBe(original);
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
