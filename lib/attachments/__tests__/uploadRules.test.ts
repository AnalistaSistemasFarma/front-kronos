import { describe, expect, it } from 'vitest';
import {
  IIS_MAX_REQUEST_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  REQUEST_ATTACHMENT_ACCEPT,
  fileExtension,
  isAllowedRequestAttachment,
  proxyUploadErrorMessage,
} from '../uploadRules';

describe('isAllowedRequestAttachment', () => {
  it('acepta un PDF con MIME vacío (Android / Drive / WhatsApp)', () => {
    expect(isAllowedRequestAttachment({ name: 'Cámara de comercio.pdf', type: '' })).toBe(true);
  });

  it('acepta un .xlsx con octet-stream (Windows sin Office)', () => {
    expect(
      isAllowedRequestAttachment({ name: 'FORMATO ANTICIPO.XLSX', type: 'application/octet-stream' })
    ).toBe(true);
  });

  it('acepta por MIME aunque el nombre no traiga extensión', () => {
    expect(isAllowedRequestAttachment({ name: 'image', type: 'image/jpeg' })).toBe(true);
  });

  it('sigue rechazando lo que no está en la lista', () => {
    expect(isAllowedRequestAttachment({ name: 'instalador.exe', type: 'application/octet-stream' })).toBe(false);
    expect(isAllowedRequestAttachment({ name: 'video.mov', type: 'video/quicktime' })).toBe(false);
    expect(isAllowedRequestAttachment({ name: 'sin-extension', type: '' })).toBe(false);
  });
});

describe('fileExtension', () => {
  it('normaliza a minúsculas y tolera nombres raros', () => {
    expect(fileExtension('Informe.PDF')).toBe('pdf');
    expect(fileExtension('.oculto')).toBe('');
    expect(fileExtension('termina.')).toBe('');
    expect(fileExtension(undefined)).toBe('');
  });
});

describe('topes y mensajes', () => {
  it('el tope del navegador queda por debajo del límite de IIS', () => {
    expect(MAX_UPLOAD_REQUEST_BYTES).toBeLessThan(IIS_MAX_REQUEST_BYTES);
  });

  it('el accept lleva extensiones y MIME', () => {
    expect(REQUEST_ATTACHMENT_ACCEPT).toContain('.pdf');
    expect(REQUEST_ATTACHMENT_ACCEPT).toContain('application/pdf');
  });

  it('traduce el 413 de IIS a un mensaje claro', () => {
    expect(proxyUploadErrorMessage(413)).toMatch(/tamaño/);
    expect(proxyUploadErrorMessage(500)).toBeNull();
  });
});
