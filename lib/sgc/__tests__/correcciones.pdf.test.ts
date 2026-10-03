import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { acceptedContentHashes, buildControlledPdf, buildControlledPdfWithLayout, verifyControlledPdf, type SgcManifest } from '../pdf/controlledPdf';
import {
  applySystemFieldTokens,
  buildChangeHistoryHtml,
  decodeLogoDataUrl,
  drawInstitutionalHeaders,
  firstPageHeaderGeometry,
  getLogoDataUrlError,
  hasChangeHistoryToken,
  institutionalSignatureBoxesPct,
  SGC_LOGO_MAX_BYTES,
  suggestInstitutionalPlacements,
  type SgcInstitutionalHeaderData,
} from '../pdf/institutional';
import { wrapDraftForPdf } from '../pdf/render';
import type { SgcPlacementParticipant } from '../signature/fields';
import { sha256HexOf } from '../signature/record';
import { emissionStampFor, stampControlledCopy } from '../watermark';
import { TINY_JPG_B64, TINY_PNG_B64 } from './fixtures/images';

/**
 * Correcciones de Calidad OLP (2026-10-02): FIRMAS ESTAMPADAS DENTRO DEL
 * DOCUMENTO, ENCABEZADO INSTITUCIONAL con campos de sistema, FECHA DE EMISIÓN
 * en cada copia controlada y REVISIÓN MENOR de Calidad en el manifiesto.
 * pdf-lib real; el texto se lee con pdf.js (como lo ve una persona).
 */

async function pdfText(bytes: Uint8Array, pageNumber: number): Promise<{ str: string; x: number; y: number }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  return (tc.items as { str: string; transform: number[] }[]).filter((i) => i.str).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
}
const joined = async (bytes: Uint8Array, page: number) => (await pdfText(bytes, page)).map((t) => t.str).join(' ');

async function contentPdf(pages = 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) pdf.addPage([595.28, 841.89]).drawText(`Cuerpo del procedimiento ${i + 1}`, { x: 60, y: 500, size: 12, font });
  return pdf.save();
}

const SHA = 'a'.repeat(64);
const BASE = 'b'.repeat(64);
const manifest = (over: Partial<SgcManifest> = {}): SgcManifest => ({
  schema: 'sgc-manifiesto-firmas/v1',
  company: 'ONE LATAM PHARMA',
  idCompany: 3,
  code: 'OLP-GC-PR-007',
  title: 'Procedimiento de prueba de firmas dentro del documento',
  versionNumber: 1,
  idRequest: 90,
  documentType: 'PR · Procedimiento',
  process: 'GC · Gestión de calidad',
  statusLabel: 'Aprobado — pendiente de divulgación',
  approvedAt: '2026-10-03T16:00:00.000Z',
  generatedAt: '2026-10-03T16:00:05.000Z',
  changeDescription: 'Emisión inicial.',
  signedContent: { name: 'Borrador editado en la app · revisión 2', sha256: SHA },
  signatures: [
    { uid: 'u-e', meaning: 'elaboro', meaningLabel: 'Elaboró', signerName: 'Elaboradora QA', signerEmail: 'elab@onelatampharma.com', signedAt: '2026-10-03T14:00:00.000Z', reason: 'Soy la autora.', authMethod: 'contrasena_synerlink', contentSha256: BASE, recordHash: '1'.repeat(64) },
    { uid: 'u-a', meaning: 'aprobo', meaningLabel: 'Aprobó', signerName: null, signerEmail: 'calidad@onelatampharma.com', signedAt: '2026-10-03T16:00:00.000Z', reason: 'Apruebo.', authMethod: 'contrasena_synerlink', contentSha256: SHA, recordHash: '2'.repeat(64) },
  ],
  verifyUrl: 'https://synerlink/process/sgc-documental/verificar?empresa=3&codigo=OLP-GC-PR-007&version=1',
  ...over,
});
const PNG = Uint8Array.from(Buffer.from(TINY_PNG_B64, 'base64'));
const header = (over: Partial<SgcInstitutionalHeaderData> = {}): SgcInstitutionalHeaderData => ({
  company: 'ONE LATAM PHARMA',
  title: 'Procedimiento de prueba de firmas dentro del documento con un título bastante largo para que se parta en varias líneas del encabezado',
  code: 'OLP-GC-PR-007',
  versionLabel: '1',
  process: 'GC · Gestión de calidad',
  documentType: 'Procedimiento',
  elaboro: ['Elaboradora QA (ANALISTA DE CALIDAD)'],
  reviso: [],
  aprobo: ['Calidad', 'Directora Técnica'],
  emissionText: 'Al quedar vigente',
  logo: { bytes: PNG, kind: 'png' },
  ...over,
});
const P: SgcPlacementParticipant[] = [
  { key: 'elaboracion:e@x.com', meaning: 'elaboro', name: 'E', email: 'e@x.com', role: 'Elaboró' },
  { key: 'revision:r@x.com', meaning: 'reviso', name: 'R', email: 'r@x.com', role: 'Revisó' },
  { key: 'aprobacion:a1@x.com', meaning: 'aprobo', name: 'A1', email: 'a1@x.com', role: 'Aprobó' },
  { key: 'aprobacion:grupo:SGC-VERIF-CALIDAD', meaning: 'aprobo', name: 'Calidad (grupo)', email: 'SGC-VERIF-CALIDAD', role: 'Aprobó' },
];

describe('SGC · correcciones · encabezado institucional', () => {
  it('[SGC-REQ-096] el sistema dibuja el encabezado de la plantilla de Calidad: logo, nombre, CÓDIGO, VERSIÓN, PÁGINA x DE y, ELABORÓ/REVISÓ/APROBÓ con recuadro «Firma», FECHA DE EMISIÓN y PROCESO; las demás páginas llevan el encabezado corto', async () => {
    const pdf = await PDFDocument.load(await contentPdf(3));
    const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
    const { emission } = await drawInstitutionalHeaders(pdf, pdf.getPages(), header(), fonts);
    const bytes = await pdf.save();
    const p1 = await joined(bytes, 1);
    for (const t of ['NOMBRE DEL DOCUMENTO', 'CÓDIGO: OLP-GC-PR-007', 'VERSIÓN: 1', 'PÁGINA 1 DE 3', 'ELABORÓ:', 'REVISÓ:', 'APROBÓ:', 'FECHA DE EMISIÓN:', 'Firma', 'Al quedar vigente', 'PROCESO: GC · Gestión de calidad', 'Elaboradora QA (ANALISTA DE CALIDAD)', 'Calidad, Directora Técnica', 'No aplica']) expect(p1).toContain(t);
    expect(await joined(bytes, 2)).toContain('PÁGINA 2 DE 3');
    expect(await joined(bytes, 3)).toContain('CÓDIGO: OLP-GC-PR-007 · VERSIÓN: 1');
    const g = firstPageHeaderGeometry(595.28, 841.89);
    expect(emission).toEqual({ x: g.emission.x + 1, y: g.emission.y + 1, width: g.emission.width - 2, height: g.emission.height - 2 });
    // El encabezado cabe en el margen superior que deja la plantilla (6,6 cm ≈ 187 pt).
    expect(841.89 - g.bottom).toBeLessThan(187);
  });

  it('[SGC-REQ-103] logo JPEG, logo ilegible (se usa el nombre de la empresa) y sin logo', async () => {
    for (const logo of [{ bytes: Uint8Array.from(Buffer.from(TINY_JPG_B64, 'base64')), kind: 'jpg' as const }, { bytes: new Uint8Array([1, 2, 3]), kind: 'png' as const }, null]) {
      const pdf = await PDFDocument.load(await contentPdf(1));
      const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
      await drawInstitutionalHeaders(pdf, pdf.getPages(), header({ logo, title: 'Corto' }), fonts);
      const text = await joined(await pdf.save(), 1);
      if (logo?.kind === 'jpg') expect(text).not.toContain('ONE LATAM PHARMA');
      else expect(text).toContain('ONE LATAM PHARMA');
    }
  });

  it('[SGC-REQ-096] los recuadros «Firma» son la ubicación sugerida: cada rol en el suyo y varias personas del mismo rol se reparten el recuadro', () => {
    const boxes = institutionalSignatureBoxesPct();
    expect(boxes.elaboro.x).toBeLessThan(boxes.reviso.x);
    expect(boxes.reviso.x).toBeLessThan(boxes.aprobo.x);
    expect(boxes.elaboro.y).toBeGreaterThan(10);
    expect(boxes.elaboro.y).toBeLessThan(25);
    const s = suggestInstitutionalPlacements(P, [{ id: 'x', signerKey: 'revision:r@x.com', meaning: 'reviso', page: 1, x: 1, y: 1, width: 20, height: 10, label: null }]);
    expect(s.map((f) => f.signerKey)).toEqual(['elaboracion:e@x.com', 'aprobacion:a1@x.com', 'aprobacion:grupo:SGC-VERIF-CALIDAD']);
    const [a1, cal] = s.slice(1);
    expect(a1.page).toBe(1);
    expect(cal.x).toBeCloseTo(a1.x + a1.width, 1);
    expect(a1.width).toBeCloseTo(boxes.aprobo.width / 2, 1);
    expect(s[0].label).toBe('Elaboró · E');
  });

  it('[SGC-REQ-097] campos de sistema del cuerpo e historial de cambios (con motivo); los valores se escapan y las marcas desconocidas no se tocan', () => {
    const history = buildChangeHistoryHtml([
      { versionNumber: 1, date: '2025-01-10', previousVersion: null, reason: 'Emisión inicial' },
      { versionNumber: 2, date: 'Al aprobar', previousVersion: 1, reason: 'Ajuste <menor> & coma' },
    ]);
    expect(history).toContain('<th>Motivo del cambio</th>');
    expect(history).toContain('<td>2</td><td>2</td><td>Al aprobar</td><td>1</td><td>Ajuste &lt;menor&gt; &amp; coma</td>');
    expect(history).toContain('<td>—</td>');
    const html = '<p>Código: {{CODIGO}} · V{{ VERSION }} · {{NOMBRE_DOCUMENTO}} · {{OTRA}}</p><p><strong>{{HISTORIAL_CAMBIOS}}</strong></p><p>Elaboró: {{ELABORO}}</p>';
    const out = applySystemFieldTokens(html, { CODIGO: 'OLP-GC-PR-007', VERSION: '2', NOMBRE_DOCUMENTO: 'A & B', ELABORO: 'Ana' }, history);
    expect(out).toContain('Código: OLP-GC-PR-007 · V2 · A &amp; B · {{OTRA}}');
    expect(out).toContain(`${history}<p>Elaboró: Ana</p>`);
    expect(out).not.toContain('<p><strong><table>');
    expect(applySystemFieldTokens('<li>{{HISTORIAL_CAMBIOS}}</li>', {}, '<table></table>')).toBe('<li><table></table></li>');
    expect(applySystemFieldTokens('<p>{{HISTORIAL_CAMBIOS}}</p>', {}, null)).toBe('<p>{{HISTORIAL_CAMBIOS}}</p>');
    expect(hasChangeHistoryToken('<p>{{ HISTORIAL_CAMBIOS }}</p>')).toBe(true);
    expect(hasChangeHistoryToken('<p>nada</p>')).toBe(false);
  });

  it('[SGC-REQ-096] con plantilla institucional el contenido deja arriba el espacio del encabezado (más alto en la primera página)', () => {
    const inst = wrapDraftForPdf({ title: 'T', code: 'C', contentHtml: '<p>x</p>', institutional: true });
    expect(inst).toContain('@page :first { margin-top: 6.6cm; }');
    expect(inst).toContain('margin: 2.8cm 2cm 2.2cm 2cm');
    expect(inst).toContain('img { max-width: 100%');
    expect(wrapDraftForPdf({ title: 'T', code: 'C', contentHtml: '<p>x</p>' })).toContain('@page { size: A4; margin: 2.2cm 2cm; }');
  });

  it('[SGC-REQ-103] el logo de la empresa se valida: PNG o JPEG real y de máximo 400 KB', () => {
    expect(decodeLogoDataUrl(`data:image/png;base64,${TINY_PNG_B64}`)?.kind).toBe('png');
    expect(decodeLogoDataUrl(`data:image/jpeg;base64,${TINY_JPG_B64}`)?.kind).toBe('jpg');
    expect(decodeLogoDataUrl(`data:image/png;base64,${Buffer.from('no es imagen').toString('base64')}`)).toBeNull();
    expect(decodeLogoDataUrl('https://sitio/logo.png')).toBeNull();
    expect(decodeLogoDataUrl(null)).toBeNull();
    expect(getLogoDataUrlError(5)).toMatch(/Cargue/);
    expect(getLogoDataUrlError('data:image/svg+xml;base64,PHN2Zz4=')).toMatch(/PNG o JPEG/);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), Buffer.alloc(SGC_LOGO_MAX_BYTES)]);
    expect(getLogoDataUrlError(`data:image/png;base64,${big.toString('base64')}`)).toMatch(/400 KB/);
    expect(getLogoDataUrlError(`data:image/png;base64,${TINY_PNG_B64}`)).toBeNull();
  });
});

describe('SGC · correcciones · firmas estampadas dentro del documento', () => {
  it('[SGC-REQ-094] cada firma queda estampada en la caja que ubicó el elaborador (nombre, significado, fecha y trazo); la portada solo lista las firmas sin ubicación y el final es el registro de trazabilidad', async () => {
    const m = manifest({ placements: [{ uid: 'u-e', page: 1, x: 10, y: 20, width: 30, height: 10 }, { uid: 'fantasma', page: 1, x: 1, y: 1, width: 20, height: 10 }, { uid: 'u-a', page: 9, x: 1, y: 1, width: 20, height: 10 }] });
    const { bytes, layout } = await buildControlledPdfWithLayout(await contentPdf(2), m, { 'u-e': PNG });
    expect(layout).toEqual({ institutionalHeader: false, emission: null, placements: [{ uid: 'u-e', page: 1, x: 10, y: 20, width: 30, height: 10 }] });
    const page2 = await pdfText(bytes, 2);
    const name = page2.find((t) => t.str === 'Elaboradora QA');
    expect(name).toBeTruthy();
    // Dentro de la caja: x entre 10 % y 40 % del ancho; y (desde abajo) entre 70 % y 80 % del alto.
    expect(name!.x).toBeGreaterThan(595.28 * 0.1);
    expect(name!.x).toBeLessThan(595.28 * 0.4);
    expect(name!.y).toBeGreaterThan(841.89 * 0.7);
    expect(name!.y).toBeLessThan(841.89 * 0.8);
    expect(page2.map((t) => t.str).join(' ')).toContain('Elaboró · 2026-10-03 09:00');
    const cover = await joined(bytes, 1);
    expect(cover).toContain('estampadas dentro del documento');
    expect(cover).toContain('Firmas sin ubicación en el documento');
    expect(cover).toContain('calidad@onelatampharma.com');
    expect(cover).not.toContain('Soy la autora.');
    const last = await joined(bytes, 4);
    expect(last).toContain('Registro de trazabilidad de firmas electrónicas');
  });

  it('[SGC-REQ-094] sin trazo del maestro (o con un trazo ilegible) la firma se estampa con el nombre; sin ubicaciones todo queda como antes (bloque en la portada)', async () => {
    const m = manifest({ placements: [{ uid: 'u-a', page: 2, x: 50, y: 50, width: 40, height: 12 }, { uid: 'u-e', page: 1, x: 5, y: 5, width: 20, height: 3 }] });
    const bytes = await buildControlledPdf(await contentPdf(2), m, { 'u-a': new Uint8Array([9, 9, 9]) });
    const p3 = (await pdfText(bytes, 3)).map((t) => t.str);
    expect(p3.filter((s) => s === 'calidad@onelatampharma.com').length).toBeGreaterThanOrEqual(2);
    expect((await joined(bytes, 1))).not.toContain('Firmas sin ubicación');
    const plain = await buildControlledPdf(await contentPdf(1), manifest());
    const cover = await joined(plain, 1);
    expect(cover).toContain('Firmas');
    expect(cover).toContain('Soy la autora.');
    expect(cover).not.toContain('estampadas dentro del documento');
    expect(await joined(plain, 2)).toContain('OLP-GC-PR-007 · Versión 1 ·');
  });

  it('[SGC-REQ-097] con encabezado institucional el PDF controlado guarda el recuadro de la fecha de emisión (página 2) y no repite el encabezado corto', async () => {
    const { bytes, layout } = await buildControlledPdfWithLayout(await contentPdf(1), manifest({ institutionalHeader: true }), {}, { header: header() });
    expect(layout.institutionalHeader).toBe(true);
    expect(layout.emission?.page).toBe(2);
    const p2 = await joined(bytes, 2);
    expect(p2).toContain('CÓDIGO: OLP-GC-PR-007');
    expect(p2).not.toContain('OLP-GC-PR-007 · Versión 1 ·');
    expect(p2).not.toContain('Documento controlado · Página');
  });

  it('[SGC-REQ-097] la FECHA DE EMISIÓN (= vigencia) se estampa en su recuadro en cada copia controlada; el PDF firmado no cambia', async () => {
    const { bytes, layout } = await buildControlledPdfWithLayout(await contentPdf(1), manifest(), {}, { header: header() });
    const sha = sha256HexOf(bytes);
    const vigente = emissionStampFor({ status: 'vigente', effective_date: new Date('2026-10-20T00:00:00Z'), layout_json: JSON.stringify(layout) });
    expect(vigente).toMatchObject({ page: 2, text: '2026-10-20' });
    expect(emissionStampFor({ status: 'borrador', effective_date: null, layout_json: JSON.stringify(layout) })?.text).toBe('Pendiente: en divulgación');
    expect(emissionStampFor({ status: 'anulado', effective_date: null, layout_json: JSON.stringify(layout) })?.text).toBe('Anulado: no fue emitido');
    expect(emissionStampFor({ status: 'vigente', effective_date: null, layout_json: JSON.stringify(layout) })?.text).toBe('Sin fecha de vigencia');
    expect(emissionStampFor({ status: 'vigente', effective_date: null, layout_json: null })).toBeUndefined();
    expect(emissionStampFor({ status: 'vigente', effective_date: null, layout_json: '{roto' })).toBeUndefined();
    expect(emissionStampFor({ status: 'vigente', effective_date: null, layout_json: JSON.stringify({ emission: { page: 2, x: 'a' } }) })).toBeUndefined();
    const copy = await stampControlledCopy(bytes, { code: 'OLP-GC-PR-007', versionNumber: 1, viewerEmail: 'lector@onelatampharma.com', at: new Date('2026-10-21T15:00:00Z'), mode: 'consulta', emission: vigente });
    const p2 = await joined(copy, 2);
    expect(p2).toContain('2026-10-20');
    // La fecha queda dentro del recuadro de la fecha de emisión (centrada en altura).
    const date = (await pdfText(copy, 2)).find((t) => t.str === '2026-10-20')!;
    expect(date.x).toBeGreaterThan(vigente!.x);
    expect(date.y).toBeGreaterThan(vigente!.y);
    expect(date.y).toBeLessThan(vigente!.y + vigente!.height);
    expect(sha256HexOf(bytes)).toBe(sha);
    // Recuadro de una página que no existe: no rompe la copia.
    await expect(stampControlledCopy(bytes, { code: 'X', versionNumber: 1, viewerEmail: 'a@b.co', at: new Date(), mode: 'consulta', emission: { ...vigente!, page: 99 } })).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('SGC · correcciones · revisión menor de Calidad en el manifiesto', () => {
  it('[SGC-REQ-102] la verificación acepta las firmas hechas sobre el contenido que corrigió una revisión menor declarada, y la portada la muestra', async () => {
    const minor = { revision: 3, baseSha256: BASE, newSha256: SHA, reason: 'Corrige una margen y una coma.', by: 'calidad@onelatampharma.com', at: '2026-10-03T15:00:00.000Z' };
    const m = manifest({ minorRevisions: [minor] });
    expect([...acceptedContentHashes(m)]).toEqual([SHA, BASE]);
    const bytes = await buildControlledPdf(await contentPdf(1), m);
    expect(await joined(bytes, 1)).toContain('Revisión menor de Calidad (3)');
    const sigs = [
      { uid: 'u-e', recordHash: '1'.repeat(64), contentSha256: BASE, intact: true },
      { uid: 'u-a', recordHash: '2'.repeat(64), contentSha256: SHA, intact: true },
    ];
    const ok = await verifyControlledPdf(bytes, { pdfSha256: sha256HexOf(bytes), manifestJson: JSON.stringify(m), signatures: sigs });
    expect(ok.ok).toBe(true);
    // Sin la revisión menor declarada, la firma sobre el contenido anterior NO vale.
    const sinMenor = manifest();
    const bytes2 = await buildControlledPdf(await contentPdf(1), sinMenor);
    const bad = await verifyControlledPdf(bytes2, { pdfSha256: sha256HexOf(bytes2), manifestJson: JSON.stringify(sinMenor), signatures: sigs });
    expect(bad.ok).toBe(false);
    expect(bad.signatures.find((s) => s.uid === 'u-e')?.problem).toMatch(/no corresponde al contenido/);
  });
});
