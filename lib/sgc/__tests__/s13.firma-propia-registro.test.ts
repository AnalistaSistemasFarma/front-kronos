import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildControlledPdfWithLayout, readManifest, type SgcManifest, type SgcManifestSignature } from '../pdf/controlledPdf';
import { SGC_SIGNATURE_REGISTER_MIN, headerNames, institutionalSignatureBoxesPct, overflowMeanings, suggestInstitutionalPlacements, titularOf } from '../pdf/institutional';
import type { SgcPlacementParticipant } from '../signature/fields';
import {
  SGC_MASTER_STATUS_LABELS,
  SGC_SELF_SIGNATURE_DISABLED,
  clearLightBackground,
  fitScale,
  inkBoundsRgba,
  masterStatus,
  normalizeOwnSignature,
  validationDenial,
} from '../signature/ownSignature';
import { TINY_PNG_B64 } from './fixtures/images';

/**
 * Sprint 13 — FIRMA PROPIA con validación de Calidad (R13) y REGISTRO DE
 * FIRMAS cuando hay más firmantes que recuadros (R14).
 */
async function pdfText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  return (tc.items as { str: string }[]).map((i) => i.str).join(' ');
}

describe('SGC · S13 · firma propia', () => {
  it('[SGC-REQ-140] la persona registra SU firma: un correo distinto del de la sesión se rechaza (403); dibujada o imagen', () => {
    const img = 'data:image/png;base64,AAAA';
    expect(normalizeOwnSignature({ imagePng: ` ${img} `, method: 'dibujada' }, 'ana@olp.co')).toEqual({ imagePng: img, method: 'dibujada' });
    expect(normalizeOwnSignature({ imagePng: img, method: 'imagen', email: 'ANA@olp.co' }, 'ana@olp.co').method).toBe('imagen');
    expect(() => normalizeOwnSignature({ imagePng: img, method: 'dibujada', email: 'otra@olp.co' }, 'ana@olp.co')).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => normalizeOwnSignature({ imagePng: img, method: 'tipografia' }, 'ana@olp.co')).toThrow(/dibujada o una imagen/);
    expect(() => normalizeOwnSignature({ method: 'dibujada' }, 'ana@olp.co')).toThrow(/Dibuje o suba/);
    expect(() => normalizeOwnSignature(null, 'ana@olp.co')).toThrow(/dibujada o una imagen/);
    expect(SGC_SELF_SIGNATURE_DISABLED).toMatch(/Adriana Cárdenas/);
  });

  it('[SGC-REQ-141] una firma pendiente no firma; Calidad la valida una vez y nunca la suya; revocada pendiente = rechazada', () => {
    const now = new Date();
    expect(masterStatus({ validation_status: 'pendiente', revoked_at: null })).toBe('pendiente');
    expect(masterStatus({ validation_status: 'validada', revoked_at: null })).toBe('validada');
    expect(masterStatus({ validation_status: 'pendiente', revoked_at: now })).toBe('rechazada');
    expect(masterStatus({ validation_status: 'validada', revoked_at: now })).toBe('revocada');
    expect(SGC_MASTER_STATUS_LABELS.pendiente).toBe('Pendiente de validación');
    const row = { user_email: 'ana@olp.co', validation_status: 'pendiente', revoked_at: null, origin: 'propia' };
    expect(validationDenial(row, 'cal@olp.co')).toBeNull();
    expect(validationDenial(row, ' ANA@olp.co')).toMatch(/Nadie valida su propia firma/);
    expect(validationDenial({ ...row, validation_status: 'validada' }, 'cal@olp.co')).toMatch(/ya está validada/);
    expect(validationDenial({ ...row, revoked_at: now }, 'cal@olp.co')).toMatch(/revocada o rechazada/);
  });

  it('[SGC-REQ-140] la imagen subida se recorta a la tinta y el fondo claro queda transparente', () => {
    const w = 50;
    const h = 20;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 20; x < 30; x++) for (let y = 8; y < 12; y++) px.set([20, 20, 60, 255], (y * w + x) * 4);
    expect(inkBoundsRgba(px, w, h, { pad: 2 })).toEqual({ x: 18, y: 6, width: 14, height: 8 });
    expect(inkBoundsRgba(px, w, h, { pad: 50 })).toEqual({ x: 0, y: 0, width: 50, height: 20 });
    expect(inkBoundsRgba(new Uint8ClampedArray(w * h * 4).fill(255), w, h)).toBeNull();
    const transparent = new Uint8ClampedArray(w * h * 4);
    expect(inkBoundsRgba(transparent, w, h)).toBeNull();
    clearLightBackground(px);
    expect(px[3]).toBe(0);
    expect(px[(10 * w + 25) * 4 + 3]).toBe(255);
    expect(fitScale(1200, 300)).toBe(0.5);
    expect(fitScale(300, 900)).toBeCloseTo(1 / 3);
    expect(fitScale(100, 40)).toBe(1);
  });
});

const part = (key: string, meaning: 'elaboro' | 'reviso' | 'aprobo', name: string): SgcPlacementParticipant => ({ key, meaning, name, email: key.split(':').pop()!, role: meaning });

describe('SGC · S13 · registro de firmas', () => {
  it('[SGC-REQ-142] hasta 2 por recuadro como antes; con 3 o más, solo el TITULAR en el recuadro y el encabezado dice «y N más · ver registro de firmas»', () => {
    expect(SGC_SIGNATURE_REGISTER_MIN).toBe(3);
    expect(headerNames([])).toBe('No aplica');
    expect(headerNames(['A', 'B'])).toBe('A, B');
    expect(headerNames(['A', 'B', 'C', 'D'])).toBe('A y 3 más · ver registro de firmas');
    const two = [part('aprobacion:a1', 'aprobo', 'A1'), part('aprobacion:grupo:SGC-VERIF-CALIDAD', 'aprobo', 'Calidad')];
    const many = [part('aprobacion:grupo:SGC-VERIF-CALIDAD', 'aprobo', 'Calidad'), part('aprobacion:a1', 'aprobo', 'A1'), part('aprobacion:a2', 'aprobo', 'A2'), part('revision:r', 'reviso', 'R')];
    expect(overflowMeanings(two)).toEqual([]);
    expect(overflowMeanings(many)).toEqual(['aprobo']);
    expect(titularOf(many.filter((p) => p.meaning === 'aprobo'))?.key).toBe('aprobacion:a1');
    expect(titularOf([part('aprobacion:grupo:X', 'aprobo', 'G')])?.key).toBe('aprobacion:grupo:X');
    expect(suggestInstitutionalPlacements(two, []).filter((f) => f.meaning === 'aprobo')).toHaveLength(2);
    const box = institutionalSignatureBoxesPct().aprobo;
    const s = suggestInstitutionalPlacements(many, []).filter((f) => f.meaning === 'aprobo');
    expect(s.map((f) => f.signerKey)).toEqual(['aprobacion:a1']);
    expect(s[0].width).toBeCloseTo(box.width, 1);
  });

  const sig = (i: number, meaning = 'aprobo'): SgcManifestSignature => ({ uid: `u-${i}`, meaning, meaningLabel: meaning === 'aprobo' ? 'Aprobó' : 'Elaboró', signerName: `Firmante ${i}`, signerEmail: `f${i}@olp.co`, signedAt: '2026-11-20T15:00:00.000Z', reason: 'Apruebo', authMethod: 'contrasena_synerlink', contentSha256: 'a'.repeat(64), recordHash: String(i % 10).repeat(64), ...(i === 2 ? { onBehalfOf: 'titular@olp.co' } : {}) });
  const manifest = (signatures: SgcManifestSignature[], over: Partial<SgcManifest> = {}): SgcManifest => ({
    schema: 'sgc-manifiesto-firmas/v1',
    company: 'ONE LATAM PHARMA',
    idCompany: 3,
    code: 'OLP-GC-PR-013',
    title: 'Procedimiento con muchos aprobadores',
    versionNumber: 1,
    idRequest: 91,
    documentType: 'PR · Procedimiento',
    process: 'GC · Gestión de calidad',
    statusLabel: 'Aprobado — pendiente de divulgación',
    approvedAt: '2026-11-20T16:00:00.000Z',
    generatedAt: '2026-11-20T16:00:05.000Z',
    changeDescription: 'Emisión inicial.',
    signedContent: { name: 'Borrador', sha256: 'a'.repeat(64) },
    signatures,
    verifyUrl: 'https://x/verificar',
    ...over,
  });
  const content = async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText('Cuerpo', { x: 60, y: 500, size: 12, font });
    return pdf.save();
  };

  it('[SGC-REQ-143] la página «Registro de firmas» va al final del contenido con un recuadro por firmante (nombre, cargo, significado, fecha, trazo y sustitución); varias páginas si no caben', async () => {
    const PNG = Uint8Array.from(Buffer.from(TINY_PNG_B64, 'base64'));
    const sigs = [sig(0, 'elaboro'), sig(1), sig(2), sig(3)];
    const plain = await buildControlledPdfWithLayout(await content(), manifest(sigs));
    const withReg = await buildControlledPdfWithLayout(await content(), manifest(sigs, { signatureRegister: ['u-1', 'u-2', 'u-3'] }), { 'u-1': PNG }, { registerCargos: { 'u-1': 'DIRECTORA TÉCNICA' } });
    const pagesPlain = (await PDFDocument.load(plain.bytes)).getPageCount();
    const pagesReg = (await PDFDocument.load(withReg.bytes)).getPageCount();
    expect(pagesReg).toBe(pagesPlain + 1);
    // Portada (1) + contenido (2) + registro (3).
    const reg = await pdfText(withReg.bytes, 3);
    expect(reg).toContain('REGISTRO DE FIRMAS');
    expect(reg).toContain('CÓDIGO: OLP-GC-PR-013 · VERSIÓN: 1');
    expect(reg).toContain('Firmante 1');
    expect(reg).toContain('Cargo: DIRECTORA TÉCNICA');
    expect(reg).toContain('Firmante 2 en sustitución de titular@olp.co');
    expect(reg).not.toContain('Firmante 0');
    expect((await readManifest(withReg.bytes))?.signatureRegister).toEqual(['u-1', 'u-2', 'u-3']);
    // Muchos firmantes: el registro ocupa varias páginas.
    const lots = Array.from({ length: 14 }, (_, i) => sig(i + 1));
    const big = await buildControlledPdfWithLayout(await content(), manifest(lots, { signatureRegister: lots.map((s) => s.uid) }));
    const bigPlain = await buildControlledPdfWithLayout(await content(), manifest(lots));
    expect((await PDFDocument.load(big.bytes)).getPageCount() - (await PDFDocument.load(bigPlain.bytes)).getPageCount()).toBe(2);
  });
});

describe('SGC · S13 · paquete de validación', () => {
  it('[SGC-REQ-145] el runbook, el respaldo y la CI incluyen las migraciones, datos y reversas del S8 al S13', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    const runbook = read('docs/sgc/runbook-pase-produccion.md');
    const ci = read('.github/workflows/ci.yml');
    const migrations = fs.readdirSync(path.join(process.cwd(), 'prisma/migrations')).filter((d) => /^2026100[8-9]\d+_sgc_s(8|9|10|11|12|13)_/.test(d));
    expect(migrations).toHaveLength(6);
    for (const m of migrations) {
      expect(runbook).toContain(m);
      expect(ci).toContain(`migra ${m}`);
    }
    const reversas = fs.readdirSync(path.join(process.cwd(), 'prisma/manual')).filter((f) => /^2026-10-08-sgc-s(8|9|10|11|12|13)-.*-reversa\.sql$/.test(f));
    expect(reversas).toHaveLength(6);
    for (const r of reversas) expect(runbook).toContain(r);
    expect(runbook).toContain('2026-10-08-sgc-s13-firma-propia-encender-olp.sql');
    expect(runbook).toMatch(/Adriana Cárdenas/);
    expect(read('scripts/sgc/respaldo/verificar.mjs')).toContain("['signer_substitution', 'reason']");
  });
});
