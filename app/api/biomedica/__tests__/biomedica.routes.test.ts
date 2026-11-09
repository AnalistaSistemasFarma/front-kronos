import { beforeEach, describe, expect, it, vi } from 'vitest';

// INGENIERÍA BIOMÉDICA (2026-11-06): rutas con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'getBiomedAccessForUser', 'listFormatos', 'listRegistros', 'saveFormato', 'createRegistro', 'getRegistro', 'saveAnotaciones', 'closeRegistro', 'pdfRegistro', 'addSello', 'getSello'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadVerifiedPdf: 'bajar', downloadVerifiedFile: 'bajarArchivo', uploadToSgcStorage: 'subir' }));
vi.mock('../../../../lib/biomedica/access', () => ({ getBiomedAccessForUser: m.getBiomedAccessForUser }));
vi.mock('../../../../lib/biomedica/db', () => ({ BIOMED_ACTIVIDADES: ['Visita técnica'], listFormatos: m.listFormatos, listRegistros: m.listRegistros, saveFormato: m.saveFormato, createRegistro: m.createRegistro, getRegistro: m.getRegistro, saveAnotaciones: m.saveAnotaciones, closeRegistro: m.closeRegistro, pdfRegistro: m.pdfRegistro, addSello: m.addSello, getSello: m.getSello }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as raiz from '../route';
import * as formatos from '../formatos/route';
import * as registros from '../registros/route';
import * as registro from '../registros/[id]/route';
import * as cerrar from '../registros/[id]/cerrar/route';
import * as pdf from '../registros/[id]/pdf/route';
import * as sello from '../registros/[id]/sello/route';

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

  it('sellos del registro: se cargan (multipart, máx. 2 MB) y su imagen se lee solo con el acceso del módulo', async () => {
    const form = new FormData();
    form.append('company', '3');
    form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'sello.png', { type: 'image/png' }));
    m.addSello.mockResolvedValue({ sealItemId: 'od-1', sealFileName: 'sello.png' });
    const up = await sello.POST(new Request('http://x/api', { method: 'POST', body: form, headers: H }), params('5'));
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ sealItemId: 'od-1', sealFileName: 'sello.png' });
    expect(m.addSello.mock.calls[0][2]).toBe(5);
    expect(m.addSello.mock.calls[0][5]).toEqual({ upload: 'subir' });
    const grande = await sello.POST(new Request('http://x/api', { method: 'POST', body: form, headers: { ...H, 'content-length': String(3 * 1024 * 1024) } }), params('5'));
    expect(grande.status).toBe(413);
    m.getSello.mockResolvedValue({ bytes: new Uint8Array([1, 2]), mime: 'image/png' });
    const img = await sello.GET(get('/x?company=3&itemId=od-1'), params('5'));
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(m.getSello.mock.calls[0][3]).toBe('od-1');
    expect((await sello.GET(get('/x?company=3'), params('5'))).status).toBe(400);
    m.getBiomedAccessForUser.mockResolvedValue([]);
    expect((await sello.GET(get('/x?company=3&itemId=od-1'), params('5'))).status).toBe(403);
  });
});
