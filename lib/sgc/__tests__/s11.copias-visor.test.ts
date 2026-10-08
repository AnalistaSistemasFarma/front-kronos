import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  SGC_COPY_DEFAULTS,
  copyActions,
  copyAllowedForType,
  copyConfigOf,
  copyExpiry,
  effectiveCopyStatus,
  normalizeCopyRequest,
  viewerResourceOf,
} from '../uncontrolledCopies';
import { buildUncontrolledCopyLines, stampControlledCopy, stampUncontrolledCopy, tilePositions, tiledWatermarkText } from '../watermark';

/**
 * Sprint 11 — copias no controladas (solicitud, vigencia, impresión y
 * descarga solo para terceros) y protección del visor (marca de agua en
 * mosaico con correo, fecha, hora e IP; registro de eventos del visor).
 */
const cfg = copyConfigOf(null);

async function onePagePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]);
  return pdf.save();
}

describe('SGC · S11 · copias no controladas', () => {
  it('[SGC-REQ-127] configuración por empresa con valores por defecto (formatos FO y FR, 30 días, máximo 90)', () => {
    expect(cfg).toEqual({ types: ['FO', 'FR'], days: 30, maxDays: 90 });
    expect(SGC_COPY_DEFAULTS.days).toBe(30);
    expect(copyConfigOf({ uncontrolled_copy_types: 'fo; an fo', uncontrolled_copy_days: 10, uncontrolled_copy_max_days: 20 })).toEqual({ types: ['FO', 'AN'], days: 10, maxDays: 20 });
    expect(copyConfigOf({ uncontrolled_copy_types: '  ' }).types).toEqual(['FO', 'FR']);
    expect(copyAllowedForType(cfg, 'fo')).toBe(true);
    expect(copyAllowedForType(cfg, 'PR')).toBe(false);
  });

  it('[SGC-REQ-127] la solicitud exige justificación, destino (y a quién, si es un tercero) y días dentro del máximo', () => {
    expect(normalizeCopyRequest({ justification: 'Lo voy a diligenciar a mano', destination: 'interno' }, cfg)).toEqual({ justification: 'Lo voy a diligenciar a mano', destination: 'interno', destinationDetail: null, days: 30 });
    expect(normalizeCopyRequest({ justification: 'Se envía al cliente para devoluciones', destination: 'tercero', destinationDetail: 'Droguería X', days: '15' }, cfg)).toMatchObject({ destination: 'tercero', destinationDetail: 'Droguería X', days: 15 });
    expect(() => normalizeCopyRequest(null, cfg)).toThrow(/mínimo 10/);
    expect(() => normalizeCopyRequest({ justification: 'x'.repeat(1001), destination: 'interno' }, cfg)).toThrow(/1.000/);
    expect(() => normalizeCopyRequest({ justification: 'Justificación suficiente', destination: 'correo' }, cfg)).toThrow(/destino/);
    expect(() => normalizeCopyRequest({ justification: 'Justificación suficiente', destination: 'tercero' }, cfg)).toThrow(/a quién/);
    expect(() => normalizeCopyRequest({ justification: 'Justificación suficiente', destination: 'interno', days: 91 }, cfg)).toThrow(/entre 1 y 90/);
    expect(() => normalizeCopyRequest({ justification: 'Justificación suficiente', destination: 'interno', days: 2.5 }, cfg)).toThrow(/entre 1 y 90/);
  });

  it('[SGC-REQ-129] autorizada se imprime hasta el fin del último día (Colombia); vencida, ya no; la descarga solo si es para un tercero', () => {
    const at = new Date('2026-10-08T15:00:00Z');
    const exp = copyExpiry(at, 30);
    expect(exp.toISOString()).toBe('2026-11-08T04:59:59.000Z');
    expect(effectiveCopyStatus('autorizada', exp, new Date('2026-11-08T04:00:00Z'))).toBe('autorizada');
    expect(effectiveCopyStatus('autorizada', exp, new Date('2026-11-08T05:00:00Z'))).toBe('vencida');
    expect(effectiveCopyStatus('pendiente', null, at)).toBe('pendiente');
    expect(effectiveCopyStatus('otra', null, at)).toBe('cancelada');
    expect(copyActions({ status: 'autorizada', expiresAt: exp, allowDownload: false }, at)).toEqual({ canPrint: true, canDownload: false });
    expect(copyActions({ status: 'autorizada', expiresAt: exp, allowDownload: true }, at)).toEqual({ canPrint: true, canDownload: true });
    expect(copyActions({ status: 'autorizada', expiresAt: exp, allowDownload: true }, new Date('2027-01-01'))).toEqual({ canPrint: false, canDownload: false });
    expect(copyActions({ status: 'rechazada', expiresAt: null, allowDownload: false }, at)).toEqual({ canPrint: false, canDownload: false });
  });

  it('[SGC-REQ-129] la copia sale con la diagonal «COPIA NO CONTROLADA», quién la pidió, quién la autorizó y su vencimiento', async () => {
    const info = { code: 'OLP-GCC-02-FO01', versionNumber: 2, requesterEmail: 'ana@olp.co', authorizedBy: 'maria.camila@olp.co', authorizedAt: new Date('2026-10-08T15:00:00Z'), expiresAt: new Date('2026-11-08T04:59:59Z'), at: new Date('2026-10-09T13:30:00Z'), mode: 'impresion' as const, destination: 'Droguería X' };
    const lines = buildUncontrolledCopyLines(info);
    expect(lines.diagonal).toBe('COPIA NO CONTROLADA');
    expect(lines.footer).toContain('Solicitó ana@olp.co');
    expect(lines.footer).toContain('Autorizó maria.camila@olp.co el 2026-10-08 10:00');
    expect(lines.footer).toContain('Vence 2026-11-07');
    expect(lines.footer).toContain('Impresa 2026-10-09 08:30');
    expect(lines.header).toContain('Destino: Droguería X.');
    expect(buildUncontrolledCopyLines({ ...info, mode: 'descarga', destination: null }).footer).toContain('Descargada');
    const out = await PDFDocument.load(await stampUncontrolledCopy(await onePagePdf(), info), { updateMetadata: false });
    expect(out.getProducer()).toContain('copia NO controlada');
  });
});

describe('SGC · S11 · protección del visor', () => {
  it('[SGC-REQ-130] la marca en mosaico lleva correo, fecha y hora de Colombia e IP, y cubre toda la página', async () => {
    expect(tiledWatermarkText({ viewerEmail: 'lector@olp.co', at: new Date('2026-10-08T15:05:00Z'), ip: '10.1.2.3' })).toBe('lector@olp.co  ·  2026-10-08 10:05 (hora Colombia)  ·  IP 10.1.2.3');
    expect(tiledWatermarkText({ viewerEmail: 'lector@olp.co', at: new Date('2026-10-08T15:05:00Z'), ip: null })).not.toContain('IP');
    const pos = tilePositions(595, 842);
    expect(pos.length).toBeGreaterThan(20);
    expect(Math.min(...pos.map((p) => p.y))).toBeLessThan(0);
    expect(Math.max(...pos.map((p) => p.y))).toBeGreaterThan(842 - 110);
    const tiled = await stampControlledCopy(await onePagePdf(), { code: 'X', versionNumber: 1, viewerEmail: 'a@b.co', at: new Date(), mode: 'consulta', tiled: true, ip: '1.1.1.1' });
    const plain = await stampControlledCopy(await onePagePdf(), { code: 'X', versionNumber: 1, viewerEmail: 'a@b.co', at: new Date(), mode: 'consulta' });
    expect(tiled.length).toBeGreaterThan(plain.length);
  });

  it('[SGC-REQ-131] los eventos del visor solo se registran sobre recursos del SGC', () => {
    expect(viewerResourceOf('/api/sgc/documents/7/versions/11/file?modo=consulta')).toBe('/api/sgc/documents/7/versions/11/file');
    expect(viewerResourceOf('https://evil/x')).toBeNull();
    expect(viewerResourceOf('/api/sgc/<script>')).toBeNull();
    expect(viewerResourceOf(`/api/sgc/${'x'.repeat(400)}`)).toBeNull();
    expect(viewerResourceOf(5)).toBeNull();
  });
});
