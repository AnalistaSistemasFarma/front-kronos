import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 8 (listado maestro) con la sesión y la base simuladas. Las
// reglas van en lib/sgc/__tests__/s8.*.test.ts y, contra un SQL Server real,
// en tests/integration/sgc/s8.integration.test.ts.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'previewMasterListImport', 'confirmMasterListImport', 'listMasterListImports', 'getMasterListImportRows'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/db/masterListImport', () => ({
  previewMasterListImport: m.previewMasterListImport,
  confirmMasterListImport: m.confirmMasterListImport,
  listMasterListImports: m.listMasterListImports,
  getMasterListImportRows: m.getMasterListImportRows,
}));

import { SgcError } from '../../../../lib/sgc/errors';
import * as route from '../master-list/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: true, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'maria.camila@onelatampharma.com';

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [3] });
}
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const post = (body: unknown) => new Request('http://x/api/sgc/master-list', { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (q: string) => new Request(`http://x/api/sgc/master-list${q}`, { headers: H });
const rows = [{ rowNumber: 2, values: { code: 'OLP-GCC-02' } }];

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas del S8 · listado maestro', () => {
  it('[SGC-REQ-007] sin sesión responde 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await route.GET(get('?company=3'))).status).toBe(401);
    expect((await route.POST(post({ company: 3, rows }))).status).toBe(401);
  });

  it('[SGC-REQ-114] solo Aseguramiento de Calidad de la empresa ve el historial y carga el listado', async () => {
    asUser([lectura]);
    expect((await route.GET(get('?company=3'))).status).toBe(403);
    expect((await route.POST(post({ company: 3, rows }))).status).toBe(403);
    expect((await route.GET(get(''))).status).toBe(400);
    expect((await route.POST(post({ rows }))).status).toBe(400);
    expect((await route.POST(new Request('http://x', { method: 'POST', body: '[]', headers: { 'content-type': 'application/json' } }))).status).toBe(400);
    expect(m.previewMasterListImport).not.toHaveBeenCalled();
    expect(m.confirmMasterListImport).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-114] sin «confirm» es VISTA PREVIA (200, no guarda); con confirm: true CARGA (201) con la persona de la sesión', async () => {
    asUser([calidad]);
    m.previewMasterListImport.mockResolvedValue({ summary: { ok: 1 } });
    m.confirmMasterListImport.mockResolvedValue({ idImport: 9 });
    const preview = await route.POST(post({ company: 3, fileName: 'listado.xlsx', rows }));
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toContain('no-store');
    expect(m.previewMasterListImport).toHaveBeenCalledWith({ tag: 'prisma' }, 3, { company: 3, fileName: 'listado.xlsx', rows });
    const load = await route.POST(post({ company: 3, fileName: 'listado.xlsx', rows, confirm: true, expectedSha256: 'a'.repeat(64) }));
    expect(load.status).toBe(201);
    expect(await load.json()).toEqual({ idImport: 9 });
    expect(m.confirmMasterListImport.mock.calls[0][3]).toMatchObject({ email: EMAIL, ip: '10.0.0.9' });
    m.confirmMasterListImport.mockRejectedValue(new SgcError('Ninguna fila se puede cargar: corrija los errores del listado.', 409));
    const bad = await route.POST(post({ company: 3, rows, confirm: true }));
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toContain('Ninguna fila');
  });

  it('[SGC-REQ-116] historial de importaciones y filas de una importación (cargadas y con error)', async () => {
    asUser([calidad]);
    m.listMasterListImports.mockResolvedValue([{ id: 1 }]);
    m.getMasterListImportRows.mockResolvedValue([{ rowNumber: 2, status: 'error' }]);
    expect(await (await route.GET(get('?company=3'))).json()).toEqual({ imports: [{ id: 1 }] });
    expect(await (await route.GET(get('?company=3&import=1'))).json()).toEqual({ rows: [{ rowNumber: 2, status: 'error' }] });
    expect(m.getMasterListImportRows).toHaveBeenCalledWith({ tag: 'prisma' }, 3, 1);
    expect((await route.GET(get('?company=3&import=x'))).status).toBe(400);
    m.listMasterListImports.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await route.GET(get('?company=3'))).status).toBe(500);
    m.previewMasterListImport.mockRejectedValue(new Error('caída'));
    expect((await route.POST(post({ company: 3, rows }))).status).toBe(500);
    spy.mockRestore();
  });
});
