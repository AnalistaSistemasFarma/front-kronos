import { beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-10-22: ruta «Ajustar y previsualizar» del BORRADOR EN EXCEL de una
// solicitud (inspeccionar, previsualizar sin guardar y guardar con la
// composición), con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'inspectDraftSheets', 'validateDraftSheetSettings', 'buildLayoutPreview', 'saveDocumentLayout'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('@/lib/sgc/onedrive', () => ({ downloadSgcFile: 'bajar', sgcOfficeConverter: { item: 'ms-item', bytes: 'ms' } }));
vi.mock('@/lib/sgc/pdf/render', () => ({ docxToHtml: 'word', htmlToPdf: 'chrome' }));
vi.mock('@/lib/sgc/db/layout', () => ({ inspectDraftSheets: m.inspectDraftSheets, validateDraftSheetSettings: m.validateDraftSheetSettings, buildLayoutPreview: m.buildLayoutPreview, saveDocumentLayout: m.saveDocumentLayout }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as sheet from '../requests/[id]/layout/sheet/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const EMAIL = 'elaborador@onelatampharma.com';
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue([lectura]);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
});

describe('Rutas · ajustes del Excel del borrador de una solicitud', () => {
  it('[SGC-REQ-164] sin sesión 401; solicitud o acción inválida 400', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await sheet.GET(new Request('http://x', { headers: H }), params('7'))).status).toBe(401);
    expect((await sheet.POST(post({ action: 'guardar' }), params('7'))).status).toBe(401);
    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    expect((await sheet.GET(new Request('http://x', { headers: H }), params('x'))).status).toBe(400);
    expect((await sheet.POST(post({ action: 'otra' }), params('7'))).status).toBe(400);
    expect((await sheet.POST(post({ action: 'guardar' }), params('x'))).status).toBe(400);
    expect(m.validateDraftSheetSettings).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-164] inspecciona el borrador, previsualiza sin guardar (PDF en línea) y guarda con la composición', async () => {
    m.inspectDraftSheets.mockResolvedValue({ sheets: [{ name: 'Registro' }], sheetSettings: null });
    const ins = await sheet.GET(new Request('http://x', { headers: H }), params('7'));
    expect(await ins.json()).toEqual({ sheets: [{ name: 'Registro' }], sheetSettings: null });
    expect(m.inspectDraftSheets.mock.calls[0].slice(1, 3)).toEqual([{ download: 'bajar' }, 7]);

    const valid = { orientation: 'horizontal', fit: 'ancho', scalePct: null, sheets: [] };
    m.validateDraftSheetSettings.mockResolvedValue(valid);
    m.buildLayoutPreview.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const res = await sheet.POST(post({ action: 'previsualizar', settings: { orientation: 'horizontal' } }), params('7'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(m.buildLayoutPreview.mock.calls[0][4]).toEqual({ sheetSettings: valid });
    expect(m.saveDocumentLayout).not.toHaveBeenCalled();

    m.saveDocumentLayout.mockResolvedValue({ saved: true, removedSignatures: 2 });
    const saved = await sheet.POST(post({ action: 'guardar', settings: { orientation: 'horizontal' }, reason: 'Formato ancho' }), params('7'));
    expect(await saved.json()).toEqual({ saved: true, removedSignatures: 2 });
    expect(m.saveDocumentLayout.mock.calls[0][2]).toEqual({ sheetSettings: valid, reason: 'Formato ancho' });
    expect(m.saveDocumentLayout.mock.calls[0][4]).toMatchObject({ email: EMAIL });

    // Sin ajustes = automático (null).
    m.validateDraftSheetSettings.mockResolvedValue(null);
    await sheet.POST(post({ action: 'guardar' }), params('7'));
    expect(m.validateDraftSheetSettings.mock.calls.at(-1)![4]).toBeNull();
    expect(m.saveDocumentLayout.mock.calls.at(-1)![2]).toEqual({ sheetSettings: null, reason: undefined });

    // Errores de negocio con su mensaje.
    m.validateDraftSheetSettings.mockRejectedValue(new SgcError('Los ajustes de presentación aplican a un borrador en Excel (.xlsx).', 409));
    const bad = await sheet.POST(post({ action: 'previsualizar', settings: {} }), params('7'));
    expect(bad.status).toBe(409);
  });
});
