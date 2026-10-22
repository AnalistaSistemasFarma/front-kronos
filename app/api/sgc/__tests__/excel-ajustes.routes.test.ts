import { beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-10-21: rutas de «Ajustar y previsualizar» un Excel de la carga inicial
// (inspección y vista previa sin guardar) y de la carga con sus ajustes, con
// la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'inspectBulkExcel', 'previewBulkExcel', 'uploadBulkFile'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ uploadToSgcStorage: 'subir' }));
vi.mock('../../../../lib/sgc/pdf/render', () => ({ docxToHtml: 'word', htmlToPdf: 'chrome' }));
vi.mock('../../../../lib/sgc/db/bulkUpload', () => ({ inspectBulkExcel: m.inspectBulkExcel, previewBulkExcel: m.previewBulkExcel, uploadBulkFile: m.uploadBulkFile }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as preview from '../master-list/files/preview/route';
import * as file from '../master-list/files/[id]/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'maria.camila@onelatampharma.com';
function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
}
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const multipart = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new Request('http://x/api', { method: 'POST', body: f, headers: H });
};
const xlsx = () => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'OLP-GC-07-FO01 Registro.xlsx');
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas · ajustar y previsualizar un Excel de la carga inicial', () => {
  it('[SGC-REQ-165] sin sesión 401; sin permiso de Calidad 403; faltantes 400', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await preview.POST(multipart({ company: '3' }))).status).toBe(401);
    asUser([lectura]);
    expect((await preview.POST(multipart({ company: '3', file: xlsx(), action: 'inspeccionar' }))).status).toBe(403);
    asUser([calidad]);
    expect((await preview.POST(multipart({ file: xlsx(), action: 'inspeccionar' }))).status).toBe(400);
    expect((await preview.POST(multipart({ company: '3', action: 'inspeccionar' }))).status).toBe(400);
    expect((await preview.POST(multipart({ company: '3', file: xlsx(), action: 'otra' }))).status).toBe(400);
    expect((await preview.POST(new Request('http://x', { method: 'POST', body: 'x', headers: { ...H, 'content-type': 'text/plain' } }))).status).toBe(400);
    expect(m.inspectBulkExcel).not.toHaveBeenCalled();
    expect(m.previewBulkExcel).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-165] inspeccionar devuelve la estructura; previsualizar devuelve el PDF en línea (nunca como descarga) con los ajustes', async () => {
    asUser([calidad]);
    m.inspectBulkExcel.mockResolvedValue({ fileName: 'x.xlsx', sheets: [{ name: 'Registro' }] });
    const ins = await preview.POST(multipart({ company: '3', file: xlsx(), action: 'inspeccionar' }));
    expect(ins.status).toBe(200);
    expect(await ins.json()).toEqual({ fileName: 'x.xlsx', sheets: [{ name: 'Registro' }] });
    expect(m.inspectBulkExcel.mock.calls[0][1]).toBe(3);
    expect(m.inspectBulkExcel.mock.calls[0][2].fileName).toBe('OLP-GC-07-FO01 Registro.xlsx');

    m.previewBulkExcel.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const settings = JSON.stringify({ orientation: 'horizontal' });
    const res = await preview.POST(multipart({ company: '3', file: xlsx(), action: 'previsualizar', settings }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const [db, company, payload, s, actor, convert] = m.previewBulkExcel.mock.calls[0];
    expect([db, company, payload.bytes.length, s, actor.email, convert]).toEqual([{ tag: 'prisma' }, 3, 4, settings, EMAIL, { docxToHtml: 'word', htmlToPdf: 'chrome' }]);

    m.previewBulkExcel.mockRejectedValue(new SgcError('Deje al menos una hoja en el PDF.'));
    const bad = await preview.POST(multipart({ company: '3', file: xlsx(), action: 'previsualizar', settings }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Deje al menos una hoja en el PDF.' });
  });

  it('[SGC-REQ-165] la carga de un archivo pasa los ajustes normalizados; sin ajustes, null; ajustes inválidos 400', async () => {
    asUser([calidad]);
    m.uploadBulkFile.mockResolvedValue({ status: 'cargado' });
    expect((await file.POST(multipart({ company: '3', file: xlsx(), settings: JSON.stringify({ orientation: 'horizontal', sheets: [{ name: 'Registro', hiddenColumns: ['c'] }] }) }), params('5'))).status).toBe(201);
    expect(m.uploadBulkFile.mock.calls[0][8]).toEqual({ orientation: 'horizontal', fit: 'ancho', scalePct: null, sheets: [{ name: 'Registro', include: true, printArea: null, titleRows: null, hiddenColumns: ['C'] }] });
    expect((await file.POST(multipart({ company: '3', file: xlsx() }), params('5'))).status).toBe(201);
    expect(m.uploadBulkFile.mock.calls[1][8]).toBeNull();
    const bad = await file.POST(multipart({ company: '3', file: xlsx(), settings: JSON.stringify({ orientation: 'diagonal' }) }), params('5'));
    expect(bad.status).toBe(400);
    expect(m.uploadBulkFile).toHaveBeenCalledTimes(2);
  });
});
