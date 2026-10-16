import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 13 (firma propia y su validación) con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'getMySignature', 'registerOwnSignature', 'validateSignatureMaster'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/db/signatures', () => ({ getMySignature: m.getMySignature, registerOwnSignature: m.registerOwnSignature, validateSignatureMaster: m.validateSignatureMaster }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as own from '../signature/own/route';
import * as validate from '../signature/masters/[id]/validate/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canManage: true, canQuality: true };
const EMAIL = 'ana@onelatampharma.com';
function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
}
const H = { 'x-forwarded-for': '10.13.13.13', 'user-agent': 'vitest' };
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (q: string) => new Request(`http://x/api${q}`, { headers: H });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas del S13 · firma propia', () => {
  it('[SGC-REQ-007] sin sesión responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const all = await Promise.all([own.GET(get('?company=3')), own.POST(post({})), validate.POST(post({}), params('1'))]);
    expect(all.map((r) => r.status)).toEqual([401, 401, 401]);
  });

  it('[SGC-REQ-140] «Mi firma» usa SIEMPRE la persona de la sesión (el correo del cuerpo no cuenta)', async () => {
    asUser([lectura]);
    m.getMySignature.mockResolvedValue({ enabled: true, active: null, pending: null, history: [] });
    m.registerOwnSignature.mockResolvedValue({ id: 9, status: 'pendiente' });
    expect(await (await own.GET(get('?company=3'))).json()).toMatchObject({ enabled: true });
    expect(m.getMySignature).toHaveBeenCalledWith({ tag: 'prisma' }, OLP, EMAIL);
    expect((await own.GET(get(''))).status).toBe(400);
    expect((await own.GET(get('?company=9'))).status).toBe(403);
    const body = { company: 3, imagePng: 'data:image/png;base64,AAAA', method: 'dibujada', email: 'otra@onelatampharma.com' };
    const res = await own.POST(post(body));
    expect(res.status).toBe(201);
    expect(m.registerOwnSignature.mock.calls[0][1]).toBe(OLP);
    expect(m.registerOwnSignature.mock.calls[0][3]).toMatchObject({ email: EMAIL, ip: '10.13.13.13' });
    expect((await own.POST(post({ company: 'x' }))).status).toBe(400);
    expect((await own.POST(post({ company: 9 }))).status).toBe(403);
    m.registerOwnSignature.mockRejectedValue(new SgcError('Solo puede registrar SU propia firma: el correo es el de su sesión.', 403));
    expect((await own.POST(post(body))).status).toBe(403);
    m.getMySignature.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await own.GET(get('?company=3'))).status).toBe(500);
    spy.mockRestore();
  });

  it('[SGC-REQ-141] validar una firma es solo de Aseguramiento de Calidad', async () => {
    asUser([lectura]);
    expect((await validate.POST(post({ company: 3, reason: 'Comparada con la cédula' }), params('5'))).status).toBe(403);
    asUser([calidad]);
    m.validateSignatureMaster.mockResolvedValue({ ok: true, status: 'validada' });
    expect(await (await validate.POST(post({ company: 3, reason: 'Comparada con la cédula' }), params('5'))).json()).toEqual({ ok: true, status: 'validada' });
    expect(m.validateSignatureMaster.mock.calls[0].slice(1, 4)).toEqual([OLP, 5, { reason: 'Comparada con la cédula' }]);
    expect((await validate.POST(post({ company: 3 }), params('x'))).status).toBe(400);
    m.validateSignatureMaster.mockRejectedValue(new SgcError('Nadie valida su propia firma.', 403));
    expect((await validate.POST(post({ company: 3, reason: 'Comparada' }), params('5'))).status).toBe(403);
  });
});
