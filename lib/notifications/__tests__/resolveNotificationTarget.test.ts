import { describe, expect, it } from 'vitest';
import {
  getNotificationActionLabel,
  inferNotificationPath,
  resolveNotificationPath,
} from '../resolveNotificationTarget';

describe('resolveNotificationPath', () => {
  it('convierte URL absoluta de prod a ruta interna', () => {
    expect(
      resolveNotificationPath(
        'https://groupsharedservices.farmalogica.com:8445/process/authorization'
      )
    ).toBe('/process/authorization');
  });

  it('conserva query de orionFileId', () => {
    expect(
      resolveNotificationPath(
        '/process/request-general/view-request?id=2138&from=general-requests&orionFileId=abc'
      )
    ).toBe(
      '/process/request-general/view-request?id=2138&from=general-requests&orionFileId=abc'
    );
  });
});

describe('inferNotificationPath — firma / Orion', () => {
  it('Autorizar firma → /process/authorization (no view-request)', () => {
    expect(
      inferNotificationPath({
        title: 'Autorizar firma · SynerLink',
        body: 'Solicitud #2138 · contrato.pdf. Autorice para ver y firmar el documento.',
        url: null,
      })
    ).toBe('/process/authorization');
  });

  it('Su turno de firma → autorizaciones', () => {
    expect(
      inferNotificationPath({
        title: 'Su turno de firma · SynerLink',
        body: 'Solicitud #99. Ya puede autorizar y firmar el documento.',
      })
    ).toBe('/process/authorization');
  });

  it('respeta url guardada de autorización', () => {
    expect(
      inferNotificationPath({
        title: 'Autorizar firma · SynerLink',
        body: 'Solicitud #1',
        url: 'https://example.com/process/authorization',
      })
    ).toBe('/process/authorization');
  });

  it('progreso de firma → view-request con id', () => {
    expect(
      inferNotificationPath({
        title: 'Documento enviado a firma · SynerLink',
        body: 'Solicitud #2138 · doc.pdf. El flujo de firma comenzó.',
      })
    ).toBe('/process/request-general/view-request?id=2138&from=general-requests');
  });

  it('incluido como firmante → view-request', () => {
    expect(
      inferNotificationPath({
        title: 'Incluido como firmante · SynerLink',
        body: 'Solicitud #50 — Contrato. Recibirá aviso en Autorizaciones cuando sea su turno.',
      })
    ).toBe('/process/request-general/view-request?id=50&from=general-requests');
  });

  it('url con orionFileId se preserva', () => {
    expect(
      inferNotificationPath({
        title: 'Firma avanzada · SynerLink',
        body: 'Solicitud #7',
        url: '/process/request-general/view-request?id=7&from=general-requests&orionFileId=FILE1',
      })
    ).toBe(
      '/process/request-general/view-request?id=7&from=general-requests&orionFileId=FILE1'
    );
  });
});

describe('getNotificationActionLabel', () => {
  it('etiqueta autorizaciones', () => {
    expect(getNotificationActionLabel('/process/authorization', 'Autorizar firma')).toBe(
      'Ir a autorizaciones'
    );
  });

  it('etiqueta documento de firma', () => {
    expect(
      getNotificationActionLabel(
        '/process/request-general/view-request?id=1',
        'Documento enviado a firma · SynerLink'
      )
    ).toBe('Ver documento');
  });
});
