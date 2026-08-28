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
});
