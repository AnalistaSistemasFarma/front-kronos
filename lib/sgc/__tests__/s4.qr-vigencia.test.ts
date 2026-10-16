import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { SgcError } from '../errors';
import { SGC_QR_SIZE, buildControlledPdf, verifyControlledPdf, type SgcManifest } from '../pdf/controlledPdf';
import { buildVerifyUrl, drawQr, qrMatrix } from '../pdf/qr';
import { sha256HexOf } from '../signature/record';
import { SGC_CONTENT_KINDS, SGC_CONTENT_KIND_LABELS } from '../signature/record';
import { buildWatermarkLines, stampControlledCopy } from '../watermark';

/** Sprint 4 — QR de verificación del PDF controlado y marca de versiones obsoletas (reglas puras). */

const AT = new Date('2026-10-01T15:00:00Z');

async function contentPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595.28, 841.89]).drawText('Contenido aprobado', { x: 50, y: 750, size: 12, font });
  return pdf.save();
}

const manifest = (verifyUrl: string): SgcManifest => ({
  schema: 'sgc-manifiesto-firmas/v1',
  company: 'ONE LATAM PHARMA',
  idCompany: 3,
  code: 'OLP-GC-PR-001',
  title: 'Procedimiento de control de documentos',
  versionNumber: 2,
  idRequest: 7,
  documentType: 'PR · Procedimiento',
  process: 'GC · Gestión de Calidad',
  statusLabel: 'Aprobado — pendiente de divulgación',
  approvedAt: AT.toISOString(),
  generatedAt: AT.toISOString(),
  changeDescription: 'Cambio de prueba',
  signedContent: { name: 'borrador.docx', sha256: 'a'.repeat(64) },
  signatures: [],
  verifyUrl,
});

/** Patrón buscador del QR (7×7) en la esquina (r, c). */
function isFinder(m: boolean[][], r: number, c: number): boolean {
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const ring = i === 0 || i === 6 || j === 0 || j === 6;
      const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
      if (m[r + i][c + j] !== (ring || core)) return false;
    }
  }
  return true;
}

describe('SGC · S4 · código QR de verificación', () => {
  it('[SGC-REQ-063] el QR lleva a la verificación de vigencia de ESA versión (empresa, código y versión)', () => {
    expect(buildVerifyUrl('https://synerlink.test///', 3, 'OLP-GC-PR-001', 2)).toBe('https://synerlink.test/process/sgc-documental/verificar?empresa=3&codigo=OLP-GC-PR-001&version=2');
    expect(buildVerifyUrl('https://s.test', 3, 'A B&C', 1)).toContain('codigo=A%20B%26C');
  });

  it('[SGC-REQ-063] la matriz es un QR estándar: cuadrada, versión según el largo y con sus tres patrones buscadores', () => {
    const m = qrMatrix('https://synerlink.test/process/sgc-documental/verificar?empresa=3&codigo=OLP-GC-PR-001&version=2');
    const n = m.length;
    expect(m.every((row) => row.length === n)).toBe(true);
    expect((n - 17) % 4).toBe(0);
    expect(isFinder(m, 0, 0) && isFinder(m, 0, n - 7) && isFinder(m, n - 7, 0)).toBe(true);
    expect(qrMatrix('a').length).toBe(21);
    expect(() => qrMatrix('')).toThrow(SgcError);
    expect(() => qrMatrix('x'.repeat(1201))).toThrow(SgcError);
  });

  it('[SGC-REQ-063] se dibuja en la página como vectores y el PDF controlado lo lleva en la portada sin romper su verificación', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    expect(drawQr(page, 'a', { x: 10, y: 10, size: 80 }).modules).toBe(21);
    const url = buildVerifyUrl('https://synerlink.test', 3, 'OLP-GC-PR-001', 2);
    const bytes = await buildControlledPdf(await contentPdf(), manifest(url));
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(3);
    expect(SGC_QR_SIZE).toBeGreaterThan(60);
    const v = await verifyControlledPdf(bytes, { pdfSha256: sha256HexOf(bytes), manifestJson: JSON.stringify(manifest(url)), signatures: [] });
    expect(v).toMatchObject({ pdfMatches: true, manifestMatches: true, manifestFound: true });
    // Sin URL de verificación (manifiestos antiguos) no se dibuja QR y la portada sigue saliendo.
    expect((await PDFDocument.load(await buildControlledPdf(await contentPdf(), manifest('')))).getPageCount()).toBe(3);
  });
});

describe('SGC · S4 · versiones obsoletas, anuladas y en divulgación', () => {
  const info = { code: 'OLP-GC-PR-001', versionNumber: 1, viewerEmail: 'ana@olp.co', at: AT, mode: 'consulta' as const };
  it('[SGC-REQ-062] el visor marca la versión obsoleta, anulada o en divulgación (diagonal y pie) sin cambiar la copia vigente', () => {
    expect(buildWatermarkLines(info).diagonal).toBe('COPIA CONTROLADA');
    expect(buildWatermarkLines({ ...info, state: 'vigente' }).footer.startsWith('COPIA CONTROLADA')).toBe(true);
    const obs = buildWatermarkLines({ ...info, state: 'obsoleto' });
    expect(obs.diagonal).toBe('OBSOLETO');
    expect(obs.footer).toMatch(/^DOCUMENTO OBSOLETO - NO VÁLIDO PARA USO · COPIA CONTROLADA/);
    expect(buildWatermarkLines({ ...info, state: 'anulado' }).diagonal).toBe('ANULADO');
    const div = buildWatermarkLines({ ...info, state: 'divulgacion' });
    expect(div.diagonal).toBe('EN DIVULGACIÓN');
    expect(div.footer).toContain('AÚN NO VIGENTE');
  });

  it('[SGC-REQ-062] estampar una versión obsoleta no altera el PDF guardado (su SHA-256 se conserva)', async () => {
    const original = await contentPdf();
    const before = sha256HexOf(original);
    const stamped = await stampControlledCopy(original, { ...info, state: 'obsoleto' });
    expect(sha256HexOf(original)).toBe(before);
    expect(sha256HexOf(stamped)).not.toBe(before);
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(1);
  });

  it('[SGC-REQ-056][SGC-REQ-060] la firma registra sobre qué contenido se firmó: PDF controlado (Leyó) o resultados de capacitación (Capacitó)', () => {
    expect(SGC_CONTENT_KINDS).toEqual(['borrador_adjunto', 'borrador_editor', 'pdf_controlado', 'resultados_capacitacion']);
    expect(SGC_CONTENT_KIND_LABELS.pdf_controlado).toMatch(/PDF controlado/);
    expect(SGC_CONTENT_KIND_LABELS.resultados_capacitacion).toMatch(/Forms/);
  });
});
