import { describe, expect, it } from 'vitest';
import type { OrionSignatureState } from '../../orion/types';
import {
  buildSynerLinkAttachmentFileUrl,
  isSynerLinkAttachmentFileUrl,
  resolveRequestPdfAccessUrl,
} from '../fileUrl';

describe('attachment file URLs', () => {
  it('builds SynerLink OneDrive proxy URL', () => {
    expect(
      buildSynerLinkAttachmentFileUrl({ requestId: 2092, fileId: '01ABC' })
    ).toBe('/api/requests-general/attachment-file?requestId=2092&fileId=01ABC');
    expect(
      buildSynerLinkAttachmentFileUrl({
        requestId: 1,
        fileId: 'f1',
        download: true,
      })
    ).toBe('/api/requests-general/attachment-file?requestId=1&fileId=f1&download=1');
    expect(
      isSynerLinkAttachmentFileUrl(
        '/api/requests-general/attachment-file?requestId=1&fileId=f1'
      )
    ).toBe(true);
  });

  it('uses SynerLink OneDrive when the PDF has no signatures', () => {
    const draft: OrionSignatureState = {
      orionDocumentId: 'doc-1',
      status: 'BORRADOR',
      signers: [{ email: 'a@test.com', order: 1, status: 'PENDIENTE' }],
    };
    expect(
      resolveRequestPdfAccessUrl({
        requestId: 2092,
        fileId: '01A7LY3DOULSMUFF3RVJC336WDBJOHGNQS',
        state: draft,
      })
    ).toBe(
      '/api/requests-general/attachment-file?requestId=2092&fileId=01A7LY3DOULSMUFF3RVJC336WDBJOHGNQS'
    );
    expect(
      resolveRequestPdfAccessUrl({
        requestId: 2092,
        fileId: '01ABC',
        state: null,
      })
    ).toBe('/api/requests-general/attachment-file?requestId=2092&fileId=01ABC');
  });

  it('uses Orion signed-file only after there is a signed copy', () => {
    const signed: OrionSignatureState = {
      orionDocumentId: 'doc-1',
      status: 'EN_PROCESO',
      signers: [{ email: 'a@test.com', order: 1, status: 'FIRMADO' }],
    };
    expect(
      resolveRequestPdfAccessUrl({
        requestId: 2092,
        fileId: '01ABC',
        state: signed,
      })
    ).toBe('/api/integrations/orion/signed-file?requestId=2092&fileId=01ABC');
  });
});
