import { describe, it, expect } from 'vitest';
import {
  getFileLabelError,
  sanitizeOneDriveName,
  INVALID_ONEDRIVE_CHARS,
} from '../onedriveName';

// Prueba unitaria real sobre una utilidad PURA (sin BD/red): saneamiento y
// validación de nombres de archivo para OneDrive/SharePoint. Sirve como semilla
// de la suite de Vitest del front (parte de la Fase 0 del control de calidad).

describe('getFileLabelError', () => {
  it('acepta una etiqueta válida', () => {
    expect(getFileLabelError('Factura 2026-07')).toBeNull();
  });

  it('trata el vacío/espacios como válido (se controla aparte con el trim/botón)', () => {
    expect(getFileLabelError('')).toBeNull();
    expect(getFileLabelError('   ')).toBeNull();
  });

  it('rechaza caracteres inválidos de OneDrive/SharePoint', () => {
    for (const ch of ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '#', '%']) {
      expect(getFileLabelError(`nombre${ch}malo`)).toMatch(/No se permiten/);
    }
  });

  it('rechaza etiquetas que empiezan o terminan con punto', () => {
    expect(getFileLabelError('.oculto')).toMatch(/punto/);
    expect(getFileLabelError('archivo.')).toMatch(/punto/);
  });

  it('rechaza etiquetas con espacios al inicio o al final', () => {
    expect(getFileLabelError(' hola')).toMatch(/espacios/);
    expect(getFileLabelError('hola ')).toMatch(/espacios/);
  });
});

describe('sanitizeOneDriveName', () => {
  it('elimina los caracteres inválidos conservando el resto', () => {
    const out = sanitizeOneDriveName('re:porte/final?.pdf');
    expect(INVALID_ONEDRIVE_CHARS.test(out)).toBe(false);
    expect(out).toBe('reportefinal.pdf');
  });

  it('colapsa espacios múltiples en uno solo', () => {
    expect(sanitizeOneDriveName('mucho    espacio')).toBe('mucho espacio');
  });

  it('recorta puntos y espacios iniciales y finales, conservando la extensión interna', () => {
    expect(sanitizeOneDriveName('  ..documento.docx..  ')).toBe('documento.docx');
  });

  it('maneja null/undefined sin lanzar', () => {
    expect(sanitizeOneDriveName(null as unknown as string)).toBe('');
    expect(sanitizeOneDriveName(undefined as unknown as string)).toBe('');
  });
});
