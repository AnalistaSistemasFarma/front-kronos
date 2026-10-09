import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 9 (carga masiva de PDF, relaciones propuestas, cierre de la
// carga inicial y «Mis pendientes») con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getSgcAccessForUser', 'getAccessSubject',
    'listBulkUploads', 'previewBulkUpload', 'startBulkUpload', 'uploadBulkFile', 'closeInitialLoad',
    'listRelationProposals', 'proposeDocumentRelations', 'decideRelationProposals', 'getMyPendings',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ uploadToSgcStorage: 'subir' }));
vi.mock('../../../../lib/sgc/db/bulkUpload', () => ({ listBulkUploads: m.listBulkUploads, previewBulkUpload: m.previewBulkUpload, startBulkUpload: m.startBulkUpload, uploadBulkFile: m.uploadBulkFile, closeInitialLoad: m.closeInitialLoad }));
vi.mock('../../../../lib/sgc/db/relations', () => ({ listRelationProposals: m.listRelationProposals, proposeDocumentRelations: m.proposeDocumentRelations, decideRelationProposals: m.decideRelationProposals }));
vi.mock('../../../../lib/sgc/db/pendings', () => ({ getMyPendings: m.getMyPendings }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as files from '../master-list/files/route';
import * as file from '../master-list/files/[id]/route';
import * as proposals from '../relations/proposals/route';
import * as initialLoad from '../company-settings/initial-load/route';
import * as pendings from '../pendings/route';

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
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (q: string) => new Request(`http://x/api${q}`, { headers: H });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const multipart = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new Request('http://x/api', { method: 'POST', body: f, headers: H });
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas del S9 · sesión y permisos', () => {
  it('[SGC-REQ-007] sin sesión responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const all = await Promise.all([files.GET(get('?company=3')), files.POST(post({ company: 3 })), file.POST(multipart({ company: '3' }), params('1')), proposals.GET(get('?company=3')), proposals.POST(post({ company: 3 })), initialLoad.POST(post({ company: 3 })), pendings.GET(get('?company=3'))]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
  });

  it('[SGC-REQ-117][SGC-REQ-118][SGC-REQ-119] solo Aseguramiento de Calidad carga archivos, relaciona documentos y cierra la carga inicial', async () => {
    asUser([lectura]);
    const all = await Promise.all([
      files.GET(get('?company=3')), files.POST(post({ company: 3, action: 'iniciar' })), file.POST(multipart({ company: '3', file: new File(['x'], 'a.pdf') }), params('1')),
      proposals.GET(get('?company=3')), proposals.POST(post({ company: 3, action: 'proponer' })), initialLoad.POST(post({ company: 3, reason: 'x' })),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 403));
    expect((await files.GET(get(''))).status).toBe(400);
    expect((await files.POST(post({}))).status).toBe(400);
    expect((await proposals.GET(get(''))).status).toBe(400);
    expect((await proposals.POST(post({}))).status).toBe(400);
    expect((await initialLoad.POST(post({}))).status).toBe(400);
  });
});

describe('Rutas del S9 · carga masiva de PDF', () => {
  it('[SGC-REQ-117] vista previa, inicio de la tanda y carga de cada archivo con la persona de la sesión', async () => {
    asUser([calidad]);
    m.listBulkUploads.mockResolvedValue([{ id: 1 }]);
    m.previewBulkUpload.mockResolvedValue([{ fileName: 'a.pdf' }]);
    m.startBulkUpload.mockResolvedValue({ idBulkUpload: 5 });
    m.uploadBulkFile.mockResolvedValue({ status: 'cargado' });
    expect(await (await files.GET(get('?company=3'))).json()).toEqual({ uploads: [{ id: 1 }] });
    expect(await (await files.POST(post({ company: 3, action: 'vista_previa', fileNames: ['a.pdf'] }))).json()).toEqual({ files: [{ fileName: 'a.pdf' }] });
    const start = await files.POST(post({ company: 3, action: 'iniciar', filesTotal: 1 }));
    expect(start.status).toBe(201);
    expect(m.startBulkUpload.mock.calls[0][3]).toMatchObject({ email: EMAIL });
    expect((await files.POST(post({ company: 3, action: 'otra' }))).status).toBe(400);
    const up = await file.POST(multipart({ company: '3', file: new File([new Uint8Array([0x25, 0x50])], 'OLP-GCC-02.pdf', { type: 'application/pdf' }) }), params('5'));
    expect(up.status).toBe(201);
    const [, uploader, company, idBulk, payload] = m.uploadBulkFile.mock.calls[0];
    expect([uploader, company, idBulk, payload.fileName, payload.bytes.length]).toEqual(['subir', 3, 5, 'OLP-GCC-02.pdf', 2]);
    expect((await file.POST(multipart({ company: '3' }), params('5'))).status).toBe(400);
    expect((await file.POST(multipart({ file: new File(['x'], 'a.pdf') }), params('5'))).status).toBe(400);
    expect((await file.POST(multipart({ company: '3' }), params('x'))).status).toBe(400);
    expect((await file.POST(new Request('http://x', { method: 'POST', body: 'x', headers: { ...H, 'content-type': 'text/plain' } }), params('5'))).status).toBe(400);
    m.uploadBulkFile.mockRejectedValue(new SgcError('La carga no existe.', 404));
    expect((await file.POST(multipart({ company: '3', file: new File(['x'], 'a.pdf') }), params('5'))).status).toBe(404);
    m.listBulkUploads.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await files.GET(get('?company=3'))).status).toBe(500);
    m.previewBulkUpload.mockRejectedValue(new Error('caída'));
    expect((await files.POST(post({ company: 3, action: 'vista_previa' }))).status).toBe(500);
    spy.mockRestore();
  });
});

describe('Rutas del S9 · relaciones, carga inicial y pendientes', () => {
  it('[SGC-REQ-118] proponer (201), listar, confirmar y descartar relaciones', async () => {
    asUser([calidad]);
    m.listRelationProposals.mockResolvedValue([{ id: 1 }]);
    m.proposeDocumentRelations.mockResolvedValue({ created: 2 });
    m.decideRelationProposals.mockResolvedValueOnce({ confirmed: 1 }).mockRejectedValueOnce(new SgcError('Seleccione al menos una relación propuesta.'));
    expect(await (await proposals.GET(get('?company=3'))).json()).toEqual({ proposals: [{ id: 1 }] });
    expect((await proposals.POST(post({ company: 3, action: 'proponer' }))).status).toBe(201);
    expect(await (await proposals.POST(post({ company: 3, action: 'confirmar', ids: [1] }))).json()).toEqual({ confirmed: 1 });
    expect(m.decideRelationProposals.mock.calls[0][2]).toEqual({ company: 3, action: 'confirmar', ids: [1] });
    expect((await proposals.POST(post({ company: 3, action: 'descartar', ids: [] }))).status).toBe(400);
    m.listRelationProposals.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await proposals.GET(get('?company=3'))).status).toBe(500);
    spy.mockRestore();
  });

  it('[SGC-REQ-119] cerrar la carga inicial pasa el motivo y la persona; los errores de negocio salen con su mensaje', async () => {
    asUser([calidad]);
    m.closeInitialLoad.mockResolvedValueOnce({ open: false }).mockRejectedValueOnce(new SgcError('Hay 2 documento(s) pendientes de archivo', 409));
    expect(await (await initialLoad.POST(post({ company: 3, reason: 'Carga terminada y verificada' }))).json()).toEqual({ open: false });
    expect(m.closeInitialLoad.mock.calls[0].slice(1, 3)).toEqual([3, { company: 3, reason: 'Carga terminada y verificada' }]);
    const r = await initialLoad.POST(post({ company: 3, reason: 'Carga terminada y verificada' }));
    expect(r.status).toBe(409);
  });

  it('[SGC-REQ-120] «Mis pendientes» de la persona de la sesión en la empresa', async () => {
    asUser([lectura]);
    m.getMyPendings.mockResolvedValue({ counts: { total: 0 }, items: [] });
    expect((await pendings.GET(get('?company=3'))).status).toBe(200);
    expect(m.getMyPendings).toHaveBeenCalledWith({ tag: 'prisma' }, EMAIL, lectura);
    expect((await pendings.GET(get(''))).status).toBe(400);
    expect((await pendings.GET(get('?company=9'))).status).toBe(403);
    m.getMyPendings.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await pendings.GET(get('?company=3'))).status).toBe(500);
    spy.mockRestore();
  });
});
