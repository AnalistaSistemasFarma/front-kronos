import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Generador de documentos (plantillas aprobadas por Calidad) con la sesión, la base y OneDrive simulados.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession',
    'getSgcAccessForUser',
    'getAccessSubject',
    'isGeneratorEnabled',
    'listAvailableTemplates',
    'listMyGenerated',
    'listTemplatesForManagement',
    'listGeneratedForQuality',
    'getTemplateSource',
    'proposeTemplateVersion',
    'getTemplateForGeneration',
    'generateFromTemplate',
    'retireTemplate',
    'decideTemplateVersion',
    'annulGenerated',
    'getGeneratedForViewer',
    'downloadVerifiedPdf',
    'isViewerProtected',
    'auditCreate',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma', sgcAuditLog: { create: m.auditCreate } } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'notificador' }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadVerifiedPdf: m.downloadVerifiedPdf, downloadSgcFile: 'descargar', uploadToSgcStorage: 'subir' }));
vi.mock('../../../../lib/sgc/pdf/render', () => ({ docxToHtml: 'docx', htmlToPdf: 'pdf' }));
vi.mock('../../../../lib/sgc/db/companySettings', () => ({ isViewerProtected: m.isViewerProtected }));
vi.mock('../../../../lib/sgc/db/generator', () => ({
  isGeneratorEnabled: m.isGeneratorEnabled,
  listAvailableTemplates: m.listAvailableTemplates,
  listMyGenerated: m.listMyGenerated,
  listTemplatesForManagement: m.listTemplatesForManagement,
  listGeneratedForQuality: m.listGeneratedForQuality,
  getTemplateSource: m.getTemplateSource,
  proposeTemplateVersion: m.proposeTemplateVersion,
  getTemplateForGeneration: m.getTemplateForGeneration,
  generateFromTemplate: m.generateFromTemplate,
  retireTemplate: m.retireTemplate,
  decideTemplateVersion: m.decideTemplateVersion,
  annulGenerated: m.annulGenerated,
  getGeneratedForViewer: m.getGeneratedForViewer,
}));

import { SgcError } from '../../../../lib/sgc/errors';
import * as overview from '../generator/route';
import * as source from '../generator/source/route';
import * as templates from '../generator/templates/route';
import * as template from '../generator/templates/[id]/route';
import * as generate from '../generator/templates/[id]/generate/route';
import * as retire from '../generator/templates/[id]/retire/route';
import * as decision from '../generator/versions/[id]/decision/route';
import * as annul from '../generator/documents/[id]/annul/route';
import * as file from '../generator/documents/[id]/file/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'ana@onelatampharma.com';
function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
}
const H = { 'x-forwarded-for': '10.4.4.4', 'user-agent': 'vitest' };
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (q: string) => new Request(`http://x/api${q}`, { headers: H });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const PRISMA = { tag: 'prisma', sgcAuditLog: expect.anything() };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas del Generador de documentos', () => {
  it('[SGC-REQ-007] sin sesión responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const all = await Promise.all([
      overview.GET(get('?company=3')),
      source.GET(get('?company=3&documento=1')),
      templates.POST(post({})),
      template.GET(get('?company=3'), params('1')),
      generate.POST(post({}), params('1')),
      retire.POST(post({}), params('1')),
      decision.POST(post({}), params('1')),
      annul.POST(post({}), params('1')),
      file.GET(get(''), params('1')),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
  });

  it('[SGC-REQ-152][SGC-REQ-147] el resumen dice si está encendido y qué puede hacer la persona; las vistas exigen el generador encendido', async () => {
    asUser([lectura, { ...calidad, idCompany: 4 }]);
    m.isGeneratorEnabled.mockResolvedValue(false);
    expect(await (await overview.GET(get('?company=3'))).json()).toEqual({ enabled: false, canPropose: false, canApprove: false, canQuality: false });
    expect((await overview.GET(get('?company=3&vista=disponibles'))).status).toBe(403);
    expect((await overview.GET(get(''))).status).toBe(400);
    expect((await overview.GET(get('?company=9'))).status).toBe(403);
    m.isGeneratorEnabled.mockResolvedValue(true);
    m.listAvailableTemplates.mockResolvedValue([{ id: 1 }]);
    m.listMyGenerated.mockResolvedValue([{ id: 2 }]);
    m.listTemplatesForManagement.mockResolvedValue({ canApprove: true, templates: [] });
    m.listGeneratedForQuality.mockResolvedValue([{ id: 3 }]);
    expect(await (await overview.GET(get('?company=3&vista=disponibles'))).json()).toMatchObject({ templates: [{ id: 1 }] });
    expect(m.listAvailableTemplates).toHaveBeenCalledWith(PRISMA, lectura, { email: EMAIL, departmentIds: [] });
    expect(await (await overview.GET(get('?company=3&vista=mios'))).json()).toMatchObject({ documents: [{ id: 2 }] });
    expect(m.listMyGenerated).toHaveBeenCalledWith(PRISMA, 3, EMAIL);
    expect(await (await overview.GET(get('?company=4&vista=gestion'))).json()).toMatchObject({ canApprove: true, canQuality: true, templates: [] });
    expect(await (await overview.GET(get('?company=4&vista=calidad'))).json()).toMatchObject({ documents: [{ id: 3 }] });
    expect((await overview.GET(get('?company=3&vista=otra'))).status).toBe(400);
    m.listGeneratedForQuality.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad…', 403));
    expect((await overview.GET(get('?company=3&vista=calidad'))).status).toBe(403);
    m.listMyGenerated.mockRejectedValue(new Error('boom'));
    const err = await overview.GET(get('?company=3&vista=mios'));
    expect([err.status, (await err.json()).error]).toEqual([500, 'Error interno del SGC']);
  });

  it('[SGC-REQ-146][SGC-REQ-147] origen de la plantilla, propuesta, decisión y retiro con la persona de la sesión', async () => {
    asUser([lectura]);
    m.getTemplateSource.mockResolvedValue({ fields: [] });
    expect((await source.GET(get('?company=3&documento=7'))).status).toBe(200);
    expect(m.getTemplateSource).toHaveBeenCalledWith(PRISMA, { download: 'descargar', docxToHtml: 'docx' }, lectura, expect.anything(), 7);
    expect((await source.GET(get('?company=3'))).status).toBe(400);
    expect((await source.GET(get('?company=9&documento=7'))).status).toBe(403);
    m.getTemplateSource.mockRejectedValue(new SgcError('solo PDF', 409));
    expect((await source.GET(get('?company=3&documento=7'))).status).toBe(409);

    m.proposeTemplateVersion.mockResolvedValue({ idTemplate: 1, versionNumber: 1 });
    expect((await templates.POST(post({ company: 3, idDocument: 7, reason: 'x' }))).status).toBe(201);
    expect(m.proposeTemplateVersion.mock.calls[0].slice(1, 4)).toEqual([{ download: 'descargar', docxToHtml: 'docx' }, 'notificador', lectura]);
    expect(m.proposeTemplateVersion.mock.calls[0][6]).toMatchObject({ email: EMAIL, ip: '10.4.4.4' });
    expect((await templates.POST(post({}))).status).toBe(400);
    expect((await templates.POST(post({ company: 9 }))).status).toBe(403);
    m.proposeTemplateVersion.mockRejectedValue(new SgcError('Solo gestión…', 403));
    expect((await templates.POST(post({ company: 3 }))).status).toBe(403);

    m.decideTemplateVersion.mockResolvedValue({ status: 'aprobada' });
    expect(await (await decision.POST(post({ company: 3, decision: 'aprobar', reason: 'ok ok ok ok' }), params('5'))).json()).toEqual({ status: 'aprobada' });
    expect(m.decideTemplateVersion.mock.calls[0].slice(1, 4)).toEqual(['notificador', lectura, 5]);
    expect((await decision.POST(post({ company: 3 }), params('x'))).status).toBe(400);
    expect((await decision.POST(post({ company: 9 }), params('5'))).status).toBe(403);
    m.decideTemplateVersion.mockRejectedValue(new SgcError('Nadie aprueba su propia plantilla', 403));
    expect((await decision.POST(post({ company: 3 }), params('5'))).status).toBe(403);

    m.retireTemplate.mockResolvedValue({ status: 'retirada' });
    expect((await retire.POST(post({ company: 3, reason: 'ya no aplica' }), params('2'))).status).toBe(200);
    expect(m.retireTemplate.mock.calls[0].slice(1, 3)).toEqual([lectura, 2]);
    expect((await retire.POST(post({}), params('2'))).status).toBe(400);
    expect((await retire.POST(post({ company: 9 }), params('2'))).status).toBe(403);
    m.retireTemplate.mockRejectedValue(new SgcError('Solo Calidad', 403));
    expect((await retire.POST(post({ company: 3 }), params('2'))).status).toBe(403);
  });

  it('[SGC-REQ-149][SGC-REQ-151] plantilla para generar; vista previa en línea (nunca descarga) y emisión del registro', async () => {
    asUser([lectura]);
    m.getTemplateForGeneration.mockResolvedValue({ id: 2, state: 'disponible' });
    expect(await (await template.GET(get('?company=3'), params('2'))).json()).toEqual({ id: 2, state: 'disponible' });
    expect((await template.GET(get(''), params('2'))).status).toBe(400);
    expect((await template.GET(get('?company=9'), params('2'))).status).toBe(403);
    m.getTemplateForGeneration.mockRejectedValue(new SgcError('Plantilla no encontrada.', 404));
    expect((await template.GET(get('?company=3'), params('2'))).status).toBe(404);

    m.generateFromTemplate.mockResolvedValueOnce({ mode: 'vista', bytes: new Uint8Array([37, 80, 68, 70]), record: null });
    const vista = await generate.POST(post({ company: 3, modo: 'vista', values: {} }), params('2'));
    expect(vista.status).toBe(200);
    expect(vista.headers.get('content-type')).toBe('application/pdf');
    expect(vista.headers.get('content-disposition')).toBe('inline');
    expect(vista.headers.get('cache-control')).toMatch(/no-store/);
    expect(m.generateFromTemplate.mock.calls[0].slice(1, 5)).toEqual([{ htmlToPdf: 'pdf', upload: 'subir' }, lectura, expect.anything(), 2]);
    m.generateFromTemplate.mockResolvedValueOnce({ mode: 'emitir', bytes: null, record: { id: 9, code: 'OLP-X-G0001' } });
    const emitido = await generate.POST(post({ company: 3, modo: 'emitir', values: {} }), params('2'));
    expect([emitido.status, await emitido.json()]).toEqual([201, { record: { id: 9, code: 'OLP-X-G0001' } }]);
    expect((await generate.POST(post({}), params('2'))).status).toBe(400);
    expect((await generate.POST(post({ company: 9 }), params('2'))).status).toBe(403);
    m.generateFromTemplate.mockRejectedValue(new SgcError('no es un campo editable', 400));
    expect((await generate.POST(post({ company: 3 }), params('2'))).status).toBe(400);
  });

  it('[SGC-REQ-151][SGC-REQ-153] el registro se ve en línea, estampado y auditado; sin permiso responde 404 y queda el intento', async () => {
    asUser([lectura]);
    expect((await file.GET(get(''), params('x'))).status).toBe(400);
    m.getGeneratedForViewer.mockResolvedValue(null);
    expect((await file.GET(get(''), params('5'))).status).toBe(404);
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ action: 'acceso.denegado', entity: 'generated_document', entity_id: '5', actor_email: EMAIL });
    m.auditCreate.mockReset();
    const d = await PDFDocument.create();
    d.addPage();
    m.downloadVerifiedPdf.mockResolvedValue(await d.save());
    m.isViewerProtected.mockResolvedValue(true);
    m.getGeneratedForViewer.mockResolvedValue({ idCompany: 3, code: 'OLP-X-G0001', status: 'anulado', pdfItemId: 'it', pdfSha256: 'a'.repeat(64), idGenerated: 5 });
    const res = await file.GET(get(''), params('5'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('x-sgc-proteccion')).toBe('1');
    expect(m.downloadVerifiedPdf).toHaveBeenCalledWith('it', 'a'.repeat(64));
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ action: 'documento.consulta', entity: 'generated_document', entity_id: '5', id_company: 3 });
    m.isViewerProtected.mockResolvedValue(false);
    m.getGeneratedForViewer.mockResolvedValue({ idCompany: 3, code: 'OLP-X-G0001', status: 'emitido', pdfItemId: 'it', pdfSha256: 'a'.repeat(64), idGenerated: 5 });
    expect((await file.GET(get(''), params('5'))).headers.get('x-sgc-proteccion')).toBe('0');
    m.downloadVerifiedPdf.mockRejectedValue(new SgcError('El archivo no coincide con su huella', 409));
    expect((await file.GET(get(''), params('5'))).status).toBe(409);
    asUser([]);
    expect((await file.GET(get(''), params('5'))).status).toBe(403);
  });

  it('[SGC-REQ-150] anular un registro con la persona de la sesión', async () => {
    asUser([lectura]);
    m.annulGenerated.mockResolvedValue({ status: 'anulado' });
    expect(await (await annul.POST(post({ company: 3, reason: 'error en el destinatario' }), params('5'))).json()).toEqual({ status: 'anulado' });
    expect(m.annulGenerated.mock.calls[0].slice(1, 3)).toEqual([lectura, 5]);
    expect((await annul.POST(post({}), params('5'))).status).toBe(400);
    expect((await annul.POST(post({ company: 9 }), params('5'))).status).toBe(403);
    m.annulGenerated.mockRejectedValue(new SgcError('ya estaba anulado', 409));
    expect((await annul.POST(post({ company: 3 }), params('5'))).status).toBe(409);
  });
});
