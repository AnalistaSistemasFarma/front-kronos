import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { normalizeHeaderTemplateConfig, type SgcHeaderTemplateConfig } from '../../lib/sgc/headerTemplates';
import { drawInstitutionalHeaders } from '../../lib/sgc/pdf/institutional';

/**
 * Documentos PADRE e HIJOS y ENCABEZADO CON GRILLA (2026-10-19), con las APIs
 * del SGC simuladas (`page.route`) como e2e/correo: árbol del auditor con el
 * visor sin descarga, arrastrar un hijo sobre su padre en el mapa (con
 * confirmación), el botón accesible «Relacionar con padre» en el celular, el
 * tipo padre en Configuración y en la solicitud, y el editor de la grilla con
 * la vista previa REAL (el PDF lo dibuja la misma función que compone el
 * documento controlado). Datos de EJEMPLO con la nomenclatura del listado de
 * Calidad. Con `SGC_CAPTURAS=<carpeta>` guarda las capturas de la revisión.
 */

const CAPTURAS = process.env.SGC_CAPTURAS;
const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL) && process.env.E2E_SIMULADO !== '1';
const EMPRESA = 3;
const company = { idCompany: EMPRESA, companyName: 'ONE LATAM PHARMA', canRead: true, canManage: true, canQuality: true, canAdminFlows: true };

type N = { id: number; code: string; title: string; type: string; x: number; y: number; v?: number };
const DOCS: N[] = [
  { id: 1, code: 'OLP-GGC-01-PR', title: 'Procedimiento control de documentos y registros', type: 'PR', x: 0, y: 0, v: 3 },
  { id: 2, code: 'OLP-GGC-02-PR', title: 'Procedimiento de devolución', type: 'PR', x: 380, y: 0, v: 2 },
  { id: 3, code: 'OLP-GGC-03-PR', title: 'Procedimiento de auditorías y autoinspecciones', type: 'PR', x: 760, y: 0 },
  { id: 4, code: 'OLP-GGC-01-FR-001', title: 'Listado maestro de documentos internos', type: 'FR', x: -120, y: 200 },
  { id: 5, code: 'OLP-GGC-01-FR-002', title: 'Listado maestro de documentos externos', type: 'FR', x: 140, y: 200 },
  { id: 6, code: 'OLP-GGC-01-IN-001', title: 'Instructivo de codificación documental', type: 'IN', x: 10, y: 330, v: 2 },
  { id: 7, code: 'OLP-GGC-02-FR-001', title: 'Formato de devolución de producto', type: 'FR', x: 380, y: 200 },
  { id: 8, code: 'OLP-GGC-02-IN-001', title: 'Instructivo de estados para devoluciones en SAP', type: 'IN', x: 400, y: 330 },
  { id: 9, code: 'OLP-GGC-01-FR-004', title: 'Divulgación de documentos', type: 'FR', x: 760, y: 330 },
  { id: 10, code: 'OLP-GGC-03-FR-001', title: 'Formato plan de auditoría', type: 'FR', x: 760, y: 460 },
  { id: 11, code: 'OLP-SEM-02-MN', title: 'Manual de tecnovigilancia', type: 'MN', x: 1100, y: 0 },
];
const TYPE_IDS: Record<string, number> = { MN: 1, PR: 2, IN: 3, FR: 4 };

function graph(extraEdges: { source: number; target: number; type: string }[] = []) {
  const edges = [
    { source: 4, target: 1, type: 'formato' },
    { source: 5, target: 1, type: 'formato' },
    { source: 1, target: 6, type: 'procedimiento_padre' },
    { source: 7, target: 2, type: 'formato' },
    { source: 2, target: 8, type: 'procedimiento_padre' },
    ...extraEdges,
  ];
  return {
    nodes: DOCS.map((d) => ({
      id: d.id,
      code: d.code,
      title: d.title,
      versionNumber: d.v ?? 1,
      status: 'vigente',
      idProcessType: d.code.includes('SEM') ? 2 : 1,
      processTypeCode: d.code.includes('SEM') ? 'M' : 'S',
      processType: d.code.includes('SEM') ? 'Procesos misionales' : 'Procesos de soporte',
      processTypeColor: d.code.includes('SEM') ? 'teal' : 'blue',
      idProcess: d.code.includes('SEM') ? 2 : 1,
      process: d.code.includes('SEM') ? 'SEM · Seguridad del paciente' : 'GGC · Gestión de garantía de calidad',
      idDepartment: null,
      idDocumentType: TYPE_IDS[d.type],
      documentTypeCode: d.type,
      currentVersionId: d.id * 10,
    })),
    edges: edges.map((e, i) => ({ id: i + 1, ...e, note: null })),
    layout: Object.fromEntries(DOCS.map((d) => [String(d.id), { x: d.x, y: d.y }])),
    processTypeOrder: [1, 2],
    parentTypeCodes: ['PR'],
  };
}

const docTypes = [
  { id: 1, code: 'MN', name: 'Manual', pluralName: 'Manuales', requiresTraining: true, reviewMonths: 36, alertMonths: 2, sortOrder: 1, isActive: true, idHeaderTemplate: null, draftExtensions: ['docx'], generatorGuide: false, isParentType: false },
  { id: 2, code: 'PR', name: 'Procedimiento', pluralName: 'Procedimientos', requiresTraining: true, reviewMonths: 36, alertMonths: 2, sortOrder: 2, isActive: true, idHeaderTemplate: null, draftExtensions: ['docx'], generatorGuide: false, isParentType: false },
  { id: 3, code: 'IN', name: 'Instructivo', pluralName: 'Instructivos', requiresTraining: true, reviewMonths: 36, alertMonths: 2, sortOrder: 3, isActive: true, idHeaderTemplate: null, draftExtensions: ['docx'], generatorGuide: false, isParentType: false },
  { id: 4, code: 'FR', name: 'Formato', pluralName: 'Formatos', requiresTraining: false, reviewMonths: 36, alertMonths: 2, sortOrder: 4, isActive: true, idHeaderTemplate: null, draftExtensions: ['docx', 'xlsx'], generatorGuide: false, isParentType: false },
];
const catalogs = {
  idCompany: EMPRESA,
  storageRoot: 'SGC/OLP',
  codingGuide: { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}-{TIPO}', sequenceDigits: 2, childPattern: '{PREFIJO}-{PROCESO}-{NUMERO_PADRE}-{TIPO}-{CONSECUTIVO}', childTypeCodes: ['FR', 'IN'], childSequenceDigits: 3, updatedBy: 'calidad@onelatampharma.com', updatedAt: '2026-10-19T12:00:00Z' },
  processTypes: [
    { id: 1, code: 'S', name: 'Procesos de soporte', color: 'blue', sortOrder: 1, isActive: true },
    { id: 2, code: 'M', name: 'Procesos misionales', color: 'teal', sortOrder: 2, isActive: true },
  ],
  processes: [
    { id: 1, idProcessType: 1, code: 'GGC', name: 'Gestión de garantía de calidad', idDepartment: null, department: null, sortOrder: 1, isActive: true },
    { id: 2, idProcessType: 2, code: 'SEM', name: 'Seguridad del paciente', idDepartment: null, department: null, sortOrder: 2, isActive: true },
  ],
  documentTypes: docTypes,
  parentTypeCodes: ['PR'],
  departments: [],
};

async function samplePdf(config: SgcHeaderTemplateConfig | null, title = 'Procedimiento control de documentos y registros'): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const pages = [pdf.addPage([595.28, 841.89]), pdf.addPage([595.28, 841.89])];
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  await drawInstitutionalHeaders(
    pdf,
    pages,
    {
      company: 'ONE LATAM PHARMA',
      title,
      code: 'OLP-GGC-01-PR',
      versionLabel: '3',
      process: 'GGC · Gestión de garantía de calidad',
      documentType: 'Procedimiento',
      elaboro: ['Analista de calidad'],
      reviso: ['Coordinadora de calidad'],
      aprobo: ['Directora técnica'],
      emissionText: '2026-08-12',
      logo: null,
      template: config,
    },
    fonts
  );
  pages.forEach((p, i) => p.drawText(i === 0 ? '1. OBJETIVO' : '5. HISTORIAL DE CAMBIOS', { x: 60, y: 600, size: 11, font: fonts.bold }));
  return Buffer.from(await pdf.save());
}

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'calidad@onelatampharma.com', name: 'Calidad OLP', sub: 'u-cal', kronosUserId: 'u-cal', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

async function simular(page: Page) {
  const posted: { url: string; body: unknown }[] = [];
  let extra: { source: number; target: number; type: string }[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
  // Primero lo genérico (Playwright usa la última ruta registrada que coincide).
  await page.route('**/api/**', (r) => json(r, {}));
  await page.route('**/api/auth/session', (r) => json(r, { user: { email: 'calidad@onelatampharma.com', name: 'Calidad OLP', id: 'u-cal', role: 'user' }, expires: '2099-01-01T00:00:00Z' }));
  await page.route('**/api/sgc/access', (r) => json(r, { companies: [company] }));
  await page.route('**/api/sgc/relations?**', (r) => json(r, graph(extra)));
  await page.route('**/api/sgc/relations/layout', (r) => json(r, { saved: 1 }));
  await page.route('**/api/sgc/relations/proposals**', (r) => json(r, { proposals: [] }));
  await page.route('**/api/sgc/relations/parent**', async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as { idChild: number; idParent: number };
      posted.push({ url: r.request().url(), body });
      const child = DOCS.find((d) => d.id === body.idChild)!;
      extra = [...extra, child.type === 'FR' ? { source: body.idChild, target: body.idParent, type: 'formato' } : { source: body.idParent, target: body.idChild, type: 'procedimiento_padre' }];
      return json(r, { saved: { id_document_relation: 99 } }, 201);
    }
    const id = Number(new URL(r.request().url()).searchParams.get('document'));
    const d = DOCS.find((x) => x.id === id)!;
    return json(r, {
      document: { idDocument: d.id, code: d.code, title: d.title, documentTypeCode: d.type, status: 'vigente' },
      isParentType: d.type === 'PR',
      parentTypeCodes: ['PR'],
      parent: null,
      candidates: DOCS.filter((x) => x.type === 'PR').map((x) => ({ idDocument: x.id, code: x.code, title: x.title, status: 'vigente', documentTypeCode: 'PR' })),
    });
  });
  await page.route('**/api/sgc/documents/*/versions/*/file**', async (r) => r.fulfill({ status: 200, contentType: 'application/pdf', body: await samplePdf(null), headers: { 'cache-control': 'no-store' } }));
  await page.route('**/api/sgc/catalogs**', (r) => json(r, catalogs));
  await page.route('**/api/sgc/documents?**', (r) =>
    json(r, {
      documents: DOCS.map((d) => ({
        idDocument: d.id, code: d.code, title: d.title, status: 'vigente', confidentiality: 'publica', versionNumber: d.v ?? 1, idVersion: d.id * 10, effectiveDate: '2026-08-12', reviewDueDate: '2029-08-12',
        processType: { id: 1, code: 'S', name: 'Procesos de soporte', color: 'blue' }, process: { id: 1, code: 'GGC', name: 'Gestión de garantía de calidad', department: null },
        documentType: { id: TYPE_IDS[d.type], code: d.type, name: docTypes.find((t) => t.code === d.type)!.name, pluralName: '', alertMonths: 2 },
      })),
    })
  );
  await page.route('**/api/sgc/requests/form**', (r) => json(r, { flow: { code: 'DOC', name: 'Documental', version: 7 }, roleModel: 'solicitante_elabora', requestTypes: [{ value: 'nuevo', label: 'Documento nuevo' }, { value: 'nueva_version', label: 'Nueva versión' }], fields: [], steps: [] }));
  await page.route('**/api/sgc/header-templates?**', (r) => json(r, { templates: [{ id: 1, code: 'INSTITUCIONAL', name: 'Encabezado institucional', config: normalizeHeaderTemplateConfig({}), isDefault: true, isActive: true, version: 1, updatedBy: 'calidad@onelatampharma.com', updatedAt: '2026-10-14T12:00:00Z', documentTypes: [] }] }));
  await page.route('**/api/sgc/header-templates/preview**', async (r) => {
    const raw = new URL(r.request().url()).searchParams.get('config');
    let cfg: SgcHeaderTemplateConfig | null = null;
    try {
      cfg = raw ? normalizeHeaderTemplateConfig(JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))) : null;
    } catch (e) {
      return json(r, { error: e instanceof Error ? e.message : String(e) }, 400);
    }
    return r.fulfill({ status: 200, contentType: 'application/pdf', body: await samplePdf(cfg, 'Nombre del documento de ejemplo') });
  });
  await page.route('**/api/sgc/company-settings**', (r) => json(r, { headerMandatory: true, initialLoad: { open: true, closedBy: null, closedAt: null, reason: null } }));
  return { posted };
}

const snap = async (page: Page, name: string) => {
  if (!CAPTURAS) return;
  fs.mkdirSync(CAPTURAS, { recursive: true });
  // Sin página completa: el encabezado fijo de SynerLink se repetiría a mitad de la captura.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURAS, `${name}.png`) });
};

test.describe('SGC · documentos padre e hijos y grilla del encabezado (APIs simuladas)', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL, page }) => {
    await sesion(context, baseURL!);
    if (process.env.SGC_CONSOLA) page.on('console', async (m) => m.type() === 'error' && console.log('[consola]', test.info().title.slice(0, 30), (await Promise.all(m.args().map((a) => a.jsonValue().catch(() => '?')))).map(String).join(' | ').slice(0, 600)));
  });

  test('[SGC-REQ-184] árbol del auditor: procedimientos con lo que se desprende, versión vigente y visor sin descarga', async ({ page }) => {
    await simular(page);
    await page.setViewportSize({ width: 1366, height: 1180 });
    await page.goto(`/process/sgc-documental/arbol?empresa=${EMPRESA}`);
    await expect(page.getByTestId('sgc-arbol-padre')).toHaveCount(3);
    await page.getByTestId('sgc-arbol-expandir').click();
    await expect(page.locator('[data-testid="sgc-arbol-documento"][data-code="OLP-GGC-01-IN-001"]')).toBeVisible();
    await expect(page.getByTestId('sgc-arbol-conteo')).toContainText('3 documento(s) padre · 5 documento(s) que se desprenden · 3 sin padre');
    await snap(page, '01-arbol-documental-escritorio');
    await page.locator('[data-testid="sgc-arbol-documento"][data-code="OLP-GGC-01-PR"]').getByTestId('sgc-arbol-ver').click();
    await expect(page.getByRole('dialog', { name: /OLP-GGC-01-PR · V3/ })).toBeVisible();
    await page.waitForTimeout(1500);
    await snap(page, '02-arbol-visor-sin-descarga');
  });

  test('[SGC-REQ-183] mapa: arrastrar un formato sobre su procedimiento pide confirmación y motivo, y lo relaciona', async ({ page }) => {
    const { posted } = await simular(page);
    await page.setViewportSize({ width: 1366, height: 1500 });
    await page.goto(`/process/sgc-documental/relaciones?empresa=${EMPRESA}`);
    await page.getByTestId('sgc-mapa-lienzo').scrollIntoViewIfNeeded();
    const child = page.locator('[data-testid="sgc-mapa-nodo"][data-code="OLP-GGC-01-FR-004"]');
    const parent = page.locator('[data-testid="sgc-mapa-nodo"][data-code="OLP-GGC-03-PR"]');
    await expect(child).toBeVisible();
    await expect(page.getByTestId('sgc-mapa-ayuda-arrastre')).toBeVisible();
    const a = (await child.boundingBox())!;
    const b = (await parent.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 - 10, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
    await expect(parent).toHaveAttribute('data-drop', 'ok');
    await snap(page, '03-mapa-arrastrar-sobre-el-padre');
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: /Relacionar OLP-GGC-01-FR-004 con su documento padre/ })).toBeVisible();
    await expect(page.getByTestId('sgc-padre-resumen')).toContainText('OLP-GGC-01-FR-004 quedará como hijo de OLP-GGC-03-PR');
    await page.getByTestId('sgc-padre-motivo').fill('El formato de divulgación es del procedimiento de auditorías (prueba).');
    await snap(page, '04-mapa-confirmacion-con-motivo');
    await page.getByTestId('sgc-padre-guardar').click();
    await expect(page.getByTestId('sgc-mapa-relacion-ok')).toContainText('OLP-GGC-01-FR-004 quedó como hijo de OLP-GGC-03-PR.');
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ idChild: 9, idParent: 3, via: 'arrastre' });
    await snap(page, '05-mapa-relacionado');
  });

  test('[SGC-REQ-183] celular: el botón «Relacionar con padre» del árbol hace lo mismo sin arrastrar', async ({ page }) => {
    const { posted } = await simular(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/process/sgc-documental/arbol?empresa=${EMPRESA}`);
    await expect(page.getByTestId('sgc-arbol-sin-padre')).toBeVisible();
    await page.getByTestId('sgc-arbol-expandir').click();
    await page.locator('[data-testid="sgc-arbol-padre"][data-code="OLP-GGC-01-PR"]').scrollIntoViewIfNeeded();
    await snap(page, '06-arbol-celular');
    await page.getByTestId('sgc-arbol-sin-padre').scrollIntoViewIfNeeded();
    await snap(page, '06b-arbol-celular-sin-padre');
    // Sin desbordar a lo ancho.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.locator('[data-testid="sgc-arbol-huerfano"][data-code="OLP-GGC-03-FR-001"]').getByTestId('sgc-arbol-relacionar').click();
    await page.getByTestId('sgc-padre-select').click();
    await page.getByRole('option', { name: /OLP-GGC-03-PR/ }).click();
    await page.getByTestId('sgc-padre-motivo').fill('Formato del procedimiento de auditorías (prueba en celular).');
    await snap(page, '07-celular-relacionar-con-padre');
    await page.getByTestId('sgc-padre-guardar').click();
    await expect(page.getByTestId('sgc-arbol-mensaje')).toContainText('OLP-GGC-03-FR-001 quedó como hijo de OLP-GGC-03-PR.');
    expect(posted[0].body).toMatchObject({ idChild: 10, idParent: 3, via: 'boton' });
  });

  test('[SGC-REQ-180] un procedimiento no tiene padre: la solicitud lo explica y el formato solo ofrece procedimientos como padre', async ({ page }) => {
    await simular(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`/process/sgc-documental/solicitudes/nueva?empresa=${EMPRESA}`);
    await page.getByTestId('sgc-nueva-tipo-documental').click();
    await page.getByRole('option', { name: 'PR · Procedimiento' }).click();
    await expect(page.getByTestId('sgc-nueva-tipo-padre')).toContainText('es documento padre: no tiene padre');
    await expect(page.getByTestId('sgc-nueva-padre')).toHaveCount(0);
    await snap(page, '08-solicitud-procedimiento-sin-padre');
    await page.getByTestId('sgc-nueva-tipo-documental').click();
    await page.getByRole('option', { name: 'FR · Formato' }).click();
    await page.getByTestId('sgc-nueva-padre').click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);
    await expect(options.first()).toContainText('OLP-GGC-01-PR');
    await snap(page, '09-solicitud-formato-elige-padre');
  });

  test('[SGC-REQ-185] Configuración: la grilla del encabezado se edita (combinar, campos, texto fijo) y la vista previa es el PDF real', async ({ page }) => {
    await simular(page);
    await page.setViewportSize({ width: 1366, height: 1000 });
    await page.goto(`/process/sgc-documental/configuracion?empresa=${EMPRESA}`);
    await page.getByRole('tab', { name: 'Tipos documentales' }).click();
    await expect(page.getByTestId('sgc-tipo-padre')).toHaveCount(1);
    await snap(page, '10-configuracion-tipo-padre');
    await page.getByRole('tab', { name: 'Encabezados' }).click();
    await page.getByTestId('sgc-encabezado-nuevo').click();
    await page.getByTestId('sgc-encabezado-codigo').fill('FORMATO-GRILLA');
    await page.getByTestId('sgc-encabezado-nombre').fill('Encabezado de formatos con grilla');
    await page.getByTestId('sgc-grilla-activar').evaluate((el) => (el as HTMLInputElement).click());
    await expect(page.getByTestId('sgc-grilla-celda')).toHaveCount(12);
    // La fila de los nombres se combina: «Elaboró» ocupa dos columnas y el texto fijo cambia.
    await page.locator('[data-testid="sgc-grilla-celda"][data-field="texto"]').click();
    await page.getByTestId('sgc-grilla-texto').fill('VIGENTE DESDE:');
    await page.locator('[data-testid="sgc-grilla-celda"][data-field="elaboro"]').click();
    await page.getByTestId('sgc-grilla-combinar-derecha').click();
    await expect(page.getByTestId('sgc-grilla-celda')).toHaveCount(11);
    await snap(page, '11-editor-grilla');
    await page.getByTestId('sgc-encabezado-ver').click();
    await expect(page.getByTestId('sgc-encabezado-vista-previa')).toBeVisible();
    await page.waitForTimeout(1500);
    await snap(page, '12-editor-grilla-vista-previa-real');
  });
});
