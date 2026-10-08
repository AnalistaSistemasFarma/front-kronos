import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 10 (bandera de capacitación de la solicitud y recapacitación) con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'companyOfRequest', 'setTrainingFlag', 'recordRetraining'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('@/lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('@/lib/sgc/db/requests', () => ({ companyOfRequest: m.companyOfRequest, setTrainingFlag: m.setTrainingFlag }));
vi.mock('@/lib/sgc/db/training', () => ({ recordRetraining: m.recordRetraining }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as flag from '../requests/[id]/training-flag/route';
import * as retraining from '../requests/[id]/training/retraining/route';

const OLP = 3;
const gestion = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: true, canQuality: false, canAdminFlows: false };
const EMAIL = 'elab@onelatampharma.com';
function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
}
const req = (body: unknown, method = 'PUT') => new Request('http://x', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.1.1' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas del S10', () => {
  it('[SGC-REQ-007] sin sesión responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await flag.PUT(req({}), params('1'))).status).toBe(401);
    expect((await retraining.POST(req({}, 'POST'), params('1'))).status).toBe(401);
  });

  it('[SGC-REQ-122] confirmar la capacitación de la solicitud pasa la persona y su acceso a la empresa', async () => {
    asUser([gestion]);
    m.companyOfRequest.mockResolvedValue(OLP);
    m.setTrainingFlag.mockResolvedValueOnce({ requiresTraining: false }).mockRejectedValueOnce(new SgcError('La capacitación ya no se cambia', 409));
    const ok = await flag.PUT(req({ requiresTraining: false, reason: 'Es un manual sin práctica' }), params('7'));
    expect(ok.status).toBe(200);
    expect(m.setTrainingFlag.mock.calls[0].slice(1)).toEqual([7, { requiresTraining: false, reason: 'Es un manual sin práctica' }, expect.objectContaining({ email: EMAIL }), gestion]);
    expect((await flag.PUT(req({ requiresTraining: true }), params('7'))).status).toBe(409);
    expect((await flag.PUT(req(undefined), params('7'))).status).toBe(400);
    expect((await flag.PUT(req({}), params('x'))).status).toBe(400);
    m.companyOfRequest.mockResolvedValue(99);
    expect((await flag.PUT(req({ requiresTraining: true }), params('7'))).status).toBe(404);
  });

  it('[SGC-REQ-126] registrar la recapacitación (201) con el acceso de la empresa de la solicitud', async () => {
    asUser([gestion]);
    m.companyOfRequest.mockResolvedValue(OLP);
    m.recordRetraining.mockResolvedValue({ idRetraining: 4 });
    const r = await retraining.POST(req({ email: 'b@olp.co', mode: 'virtual', sessionDate: '2026-11-01', result: 'aprobo' }, 'POST'), params('7'));
    expect(r.status).toBe(201);
    expect(m.recordRetraining.mock.calls[0][1]).toBe(gestion);
    expect((await retraining.POST(req(undefined, 'POST'), params('7'))).status).toBe(400);
    m.companyOfRequest.mockResolvedValue(99);
    expect((await retraining.POST(req({}, 'POST'), params('7'))).status).toBe(404);
    m.companyOfRequest.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await retraining.POST(req({}, 'POST'), params('7'))).status).toBe(500);
    expect((await flag.PUT(req({}), params('7'))).status).toBe(500);
    spy.mockRestore();
  });
});
