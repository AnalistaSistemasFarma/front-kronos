import { describe, expect, it } from 'vitest';
import { authorizationPreviewPdfUrl } from '../previewPdf';

describe('PDF de la vista previa en «Ver detalle» de Autorizaciones', () => {
  it('firma: la última versión firmada, sin sellos (rápida)', () => {
    expect(
      authorizationPreviewPdfUrl({
        requestId: 10089,
        resolution: '[orionFile:ABC 1][orionAuth] Autorizar firma',
        isFirma: true,
      })
    ).toBe(
      '/api/integrations/orion/signed-file?requestId=10089&fileId=ABC%201&watermark=0&annotations=0'
    );
  });

  it('la misma autorización da siempre la misma URL (así la precarga sirve)', () => {
    const params = { requestId: 7, resolution: '[orionFile:X][orionAuth]', isFirma: true };
    expect(authorizationPreviewPdfUrl(params)).toBe(authorizationPreviewPdfUrl(params));
  });

  it('sin documento, sin solicitud o si no es firma: no hay vista previa', () => {
    expect(authorizationPreviewPdfUrl({ requestId: 7, resolution: 'Aprobado', isFirma: true })).toBeNull();
    expect(
      authorizationPreviewPdfUrl({ requestId: 0, resolution: '[orionFile:X][orionAuth]', isFirma: true })
    ).toBeNull();
    expect(
      authorizationPreviewPdfUrl({ requestId: 7, resolution: '[orionFile:X][orionAuth]', isFirma: false })
    ).toBeNull();
  });
});
