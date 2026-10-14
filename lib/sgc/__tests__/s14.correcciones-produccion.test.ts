import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildControlledPdfWithLayout, type SgcManifest } from '../pdf/controlledPdf';
import type { SgcInstitutionalHeaderData } from '../pdf/institutional';
import { isQualityVerificationPool, isQualityVerificationSlot } from '../signature/qualityVerification';
import { sgcStampPreviewOf } from '../signature/stampPreview';
import { SGC_TRAINING_RESULTS_TEMPLATE_CSV, attemptTime, evaluateTrainingResults, findHeaderRow, trainingResultsChangedMessage } from '../training/results';
import { parseCsv, readTrainingRows } from '../training/xlsx';
import { SGC_VIEWER_VEIL_TEXT, sgcViewerError } from '../viewerError';
import { emissionStampFor, stampControlledCopy } from '../watermark';

/**
 * S14 (2026-10-14): correcciones de la primera prueba del SGC en producción
 * con Calidad OLP (2026-10-13). Plan `sgc-plan-sprints-requerimientos-2026-10-13`:
 * R20 verificación de Calidad sin firma, R21 «Nombre del documento», R22 fecha
 * de emisión, R23 visor, R24 contraseña sin autocompletar (ver autofill.test),
 * R25 firma registrada igual en todos los pasos, R26 avisos, R28 calendario,
 * R29 resultados de Forms.
 */

const root = join(__dirname, '../../..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

async function pdfText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  return (tc.items as { str: string }[]).map((i) => i.str).join(' ');
}

async function contentPdf(pages = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) pdf.addPage([595.28, 841.89]).drawText(`Cuerpo del instructivo ${i + 1}`, { x: 60, y: 400, size: 12, font });
  return pdf.save();
}

const SHA = 'c'.repeat(64);
const manifest = (over: Partial<SgcManifest> = {}): SgcManifest => ({
  schema: 'sgc-manifiesto-firmas/v1',
  company: 'ONE LATAM PHARMA',
  idCompany: 3,
  code: 'OLP-GGC-IN-001',
  title: 'Instructivo de codificación documental',
  versionNumber: 1,
  idRequest: 1,
  documentType: 'IN · Instructivo',
  process: 'GGC · Gestión de garantía de calidad',
  statusLabel: 'Aprobado — pendiente de divulgación',
  approvedAt: '2026-10-13T16:33:00.000Z',
  generatedAt: '2026-10-13T16:33:05.000Z',
  changeDescription: 'Emisión inicial.',
  signedContent: { name: 'instructivo.docx', sha256: SHA },
  signatures: [{ uid: 'u-e', meaning: 'elaboro', meaningLabel: 'Elaboró', signerName: 'Elaboradora', signerEmail: 'e@x.co', signedAt: '2026-10-13T15:00:00.000Z', reason: 'Soy la autora.', authMethod: 'contrasena_synerlink', contentSha256: SHA, recordHash: '1'.repeat(64) }],
  verifyUrl: 'https://synerlink/process/sgc-documental/verificar?empresa=3&codigo=OLP-GGC-IN-001&version=1',
  ...over,
});
const header: SgcInstitutionalHeaderData = {
  company: 'ONE LATAM PHARMA',
  title: 'Instructivo de codificación documental',
  code: 'OLP-GGC-IN-001',
  versionLabel: '1',
  process: 'GGC · Gestión de garantía de calidad',
  documentType: 'Instructivo',
  elaboro: ['Elaboradora'],
  reviso: ['Revisora'],
  aprobo: ['Directora Técnica'],
  emissionText: 'Al quedar vigente',
  logo: null,
};

describe('[SGC-REQ-149] R20 · la verificación de Calidad es una lista de chequeo, no una firma del documento', () => {
  it('reconoce el cupo de grupo SGC-VERIF-CALIDAD de «Aprobó» (no una persona de Calidad nombrada ni la capacitación)', () => {
    expect(isQualityVerificationSlot({ user_email: null, pool_type_code: 'SGC-VERIF-CALIDAD', signature_meaning: 'aprobo' })).toBe(true);
    expect(isQualityVerificationSlot({ user_email: null, pool_type_code: 'SGC-VERIF-CALIDAD ', signature_meaning: null })).toBe(true);
    expect(isQualityVerificationSlot({ user_email: 'calidad@x.co', pool_type_code: null, signature_meaning: 'aprobo' })).toBe(false);
    expect(isQualityVerificationSlot({ user_email: null, pool_type_code: 'SGC-VERIF-CALIDAD', signature_meaning: 'capacito' })).toBe(false);
    expect(isQualityVerificationSlot({ user_email: null, pool_type_code: 'SGC-APROBACION', signature_meaning: 'aprobo' })).toBe(false);
    expect(isQualityVerificationPool('aprobo', 'SGC-VERIF-CALIDAD')).toBe(true);
    expect(isQualityVerificationPool('reviso', 'SGC-VERIF-CALIDAD')).toBe(false);
    expect(isQualityVerificationPool('aprobo', null)).toBe(false);
  });

  it('la composición y el PDF controlado dejan fuera ese cupo; su registro, su lista de chequeo y la auditoría siguen', () => {
    const layout = src('lib/sgc/db/layout.ts');
    expect(layout).toMatch(/t\.poolAuthorizationTypeCode && !isQualityVerificationPool\(meaning, t\.poolAuthorizationTypeCode\)/);
    const sig = src('lib/sgc/db/signatures.ts');
    expect(sig).toContain('const documentSignatures = signatures.filter(');
    // Todo lo que se compone usa documentSignatures; las validaciones del contenido siguen con todas.
    for (const use of ['cargoOf(db, request.id_company, documentSignatures', '[...documentSignatures]', 'signatures: documentSignatures.map(', 'for (const s of documentSignatures) {']) expect(sig).toContain(use);
    expect(sig).toContain('const offContent = signatures.filter(');
    expect(sig).toContain('const broken = signatures.filter(');
  });

  it('el formulario de firma lo dice y no ofrece estampar trazo', () => {
    expect(sgcStampPreviewOf('aprobo', true, { active: { imagePng: 'data:image/png;base64,AAA' }, pending: null })).toMatchObject({ kind: 'verificacion', body: expect.stringContaining('no se estampa') });
  });
});

describe('[SGC-REQ-150] R22 · fecha de emisión en su recuadro', () => {
  it('con una portada de varias páginas, el recuadro queda en la primera página del CONTENIDO (no en la 2 fija) y la copia lleva la fecha', async () => {
    const long = 'Cambio extenso de la prueba. '.repeat(260);
    const { bytes, layout } = await buildControlledPdfWithLayout(await contentPdf(2), manifest({ changeDescription: long }), {}, { header });
    const total = (await PDFDocument.load(bytes)).getPageCount();
    expect(layout.emission).not.toBeNull();
    expect(layout.emission!.page).toBeGreaterThan(2);
    // Esa página es la primera del contenido: trae el encabezado institucional.
    expect(await pdfText(bytes, layout.emission!.page)).toContain('FECHA DE EMISIÓN:');
    expect(await pdfText(bytes, layout.emission!.page - 1)).not.toContain('FECHA DE EMISIÓN:');
    expect(total).toBeGreaterThan(layout.emission!.page);
    const em = emissionStampFor({ status: 'vigente', effective_date: new Date('2026-10-13T00:00:00Z'), layout_json: JSON.stringify(layout) });
    const copy = await stampControlledCopy(bytes, { code: 'OLP-GGC-IN-001', versionNumber: 1, viewerEmail: 'calidad@x.co', at: new Date('2026-10-14T15:00:00Z'), mode: 'consulta', state: 'vigente', emission: em });
    expect(await pdfText(copy, layout.emission!.page)).toContain('2026-10-13');
  });

  it('con portada de una página sigue en la 2 (como el documento vigente de producción)', async () => {
    const { layout } = await buildControlledPdfWithLayout(await contentPdf(1), manifest(), {}, { header });
    expect(layout.emission?.page).toBe(2);
  });
});

describe('[SGC-REQ-148] R23 · el visor dice claramente qué pasa', () => {
  it('sin permiso (403/404) ofrece solicitar acceso; un error técnico, reintentar; la protección no es un permiso', () => {
    expect(sgcViewerError(404, 'Documento no encontrado')).toMatchObject({ kind: 'sin_permiso', title: 'No tiene permiso para consultar este documento' });
    expect(sgcViewerError(403, null).kind).toBe('sin_permiso');
    expect(sgcViewerError(500, 'El archivo guardado no coincide')).toMatchObject({ kind: 'tecnico', message: 'El archivo guardado no coincide' });
    expect(sgcViewerError(null, '')).toMatchObject({ kind: 'tecnico', message: expect.stringContaining('Intente de nuevo') });
    expect(sgcViewerError(401, null).title).toContain('sesión');
    expect(SGC_VIEWER_VEIL_TEXT).toContain('No es un problema de permisos');
    const viewer = src('components/sgc/SgcSecureViewer.tsx');
    expect(viewer).toContain("data-testid='sgc-visor-solicitar-acceso'");
    expect(viewer).toContain("data-testid='sgc-visor-mostrar'");
    expect(src('app/(hub)/process/sgc-documental/documentos/[id]/page.tsx')).toContain('requestAccessHref={sgcHref(`${SGC_BASE_URL}/accesos`');
    expect(src('app/(hub)/process/sgc-documental/accesos/page.tsx')).toContain(".get('documento')");
  });
});

describe('[SGC-REQ-155] R25 · la firma registrada se ve igual en la tarea y en Autorizaciones', () => {
  it('muestra el trazo validado que se estampará, o avisa que no hay (pendiente o sin registrar)', () => {
    expect(sgcStampPreviewOf('reviso', false, { active: { imagePng: 'data:image/png;base64,AAA' }, pending: null })).toMatchObject({ kind: 'trazo', imagePng: 'data:image/png;base64,AAA' });
    expect(sgcStampPreviewOf('aprobo', false, { active: null, pending: { imagePng: 'x' } })).toMatchObject({ kind: 'sin_trazo', body: expect.stringContaining('pendiente de validación') });
    expect(sgcStampPreviewOf('elaboro', false, { active: null, pending: null })).toMatchObject({ kind: 'sin_trazo', body: expect.stringContaining('No tiene una firma registrada') });
    // «Leyó» y «Capacitó» no se estampan en el documento; sin datos aún, nada.
    expect(sgcStampPreviewOf('leyo', false, { active: { imagePng: 'x' }, pending: null }).kind).toBe('none');
    expect(sgcStampPreviewOf('capacito', false, { active: { imagePng: 'x' }, pending: null }).kind).toBe('none');
    expect(sgcStampPreviewOf('aprobo', false, null).kind).toBe('none');
  });
  it('los dos caminos pasan la empresa y el cupo al mismo formulario (y el servidor usa el mismo signTask)', () => {
    expect(src('components/sgc/tareas/SgcRequestView.tsx')).toContain('idCompany={request.idCompany}');
    const aut = src('app/(hub)/process/sgc-documental/autorizaciones/page.tsx');
    expect(aut).toContain('idCompany={signFor.row.idCompany}');
    expect(aut).toContain('qualityVerification={Boolean(focus.myAction!.qualityVerification)}');
    expect(src('app/api/sgc/authorizations/[id]/sign/route.ts')).toContain('signTask(prisma, sgcSignatureDeps()');
    expect(src('app/api/sgc/tasks/[id]/sign/route.ts')).toContain('signTask(prisma, sgcSignatureDeps()');
  });
});

describe('[SGC-REQ-152] R26 · avisos de los cupos de grupo', () => {
  it('el cupo de grupo de una tarea que no es autorización avisa «Tarea documental asignada» y lleva a la tarea', () => {
    const req = src('lib/sgc/db/requests.ts');
    expect(req).toContain('title: taskDef.isAuthorization ? SGC_NOTIFICATION_TITLES.autorizacionPendiente : SGC_NOTIFICATION_TITLES.tareaAsignada, body, url: taskUrl(idTask), tag: `sgc-task-${idTask}-grupo`');
    expect(req).not.toContain("url: '/process/sgc-documental/autorizaciones'");
  });
});

describe('[SGC-REQ-153] R29 · carga de resultados de Forms más robusta', () => {
  const scope = ['ana@olp.co', 'beto@olp.co', 'caro@olp.co'];
  const opts = { maxScore: 10, minScorePct: 80, scopeEmails: scope, maxAttempts: 2 };

  it('calificación MANUAL sin «Total de puntos»: suma los «Puntos: <pregunta>»', () => {
    const rows = [
      ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Pregunta 1', 'Puntos: Pregunta 1', 'Comentarios: Pregunta 1', 'Pregunta 2', 'Puntos - Pregunta 2'],
      [1, '', '10/13/2026 11:50:00', 'ana@olp.co', 'Ana', 'a', 5, '', 'b', 4],
      [2, '', '10/13/2026 11:55:00', 'beto@olp.co', 'Beto', 'a', 2, '', 'b', '3'],
    ];
    const ev = evaluateTrainingResults(rows, opts);
    expect(Object.fromEntries(ev.results.map((r) => [r.email, [r.score, r.passed]]))).toEqual({ 'ana@olp.co': [9, true], 'beto@olp.co': [5, false] });
    expect(ev.summary.missing).toEqual(['caro@olp.co']);
  });

  it('Points: … en inglés; intentos por hora de finalización (también como número de serie de Excel)', () => {
    const rows = [
      ['Email', 'Name', 'Completion time', 'Points: Q1', 'Points: Q2'],
      ['ana@olp.co', 'Ana', 46308.5, 3, 3],
      ['ana@olp.co', 'Ana', 46308.4, 2, 2],
      ['ana@olp.co', 'Ana', 46308.6, 5, 5],
    ];
    const ev = evaluateTrainingResults(rows, opts);
    const ana = ev.results[0];
    // Cuentan los 2 primeros en orden de respuesta (4 y 6 puntos); el de 10 es un intento de más.
    expect(ana).toMatchObject({ attempts: 3, score: 6, attemptNumber: 2, extraAttempts: 1, passed: false, retrainingRequired: true });
    expect(attemptTime(46308.5)).toBe(Date.UTC(2026, 9, 13, 12, 0, 0));
    expect(attemptTime(12)).toBeNull();
  });

  it('encabezado que no está en la primera fila (título o filas vacías arriba)', () => {
    const rows = [['Resultados de la evaluación'], [], ['Correo electrónico', 'Total de puntos'], ['ana@olp.co', 8]];
    expect(findHeaderRow(rows)).toBe(2);
    expect(evaluateTrainingResults(rows, opts).summary).toMatchObject({ passed: 1, rows: 1 });
    expect(evaluateTrainingResults(rows, opts).summary.rejected).toEqual([]);
  });

  it('errores claros: qué columna falta y la plantilla; total vacío (calificación sin publicar); formulario anónimo', () => {
    expect(() => evaluateTrainingResults([['Nombre', 'Pregunta 1'], ['Ana', 'a']], opts)).toThrow(/«Correo electrónico».*«Total de puntos».*Plantilla estándar de resultados/);
    expect(() =>
      evaluateTrainingResults(
        [
          ['Correo electrónico', 'Total de puntos'],
          ['ana@olp.co', ''],
          ['beto@olp.co', ''],
        ],
        opts
      )
    ).toThrow(/Ninguna fila trae puntaje.*publique las puntuaciones/);
    expect(() =>
      evaluateTrainingResults(
        [
          ['Correo electrónico', 'Total de puntos'],
          ['anonymous', 8],
        ],
        opts
      )
    ).toThrow(/anónimo/);
  });

  it('la plantilla estándar se lee tal cual (CSV con «;» y BOM)', async () => {
    const rows = await readTrainingRows(new TextEncoder().encode(SGC_TRAINING_RESULTS_TEMPLATE_CSV), 'plantilla.csv');
    expect(parseCsv(SGC_TRAINING_RESULTS_TEMPLATE_CSV)[0]).toEqual(['Correo electrónico', 'Nombre', 'Total de puntos', 'Hora de finalización']);
    const ev = evaluateTrainingResults(rows, { ...opts, scopeEmails: ['persona@empresa.com'] });
    expect(ev.summary).toMatchObject({ passed: 1, inScope: 1 });
  });

  it('un Excel real de Forms (exceljs, con fechas y celdas de hipervínculo) se lee', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Total de puntos']);
    ws.addRow([1, new Date('2026-10-13T16:00:00Z'), new Date('2026-10-13T16:05:00Z'), { text: 'ana@olp.co', hyperlink: 'mailto:ana@olp.co' }, 'Ana', 9]);
    ws.addRow([2, new Date('2026-10-13T16:00:00Z'), new Date('2026-10-13T16:06:00Z'), 'beto@olp.co', 'Beto', '8 / 10']);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const ev = evaluateTrainingResults(await readTrainingRows(bytes, 'Evaluación.xlsx'), opts);
    expect(ev.summary).toMatchObject({ passed: 2, failed: 0, missing: ['caro@olp.co'] });
  });

  it('el 409 por resultados cambiados dice quién cargó qué y que la tarea se recarga; la justificación va en el mismo formulario', () => {
    const msg = trainingResultsChangedMessage({ fileName: 'Evaluación Daniel.xlsx', uploadedBy: 'subdireccion.reglamentaria@gsslatam.com', uploadedAt: new Date('2026-10-13T17:13:40Z'), passed: 1, failed: 0, missing: 0 });
    expect(msg).toContain('subdireccion.reglamentaria@gsslatam.com cargó «Evaluación Daniel.xlsx» el 2026-10-13 12:13 (hora Colombia)');
    expect(msg).toContain('La tarea se recargó');
    const view = src('components/sgc/tareas/SgcRequestView.tsx');
    expect(view).toContain('isSgcHttpError(e) && e.status === 409) reload();');
    expect(view).toContain("myAction.signatureMeaning === 'capacito' && data.training?.upload?.needsJustification");
    expect(src('components/sgc/signature/SgcSignModal.tsx')).toContain("data-testid='sgc-firma-justificacion'");
  });
});

describe('[SGC-REQ-154] R21 y R28 · «Nombre del documento» y fecha con calendario', () => {
  it('«Nombre del documento» reemplaza a «Asunto» en la solicitud, las listas y la vista', () => {
    for (const p of ['app/(hub)/process/sgc-documental/solicitudes/nueva/page.tsx', 'app/(hub)/process/sgc-documental/solicitudes/page.tsx', 'app/(hub)/process/sgc-documental/tareas/page.tsx', 'app/(hub)/process/sgc-documental/autorizaciones/page.tsx', 'components/sgc/tareas/SgcRequestView.tsx']) {
      const s = src(p);
      expect(s, p).toContain('Nombre del documento');
      expect(s, p).not.toMatch(/>\s*Asunto\s*</);
      expect(s, p).not.toContain("label='Asunto'");
    }
  });
  it('la fecha de la sesión y la de la recapacitación se eligen con calendario (campo de fecha, como los filtros de SynerLink)', () => {
    const card = src('components/sgc/tareas/SgcTrainingCard.tsx');
    expect(card).toMatch(/type='date' label='Fecha de la sesión'/);
    expect(card).toMatch(/type='date' label='Fecha'/);
    expect(card).not.toContain('AAAA-MM-DD');
  });
});
