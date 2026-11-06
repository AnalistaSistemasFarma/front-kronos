import { describe, expect, it } from 'vitest';
import { buildMultipartBody } from '../sap/serviceLayer';
import { mimeFor, uniqueSapFilename, validateAttachments } from './attachments';

describe('validateAttachments', () => {
  it('acepta PDF e imagenes', () => {
    expect(validateAttachments([{ name: 'cotizacion.pdf', size: 100 }, { name: 'foto.PNG', size: 5 }])).toEqual({
      rejected: [],
    });
  });
  it('rechaza extension, tamano, vacio y nombre invalido', () => {
    const { rejected } = validateAttachments([
      { name: 'malware.exe', size: 10 },
      { name: 'grande.pdf', size: 11 * 1024 * 1024 },
      { name: 'vacio.pdf', size: 0 },
      { name: '../x.pdf', size: 10 },
    ]);
    expect(rejected.map((r) => r.reason)).toEqual(['type', 'size', 'empty', 'name']);
  });
  it('exige al menos uno y como maximo 10', () => {
    expect(validateAttachments([]).error).toBeTruthy();
    expect(validateAttachments(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.pdf`, size: 1 }))).error).toBeTruthy();
  });
});

describe('uniqueSapFilename y mimeFor', () => {
  it('antepone el id unico y limpia caracteres', () => {
    expect(uniqueSapFilename('Cotización final.pdf', 'abc')).toBe('abc_Cotizaci_n_final.pdf');
  });
  it('resuelve el tipo MIME', () => {
    expect(mimeFor('a.JPG')).toBe('image/jpeg');
    expect(mimeFor('a.pdf')).toBe('application/pdf');
  });
});

describe('buildMultipartBody', () => {
  it('arma un cuerpo con una parte "file" por archivo', () => {
    const body = buildMultipartBody(
      [{ filename: 'a.pdf', contentType: 'application/pdf', data: Buffer.from('PDF') }],
      'XYZ'
    ).toString();
    expect(body).toContain('--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"');
    expect(body).toContain('Content-Type: application/pdf\r\n\r\nPDF\r\n');
    expect(body.endsWith('--XYZ--\r\n')).toBe(true);
  });
});
