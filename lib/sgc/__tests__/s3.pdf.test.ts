import { PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { draftFormatOf, getDraftForSubmitError, pickCurrentDraft } from '../draft/current';
import { draftPlainText, getDraftHtmlError, sanitizeDraftHtml } from '../draft/html';
import { buildControlledPdf, manifestSha256, readManifest, SGC_MANIFEST_KEY, verifyControlledPdf, type SgcManifest } from '../pdf/controlledPdf';
import { wrapDraftForPdf } from '../pdf/render';
import { sha256HexOf } from '../signature/record';

/**
 * Sprint 3 — PDF CONTROLADO (portada de control, encabezado/pie por página y
 * manifiesto de firmas verificable), borrador vigente y limpieza del HTML del
 * editor. pdf-lib real, sin red.
 */

async function contentPdf(pages = 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) pdf.addPage([595.28, 841.89]).drawText(`Contenido del procedimiento, página ${i + 1}`, { x: 60, y: 700, size: 12, font });
  return pdf.save();
}

const SHA = 'e'.repeat(64);
const manifest = (over: Partial<SgcManifest> = {}): SgcManifest => ({
  schema: 'sgc-manifiesto-firmas/v1',
  company: 'ONE LATAM PHARMA',
  idCompany: 3,
  code: 'OLP-GC-PR-001',
  title: 'Procedimiento de control de documentos con un título largo que debe partirse en varias líneas para caber en la portada',
  versionNumber: 2,
  idRequest: 55,
  documentType: 'PR · Procedimiento',
  process: 'GC · Gestión de calidad',
  statusLabel: 'Aprobado — pendiente de divulgación',
  approvedAt: '2026-10-01T16:00:00.000Z',
  generatedAt: '2026-10-01T16:00:05.000Z',
  changeDescription: 'Se ajusta el alcance.',
  signedContent: { name: 'Borrador editado en la app · revisión 3', sha256: SHA },
  signatures: [
    { uid: 'u-1', meaning: 'elaboro', meaningLabel: 'Elaboró', signerName: 'Elaboradora QA', signerEmail: 'qa.sgc@gsslatam.com', signedAt: '2026-10-01T14:00:00.000Z', reason: 'Soy el autor del documento y lo envío a revisión.', authMethod: 'contrasena_synerlink', contentSha256: SHA, recordHash: '1'.repeat(64) },
    { uid: 'u-2', meaning: 'aprobo', meaningLabel: 'Aprobó', signerName: null, signerEmail: 'qa.sgc3@gsslatam.com', signedAt: '2026-10-01T16:00:00.000Z', reason: 'Apruebo el documento para su emisión.', authMethod: 'otro', contentSha256: SHA, recordHash: '2'.repeat(64) },
  ],
  verifyUrl: 'https://synerlink/process/sgc-documental/listado?empresa=3&q=OLP-GC-PR-001',
  ...over,
});

// PNG 1x1 válido (trazo del maestro de firmas).
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('SGC · S3 · PDF controlado con manifiesto de firmas', () => {
  it('[SGC-REQ-045] arma portada de control + contenido con encabezado/pie + manifiesto, e incrusta el manifiesto legible por máquina', async () => {
    const m = manifest();
    const bytes = await buildControlledPdf(await contentPdf(2), m, { 'u-1': PNG, 'u-2': new Uint8Array([1, 2, 3]) });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4); // portada + 2 de contenido + manifiesto
    expect(pdf.getTitle()).toContain('OLP-GC-PR-001 V2');
    expect(pdf.getKeywords()).toContain(`manifiesto:${manifestSha256(m)}`);
    expect(await readManifest(bytes)).toEqual(m);
    expect(sha256HexOf(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[SGC-REQ-046] el PDF verifica contra lo registrado; alterar UN byte o el manifiesto invalida la verificación', async () => {
    const m = manifest();
    const bytes = await buildControlledPdf(await contentPdf(1), m);
    const sha = sha256HexOf(bytes);
    const sigs = m.signatures.map((s) => ({ uid: s.uid, recordHash: s.recordHash, contentSha256: s.contentSha256, intact: true }));
    const ok = await verifyControlledPdf(bytes, { pdfSha256: sha, manifestJson: JSON.stringify(m), signatures: sigs });
    expect(ok).toMatchObject({ ok: true, pdfMatches: true, manifestFound: true, manifestMatches: true, problems: [] });
    expect(ok.signatures.every((s) => s.ok)).toBe(true);

    const tampered = new Uint8Array(bytes);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    const bad = await verifyControlledPdf(tampered, { pdfSha256: sha, manifestJson: JSON.stringify(m), signatures: sigs });
    expect(bad.ok).toBe(false);
    expect(bad.pdfMatches).toBe(false);
    expect(bad.problems[0]).toMatch(/alterado/);

    const otherManifest = await verifyControlledPdf(bytes, { pdfSha256: sha, manifestJson: JSON.stringify({ ...m, title: 'otro' }), signatures: sigs });
    expect(otherManifest).toMatchObject({ ok: false, manifestMatches: false });

    const brokenSig = await verifyControlledPdf(bytes, {
      pdfSha256: sha,
      manifestJson: JSON.stringify(m),
      signatures: [{ ...sigs[0], intact: false }, { ...sigs[1], recordHash: '9'.repeat(64) }],
    });
    expect(brokenSig.signatures.map((s) => s.problem)).toEqual([expect.stringMatching(/alterado/), expect.stringMatching(/no coincide/)]);
    const missing = await verifyControlledPdf(bytes, { pdfSha256: sha, manifestJson: JSON.stringify(m), signatures: [{ ...sigs[0], contentSha256: 'f'.repeat(64) }] });
    expect(missing.signatures.map((s) => s.problem)).toEqual([expect.stringMatching(/contenido/), expect.stringMatching(/no existe/)]);
  });

  it('[SGC-REQ-046] un PDF sin manifiesto (o con uno ajeno) no pasa la verificación', async () => {
    const plain = await contentPdf(1);
    expect(await readManifest(plain)).toBeNull();
    expect(await readManifest(new Uint8Array([1, 2, 3]))).toBeNull();
    const r = await verifyControlledPdf(plain, { pdfSha256: sha256HexOf(plain), manifestJson: null, signatures: [] });
    expect(r).toMatchObject({ ok: false, manifestFound: false, manifestSha256: null });
    const alien = await PDFDocument.load(plain);
    alien.catalog.set(PDFName.of(SGC_MANIFEST_KEY), PDFHexString.fromText(JSON.stringify({ schema: 'otro' })));
    expect(await readManifest(await alien.save())).toBeNull();
    const empty = await buildControlledPdf(plain, manifest({ signatures: [], changeDescription: null }));
    const e = await verifyControlledPdf(empty, { pdfSha256: sha256HexOf(empty), manifestJson: JSON.stringify(manifest({ signatures: [], changeDescription: null })), signatures: [] });
    expect(e.problems).toContain('El manifiesto no tiene firmas.');
  });

  it('[SGC-REQ-045] un manifiesto con muchas firmas pagina sin perder datos', async () => {
    const many = manifest({ signatures: Array.from({ length: 12 }, (_, i) => ({ ...manifest().signatures[0], uid: `u-${i}`, reason: `Motivo ${i} `.repeat(12) })) });
    const bytes = await buildControlledPdf(await contentPdf(1), many);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(4);
    expect((await readManifest(bytes))!.signatures).toHaveLength(12);
  });
});

describe('SGC · S3 · borrador vigente (lo que se firma) y edición en la app', () => {
  const att = (id: number, at: string, extra: Partial<{ purpose: string; withdrawn_at: Date | null; file_name: string }> = {}) => ({
    id_attachment: id,
    purpose: 'borrador',
    file_name: `B${id}.docx`,
    item_id: `it-${id}`,
    sha256: 'A'.repeat(64),
    created_at: new Date(at),
    withdrawn_at: null,
    ...extra,
  });
  const rev = (id: number, n: number, at: string) => ({ id_draft_revision: id, revision_number: n, sha256: 'b'.repeat(64), saved_at: new Date(at) });

  it('[SGC-REQ-047] manda lo más reciente: el último archivo no retirado o la última revisión del editor', () => {
    expect(pickCurrentDraft([], [])).toBeNull();
    const a = pickCurrentDraft([att(1, '2026-10-01T10:00:00Z'), att(2, '2026-10-01T11:00:00Z'), att(3, '2026-10-01T12:00:00Z', { withdrawn_at: new Date() }), att(4, '2026-10-01T13:00:00Z', { purpose: 'soporte' })], []);
    expect(a).toMatchObject({ kind: 'borrador_adjunto', ref: 'adjunto:2', format: 'docx', sha256: 'a'.repeat(64), itemId: 'it-2' });
    const r = pickCurrentDraft([att(2, '2026-10-01T11:00:00Z')], [rev(7, 1, '2026-10-01T09:00:00Z'), rev(8, 2, '2026-10-01T12:00:00Z')]);
    expect(r).toMatchObject({ kind: 'borrador_editor', ref: 'revision:8', format: 'html', itemId: null, name: expect.stringContaining('revisión 2') });
    expect(pickCurrentDraft([att(2, '2026-10-01T13:00:00Z')], [rev(8, 2, '2026-10-01T12:00:00Z')])).toMatchObject({ ref: 'adjunto:2' });
    expect(pickCurrentDraft([], [rev(8, 2, '2026-10-01T12:00:00Z')])).toMatchObject({ ref: 'revision:8' });
    expect(pickCurrentDraft([att(5, '2026-10-01T10:00:00Z'), att(6, '2026-10-01T10:00:00Z')], [])!.ref).toBe('adjunto:6');
    expect(draftFormatOf('X.PDF')).toBe('pdf');
    expect(draftFormatOf('x.doc')).toBe('doc');
    expect(draftFormatOf('x.txt')).toBeNull();
    expect(pickCurrentDraft([att(9, '2026-10-01T10:00:00Z', { file_name: 'raro.bin' })], [])!.format).toBe('pdf');
  });

  it('[SGC-REQ-047] para enviar a revisión el borrador debe servir para el PDF controlado (PDF, .docx o editor)', () => {
    expect(getDraftForSubmitError(null)).toMatch(/Cargue el borrador del documento/);
    expect(getDraftForSubmitError(pickCurrentDraft([att(1, '2026-10-01T10:00:00Z', { file_name: 'viejo.doc' })], []))).toMatch(/\.doc/);
    expect(getDraftForSubmitError(pickCurrentDraft([att(1, '2026-10-01T10:00:00Z')], []))).toBeNull();
  });

  it('[SGC-REQ-048] el HTML del editor se limpia con lista blanca: sin scripts, estilos, atributos ni recursos externos', () => {
    const dirty =
      '<h1 onclick="x()">Título</h1><script>alert(1)</script><p style="color:red">Texto <strong>fuerte</strong> & <em>más</em> <a href="http://mal">enlace</a></p>' +
      '<!-- comentario --><img src="http://x/y.png"><table><tr><td colspan="2" onmouseover="z">A</td><th rowspan=3>B</th></tr></table><iframe src="x">oculto</iframe><br/><ul><li>uno<li>dos</ul></p><svg><script>1</script></svg>fin <';
    const clean = sanitizeDraftHtml(dirty);
    expect(clean).toBe('<h1>Título</h1><p>Texto <strong>fuerte</strong> &amp; <em>más</em> enlace</p><table><tr><td colspan="2">A</td><th rowspan="3">B</th></tr></table><br><ul><li>uno<li>dos</li></li></ul>fin');
    expect(clean).not.toMatch(/script|onclick|style|href|img|iframe|svg/);
    expect(sanitizeDraftHtml('<style>body{}</style>texto &amp; &#169; <x-unknown>ok</x-unknown>')).toBe('texto &amp; &#169; ok');
    expect(sanitizeDraftHtml('<script>sin cierre')).toBe('');
    expect(sanitizeDraftHtml('<br/>')).toBe('<br>');
    expect(sanitizeDraftHtml('<script/>visible')).toBe('visible');
    expect(sanitizeDraftHtml(null as never)).toBe('');
    expect(draftPlainText('<p>Hola&nbsp;<b>mundo</b></p>')).toBe('Hola mundo');
    expect(getDraftHtmlError(5)).toMatch(/inválido/);
    expect(getDraftHtmlError('<p>corto</p>')).toMatch(/vacío/);
    expect(getDraftHtmlError(`<p>${'x'.repeat(7 * 1024 * 1024)}</p>`)).toMatch(/6 MB/);
    expect(getDraftHtmlError('<h1>Procedimiento</h1><p>Contenido suficiente del borrador.</p>')).toBeNull();
  });

  it('[SGC-REQ-048] el documento imprimible escapa el título y solo lleva el HTML limpio', () => {
    const html = wrapDraftForPdf({ title: 'Título <raro> & "comillas"', code: 'OLP-X', contentHtml: '<p>Hola</p><script>x</script>' });
    expect(html).toContain('<title>Título &lt;raro&gt; &amp; &quot;comillas&quot;</title>');
    expect(html).toContain('<body><p>Hola</p></body>');
    expect(html).not.toContain('<script>');
  });
});
