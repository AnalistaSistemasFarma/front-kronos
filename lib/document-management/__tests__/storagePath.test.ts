import { describe, it, expect } from 'vitest';
import {
  buildDocumentVersionFolderSegments,
  buildDocumentVersionFullPath,
  getDocumentCodeError,
  DOCUMENT_MANAGEMENT_ROOT,
} from '../storagePath';

// Prueba unitaria sobre utilidades PURAS (sin BD/red/Graph): construcción de
// la ruta de OneDrive del módulo y validación del código de documento.

describe('buildDocumentVersionFolderSegments', () => {
  it('construye la ruta GESTION-DOCUMENTAL/<EMPRESA>/<TIPO>/<CODIGO>/v<version>', () => {
    const segments = buildDocumentVersionFolderSegments({
      companyName: 'Farmalógica S.A.',
      documentTypeName: 'Procedimiento',
      code: 'PRO-GH-001',
      versionNumber: 1,
    });

    expect(segments[0]).toBe(DOCUMENT_MANAGEMENT_ROOT);
    expect(segments).toEqual(['GESTION-DOCUMENTAL', 'Farmalógica S.A', 'Procedimiento', 'PRO-GH-001', 'v1']);
  });

  it('sanea caracteres inválidos de OneDrive en cada segmento', () => {
    const segments = buildDocumentVersionFolderSegments({
      companyName: 'Empresa: Uno / Dos',
      documentTypeName: 'Tipo?<raro>',
      code: 'COD*01',
      versionNumber: 3,
    });

    expect(segments).toEqual(['GESTION-DOCUMENTAL', 'Empresa Uno Dos', 'Tiporaro', 'COD01', 'v3']);
  });
});

describe('buildDocumentVersionFullPath', () => {
  it('agrega el nombre de archivo saneado al final', () => {
    const full = buildDocumentVersionFullPath(
      {
        companyName: 'OLP',
        documentTypeName: 'Política',
        code: 'POL-001',
        versionNumber: 2,
      },
      'manual final.pdf'
    );
    expect(full).toBe('GESTION-DOCUMENTAL/OLP/Política/POL-001/v2/manual final.pdf');
  });
});

describe('getDocumentCodeError', () => {
  it('acepta un código válido', () => {
    expect(getDocumentCodeError('POL-GH-001')).toBeNull();
  });

  it('rechaza el código vacío', () => {
    expect(getDocumentCodeError('')).toMatch(/obligatorio/);
    expect(getDocumentCodeError('   ')).toMatch(/obligatorio/);
  });

  it('rechaza caracteres no permitidos', () => {
    expect(getDocumentCodeError('POL 001')).toMatch(/letras, números/);
    expect(getDocumentCodeError('POL/001')).toMatch(/letras, números/);
  });

  // Bug real de producción (2026-09-03): un código de documento "CON" es una
  // secuencia de letras válida para CODE_PATTERN, pero es un nombre de
  // dispositivo reservado de Windows -- OneDrive/SharePoint lo rechaza al
  // crear la carpeta (HTTP 400), y ese rechazo no controlado tumbaba
  // create-request con un 500. getDocumentCodeError debe atraparlo ANTES,
  // aquí mismo, como error de validación (400).
  describe('nombres reservados de dispositivo de Windows', () => {
    const reserved = [
      'CON',
      'con',
      'Con',
      'PRN',
      'prn',
      'AUX',
      'aux',
      'NUL',
      'nul',
      'COM1',
      'com1',
      'COM9',
      'LPT1',
      'lpt1',
      'LPT9',
    ];

    it.each(reserved)('rechaza "%s" como nombre reservado de Windows', (code) => {
      const error = getDocumentCodeError(code);
      expect(error).not.toBeNull();
      expect(error).toMatch(/nombre reservado de Windows/);
    });

    it('COM0 y LPT0 también se rechazan (dígito 0 incluido en el rango)', () => {
      expect(getDocumentCodeError('COM0')).toMatch(/nombre reservado de Windows/);
      expect(getDocumentCodeError('LPT0')).toMatch(/nombre reservado de Windows/);
    });

    it('no rechaza códigos que solo contienen un nombre reservado como substring', () => {
      // La palabra reservada debe ser el código COMPLETO, no una parte de él:
      // "CON-GH-001" es un código de documento legítimo, no un archivo "CON".
      expect(getDocumentCodeError('CON-GH-001')).toBeNull();
      expect(getDocumentCodeError('PRO-CON-001')).toBeNull();
      expect(getDocumentCodeError('CONTRATO-001')).toBeNull();
    });

    it('COM10 y LPT10 no son nombres reservados (el rango real es 0-9)', () => {
      expect(getDocumentCodeError('COM10')).toBeNull();
      expect(getDocumentCodeError('LPT10')).toBeNull();
    });
  });
});
