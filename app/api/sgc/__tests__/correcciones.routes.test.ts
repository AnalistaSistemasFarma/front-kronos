import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas de las correcciones de Calidad OLP (reunión 2026-10-02): ubicación de
// firmas y vista previa del documento, «No entendí», configuración general de
// la empresa y revisión menor de Calidad, con la sesión y la base simuladas.
// Las reglas van en lib/sgc/__tests__/correcciones.*.test.ts y, contra un SQL
// Server real, en tests/integration/sgc/correcciones.integration.test.ts.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getSgcAccessForUser', 'getAccessSubject',
    'getDocumentLayout', 'saveDocumentLayout', 'buildLayoutPreview', 'recordReadingDoubt', 'getCompanySettings', 'saveCompanySettings',
    'listDraftRevisions', 'saveDraftRevision', 'getVigenteBaseHtml', 'getCurrentDraftHtml',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'notificador' }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadSgcFile: 'descarga' }));
vi.mock('../../../../lib/sgc/pdf/render', () => ({ docxToHtml: 'docx', htmlToPdf: 'html' }));
vi.mock('../../../../lib/sgc/db/layout', () => ({ getDocumentLayout: m.getDocumentLayout, saveDocumentLayout: m.saveDocumentLayout, buildLayoutPreview: m.buildLayoutPreview }));
vi.mock('../../../../lib/sgc/db/dissemination', () => ({ recordReadingDoubt: m.recordReadingDoubt }));
vi.mock('../../../../lib/sgc/db/companySettings', () => ({ getCompanySettings: m.getCompanySettings, saveCompanySettings: m.saveCompanySettings }));
vi.mock('../../../../lib/sgc/db/drafts', () => ({ listDraftRevisions: m.listDraftRevisions, saveDraftRevision: m.saveDraftRevision, getVigenteBaseHtml: m.getVigenteBaseHtml, getCurrentDraftHtml: m.getCurrentDraftHtml }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as layout from '../requests/[id]/layout/route';
import * as preview from '../requests/[id]/layout/preview/route';
import * as doubt from '../reading/[id]/doubt/route';
import * as settings from '../company-settings/route';
import * as draft from '../requests/[id]/draft/route';
import * as draftBase from '../requests/[id]/draft/base/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const gestion = { ...lectura, canManage: true };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'qa.sgc@gsslatam.com';
const VIEWER = { email: EMAIL, access: [gestion] };

function asUser(access: object[], email = EMAIL) {
  m.getServerSession.mockResolvedValue({ user: { email } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email, departmentIds: [3] });
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const H = { 'x-forwarded-for': '10.0.0.8:5555', 'user-agent': 'vitest' };
const req = (url: string, body?: unknown, method = 'POST') => new Request(`http://x${url}`, body === undefined ? { method, headers: H } : { method, body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (url: string) => new Request(`http://x${url}`, { headers: H });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas de las correcciones · sesión obligatoria', () => {
  it('[SGC-REQ-007] sin sesión todas las rutas nuevas responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const p = params({ id: '1' });
    const all = await Promise.all([
      layout.GET(get('/'), p), layout.PUT(req('/', {}, 'PUT'), p), preview.GET(get('/'), p), doubt.POST(req('/', {}), p),
      settings.GET(get('/?company=3')), settings.PUT(req('/', {}, 'PUT')),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
    expect(m.getDocumentLayout).not.toHaveBeenCalled();
  });
});

describe('Rutas de las correcciones · firmas en el documento', () => {
  it('[SGC-REQ-094] consultar y guardar la ubicación de firmas pasa por la capa del SGC con la persona de la sesión; los errores de negocio salen con su mensaje', async () => {
    asUser([gestion]);
    m.getDocumentLayout.mockResolvedValue({ idRequest: 7, fields: [] });
    m.saveDocumentLayout.mockResolvedValueOnce({ saved: true }).mockRejectedValueOnce(new SgcError('Solo el elaborador ubica las firmas en el documento.', 403));
    const p = params({ id: '7' });
    const g = await layout.GET(get('/'), p);
    expect(g.status).toBe(200);
    expect(g.headers.get('cache-control')).toContain('no-store');
    expect(m.getDocumentLayout).toHaveBeenCalledWith({ tag: 'prisma' }, 7, VIEWER);
    const body = { institutionalHeader: true, fields: [{ signerKey: 'revision:a@b.co', page: 1, x: 1, y: 1, width: 10, height: 5 }] };
    expect((await layout.PUT(req('/', body, 'PUT'), p)).status).toBe(200);
    expect(m.saveDocumentLayout.mock.calls[0][2]).toEqual(body);
    expect(m.saveDocumentLayout.mock.calls[0][4]).toMatchObject({ email: EMAIL, ip: '10.0.0.8' });
    const denied = await layout.PUT(req('/', body, 'PUT'), p);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Solo el elaborador ubica las firmas en el documento.' });
    expect((await layout.GET(get('/'), params({ id: 'x' }))).status).toBe(400);
    expect((await layout.PUT(req('/', undefined, 'PUT'), p)).status).toBe(400);
    m.getDocumentLayout.mockRejectedValue(new Error('base caída'));
    expect((await layout.GET(get('/'), p)).status).toBe(500);
  });

  it('[SGC-REQ-096] la vista previa del documento final sale en línea como PDF (sin caché) y con límite de tasa', async () => {
    asUser([gestion], 'vista.previa@onelatampharma.com');
    m.buildLayoutPreview.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const p = params({ id: '7' });
    const r = await preview.GET(get('/'), p);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toBe('inline; filename="vista-previa-SOL-7.pdf"');
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(m.buildLayoutPreview.mock.calls[0][1]).toEqual({ download: 'descarga', htmlToPdf: 'html', docxToHtml: 'docx' });
    expect((await preview.GET(get('/'), params({ id: '0' }))).status).toBe(400);
    m.buildLayoutPreview.mockRejectedValue(new SgcError('Solicitud no encontrada.', 404));
    expect((await preview.GET(get('/'), p)).status).toBe(404);
    let limited = 0;
    for (let i = 0; i < 70; i++) if ((await preview.GET(get('/'), p)).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});

describe('Rutas de las correcciones · «No entendí»', () => {
  it('[SGC-REQ-100] registra el «No entendí» de la persona de la sesión con el notificador del SGC (201) y tiene límite de tasa', async () => {
    asUser([lectura], 'lector.duda@onelatampharma.com');
    m.recordReadingDoubt.mockResolvedValue({ ok: true });
    const p = params({ id: '44' });
    expect((await doubt.POST(req('/', { body: 'No entendí el paso 3.' }), p)).status).toBe(201);
    expect(m.recordReadingDoubt.mock.calls[0].slice(0, 4)).toEqual([{ tag: 'prisma' }, 'notificador', 44, { body: 'No entendí el paso 3.' }]);
    expect((await doubt.POST(req('/', undefined), p)).status).toBe(400);
    m.recordReadingDoubt.mockRejectedValue(new SgcError('Cuéntenos qué no entendió (mínimo 10 caracteres).'));
    expect((await doubt.POST(req('/', { body: 'x' }), p)).status).toBe(400);
    let limited = 0;
    for (let i = 0; i < 12; i++) if ((await doubt.POST(req('/', { body: 'No entendí nada de nada.' }), p)).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});

describe('Rutas de las correcciones · configuración general de la empresa', () => {
  it('[SGC-REQ-104] cualquiera con acceso consulta; solo Calidad cambia logo, dominios y umbral (con la empresa en el cuerpo)', async () => {
    asUser([gestion]);
    m.getCompanySettings.mockResolvedValue({ idCompany: OLP, readThresholdPct: 90 });
    expect((await settings.GET(get('/?company=3'))).status).toBe(200);
    expect((await settings.GET(get('/'))).status).toBe(400);
    expect((await settings.GET(get('/?company=9'))).status).toBe(403);
    expect((await settings.PUT(req('/', { company: 3, readThresholdPct: 80, reason: 'Motivo suficiente' }, 'PUT'))).status).toBe(403);
    asUser([calidad]);
    m.saveCompanySettings.mockResolvedValue({ idCompany: OLP, readThresholdPct: 80 });
    expect((await settings.PUT(req('/', { company: 3, readThresholdPct: 80, reason: 'Motivo suficiente' }, 'PUT'))).status).toBe(200);
    expect(m.saveCompanySettings.mock.calls[0][1]).toBe(OLP);
    expect((await settings.PUT(req('/', { readThresholdPct: 80 }, 'PUT'))).status).toBe(400);
    m.saveCompanySettings.mockRejectedValue(new SgcError('El umbral de avance de lectura debe ser un número entero entre 1 y 100.'));
    expect((await settings.PUT(req('/', { company: 3, readThresholdPct: 0, reason: 'Motivo suficiente' }, 'PUT'))).status).toBe(400);
    m.getCompanySettings.mockRejectedValue(new SgcError('La empresa no tiene el SGC activo.', 404));
    expect((await settings.GET(get('/?company=3'))).status).toBe(404);
  });
});

describe('Rutas de las correcciones · revisión menor de Calidad', () => {
  it('[SGC-REQ-102] el borrador se guarda como revisión menor (motivo) con el notificador; ?actual=1 entrega el borrador vigente a Calidad', async () => {
    asUser([calidad]);
    m.saveDraftRevision.mockResolvedValue({ id: 9, number: 4, unchanged: false, minor: true });
    m.getCurrentDraftHtml.mockResolvedValue({ html: '<p>vigente</p>', baseSha256: 'a'.repeat(64) });
    m.getVigenteBaseHtml.mockResolvedValue({ html: '<p>v</p>' });
    const p = params({ id: '5' });
    expect((await draft.POST(req('/', { html: '<p>corregido</p>', minor: true, minorReason: 'Corrige una coma del alcance.' }), p)).status).toBe(201);
    expect(m.saveDraftRevision.mock.calls[0][2]).toMatchObject({ html: '<p>corregido</p>', minor: true, minorReason: 'Corrige una coma del alcance.' });
    expect(m.saveDraftRevision.mock.calls[0][5]).toBe('notificador');
    const actual = await draftBase.GET(get('/?actual=1'), p);
    expect(actual.status).toBe(200);
    expect(await actual.json()).toEqual({ html: '<p>vigente</p>', baseSha256: 'a'.repeat(64) });
    expect(m.getVigenteBaseHtml).not.toHaveBeenCalled();
    expect((await draftBase.GET(get('/'), p)).status).toBe(200);
    expect(m.getVigenteBaseHtml).toHaveBeenCalled();
  });
});
