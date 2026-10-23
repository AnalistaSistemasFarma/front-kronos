import { describe, expect, it } from 'vitest';
import { VITRINA_IMAGEN_MAX_BYTES } from '../constants';
import {
  carpetaImagenes,
  documentoSgcMostrable,
  esTipoDocumento,
  esTipoImagen,
  formatoImagen,
  idiomaDocumento,
  nombreArchivoImagen,
  siguienteVersion,
  urlImagen,
  urlVisorSgc,
  validarImagen,
} from '../medios';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

describe('Vitrina · imágenes de empaque', () => {
  it('reconoce PNG, JPG y WEBP por su firma; rechaza lo demás', () => {
    expect(formatoImagen(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(formatoImagen(JPG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(formatoImagen(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(formatoImagen(PDF)).toBeNull();
    expect(() => validarImagen(PDF)).toThrow(/PNG, JPG o WEBP/);
    expect(() => validarImagen(new Uint8Array())).toThrow(/Adjunte/);
    const grande = new Uint8Array(VITRINA_IMAGEN_MAX_BYTES + 1);
    grande.set(PNG);
    expect(() => validarImagen(grande)).toThrow(/supera/);
  });

  it('carpeta propia bajo la raíz de adjuntos del entorno', () => {
    expect(carpetaImagenes('SAPSEND', 1, 25)).toEqual(['SAPSEND', 'VITRINA', 'empresa-1', 'presentacion-25']);
    expect(carpetaImagenes('SAPSEND-PRUEBAS', 2, 3)[0]).toBe('SAPSEND-PRUEBAS');
    expect(() => carpetaImagenes('../x', 1, 1)).toThrow();
    expect(() => carpetaImagenes('SAPSEND', 0, 1)).toThrow();
  });

  it('nombre con versión y token (no se pisan dos cargas)', () => {
    expect(nombreArchivoImagen('VIAL', 3, 'a1b2-c3d4-e5f6', 'png')).toBe('VIAL-v3-a1b2c3d4.png');
    expect(siguienteVersion([])).toBe(1);
    expect(siguienteVersion(['1', '3', null, 'x'])).toBe(4);
  });

  it('tipos cerrados (iguales a los CHECK de la migración)', () => {
    expect(['VIAL', 'ETIQUETA', 'PLEGADIZA'].every(esTipoImagen)).toBe(true);
    expect(esTipoImagen('FOTO')).toBe(false);
    expect(['FICHA', 'INSERTO', 'PROSPECTO'].every(esTipoDocumento)).toBe(true);
    expect(esTipoDocumento('MONOGRAFIA')).toBe(false);
  });

  it('la imagen se sirve por la Vitrina (nunca la URL de OneDrive)', () => {
    expect(urlImagen(12)).toBe('/api/vitrina/imagenes/12');
  });
});

describe('Vitrina · documentos del SGC', () => {
  it('solo vigentes, con versión vigente y no confidenciales', () => {
    expect(documentoSgcMostrable({ status: 'vigente', current_version_id: 4, confidentiality: 'publica' })).toBe(true);
    expect(documentoSgcMostrable({ status: 'vigente', current_version_id: 4, confidentiality: 'departamento' })).toBe(true);
    expect(documentoSgcMostrable({ status: 'obsoleto', current_version_id: 4, confidentiality: 'publica' })).toBe(false);
    expect(documentoSgcMostrable({ status: 'borrador', current_version_id: null, confidentiality: 'publica' })).toBe(false);
    expect(documentoSgcMostrable({ status: 'vigente', current_version_id: null, confidentiality: 'publica' })).toBe(false);
    expect(documentoSgcMostrable({ status: 'vigente', current_version_id: 4, confidentiality: 'confidencial' })).toBe(false);
    expect(documentoSgcMostrable(null)).toBe(false);
  });

  it('el visor es el del SGC en modo consulta (sin descarga)', () => {
    const u = urlVisorSgc(7, 31);
    expect(u).toBe('/api/sgc/documents/7/versions/31/file');
    expect(u).not.toMatch(/descarga|impresion/);
  });

  it('idioma de dos letras', () => {
    expect(idiomaDocumento('ES')).toBe('es');
    expect(idiomaDocumento('')).toBeNull();
    expect(() => idiomaDocumento('español')).toThrow();
  });
});
