import { describe, expect, it } from 'vitest';
import {
  buildVersionFileName,
  buildVersionFolderSegments,
  getControlledPdfError,
  getSourceFileError,
  isPdf,
  isWord,
  sha256Hex,
} from '../storage';

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc('%PDF-1.7\n...');
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const DOC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]);

describe('SGC · almacenamiento propio por empresa y versión', () => {
  it('[SGC-REQ-014] la carpeta es SGC/<EMPRESA>/<TIPO>/<CODIGO>/v<n> dentro de la raíz propia de la empresa', () => {
    expect(buildVersionFolderSegments({ storageRoot: 'SGC/OLP', documentTypeCode: 'PR', code: 'OLP-GC-PR-001', versionNumber: 3 })).toEqual([
      'SGC',
      'OLP',
      'PR',
      'OLP-GC-PR-001',
      'v3',
    ]);
  });

  it('[SGC-REQ-014] sin raíz propia o con versión inválida no arma ruta', () => {
    expect(() => buildVersionFolderSegments({ storageRoot: ' / ', documentTypeCode: 'PR', code: 'X', versionNumber: 1 })).toThrow('storage_root');
    expect(() => buildVersionFolderSegments({ storageRoot: 'SGC/OLP', documentTypeCode: 'PR', code: 'X', versionNumber: 0 })).toThrow();
  });

  it('[SGC-REQ-014] el archivo se nombra por código y versión, sin depender del nombre original', () => {
    expect(buildVersionFileName('OLP-GC-PR-001', 2, 'mi archivo final (1).PDF', 'pdf')).toBe('OLP-GC-PR-001 V2.pdf');
    expect(buildVersionFileName('OLP-GC-PR-001', 2, 'sin-extension', 'docx')).toBe('OLP-GC-PR-001 V2.docx');
  });

  it('[SGC-REQ-014] la huella SHA-256 es la estándar (64 hex)', () => {
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('[SGC-REQ-014] el PDF controlado se valida por su firma, no por la extensión', () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(enc('%PDF'))).toBe(false);
    expect(getControlledPdfError(PDF)).toBeNull();
    expect(getControlledPdfError(null)).toContain('Falta');
    expect(getControlledPdfError(DOCX)).toContain('PDF');
    expect(getControlledPdfError(new Uint8Array(25 * 1024 * 1024 + 1))).toContain('tamaño');
  });

  it('[SGC-REQ-014] el Word fuente es opcional y se valida por su firma', () => {
    expect(getSourceFileError(null, 'x.docx')).toBeNull();
    expect(getSourceFileError(DOCX, 'Procedimiento.docx')).toBeNull();
    expect(getSourceFileError(DOC, 'viejo.doc')).toBeNull();
    expect(isWord(DOCX, 'x.pdf')).toBe(false);
    expect(getSourceFileError(PDF, 'falso.docx')).toContain('Word');
    expect(getSourceFileError(new Uint8Array(25 * 1024 * 1024 + 1), 'x.docx')).toContain('tamaño');
  });
});
