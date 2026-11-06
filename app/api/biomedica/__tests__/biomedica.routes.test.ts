import { beforeEach, describe, expect, it, vi } from 'vitest';

// INGENIERÍA BIOMÉDICA (2026-11-06): rutas con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'getBiomedAccessForUser', 'listFormatos', 'listRegistros', 'saveFormato', 'createRegistro', 'getRegistro', 'saveAnotaciones', 'closeRegistro', 'pdfRegistro'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadVerifiedPdf: 'bajar' }));
vi.mock('../../../../lib/biomedica/access', () => ({ getBiomedAccessForUser: m.getBiomedAccessForUser }));
vi.mock('../../../../lib/biomedica/db', () => ({ BIOMED_ACTIVIDADES: ['Visita técnica'], listFormatos: m.listFormatos, listRegistros: m.listRegistros, saveFormato: m.saveFormato, createRegistro: m.createRegistro, getRegistro: m.getRegistro, saveAnotaciones: m.saveAnotaciones, closeRegistro: m.closeRegistro, pdfRegistro: m.pdfRegistro }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as raiz from '../route';
import * as formatos from '../formatos/route';
import * as registros from '../registros/route';
import * as registro from '../registros/[id]/route';
import * as cerrar from '../registros/[id]/cerrar/route';
import * as pdf from '../registros/[id]/pdf/route';

const EMAIL = 'ing@onelatampharma.com';
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const lectura = { idCompany: 3, companyName: 'OLP', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const acceso = { idCompany: 3, companyName: 'OLP', canUse: true, canConfigure: false };
const get = (q: string, extra: Record<string, string> = {}) => new Request(`http://x/api${q}`, { headers: { ...H, ...extra } });
const send = (method: string, body: unknown) => new Request('http://x/api', { method, body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue([lectura]);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
  m.getBiomedAccessForUser.mockResolvedValue([acceso]);
});

describe('Rutas de Ingeniería biomédica', () => {
  it('sin sesión 401; sin empresa 400; sin permiso del módulo 403', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await raiz.GET(get('?company=3'))).status).toBe(401);
    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    expect((await raiz.GET(get(''))).status).toBe(400);
    m.getBiomedAccessForUser.mockResolvedValue([]);
    const r = await raiz.GET(get('?company=3'));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/ingenieros biomédicos y Aseguramiento de Calidad/);
    expect(m.listFormatos).not.toHaveBeenCalled();
  });

  it('lista, habilita formatos, crea, guarda y cierra registros con el acceso de la empresa', async () => {
    m.listFormatos.mockResolvedValue([{ id: 1 }]);
    m.listRegistros.mockResolvedValue([]);
    expect(await (await raiz.GET(get('?company=3&q=bomba'))).json()).toEqual({ access: acceso, actividades: ['Visita técnica'], formatos: [{ id: 1 }], registros: [] });
    expect(m.listRegistros.mock.calls[0][2]).toEqual({ q: 'bomba' });
    m.saveFormato.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad elige los formatos del módulo.', 403));
    expect((await formatos.POST(send('POST', { company: 3, idDocument: 10, actividad: 'Visita técnica' }))).status).toBe(403);
    m.createRegistro.mockResolvedValue({ id: 5 });
    expect((await registros.POST(send('POST', { company: 3, idFormato: 1, equipo: 'Bomba' }))).status).toBe(201);
    expect(m.createRegistro.mock.calls[0][3]).toMatchObject({ email: EMAIL });
    m.getRegistro.mockResolvedValue({ id: 5 });
    expect((await registro.GET(get('?company=3'), params('5'))).status).toBe(200);
    expect((await registro.GET(get('?company=3'), params('x'))).status).toBe(400);
    m.saveAnotaciones.mockResolvedValue({ saved: 1 });
    expect((await registro.PUT(send('PUT', { company: 3, anotaciones: [] }), params('5'))).status).toBe(200);
    m.closeRegistro.mockRejectedValue(new SgcError('La versión 2 del formato ya no está vigente: diligencie la versión vigente.', 409));
    const bloqueado = await cerrar.POST(send('POST', { company: 3 }), params('5'));
    expect(bloqueado.status).toBe(409);
    expect((await bloqueado.json()).error).toMatch(/ya no está vigente/);
  });

  it('el PDF sale EN LÍNEA (nunca como descarga) y no se abre directo en una pestaña', async () => {
    m.pdfRegistro.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const res = await pdf.GET(get('/biomedica/registros/5/pdf?company=3&vacio=1'), params('5'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(m.pdfRegistro.mock.calls[0][3]).toMatchObject({ vacio: true, viewerEmail: EMAIL });
    expect((await pdf.GET(get('/biomedica/registros/5/pdf?company=3', { 'sec-fetch-dest': 'document' }), params('5'))).status).toBe(415);
  });
});
