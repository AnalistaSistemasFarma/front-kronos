import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 12 (aprobadores autorizados y firmante sustituto) con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'listApproverAuthorizations', 'grantApproverAuthorization', 'revokeApproverAuthorization', 'listApproverOptions', 'listEligibleUsers', 'assignSubstitute', 'requestOfTask'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'notificador' }));
vi.mock('../../../../lib/sgc/db/approvers', () => ({
  listApproverAuthorizations: m.listApproverAuthorizations,
  grantApproverAuthorization: m.grantApproverAuthorization,
  revokeApproverAuthorization: m.revokeApproverAuthorization,
  listApproverOptions: m.listApproverOptions,
}));
vi.mock('../../../../lib/sgc/db/requests', () => ({ listEligibleUsers: m.listEligibleUsers, assignSubstitute: m.assignSubstitute, requestOfTask: m.requestOfTask }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as approvers from '../approvers/route';
import * as revoke from '../approvers/[id]/revoke/route';
import * as substitute from '../tasks/[id]/substitute/route';
import * as users from '../users/route';

const OLP = 3;
const calidad = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: true, canQuality: true, canAdminFlows: false };
const lectura = { ...calidad, canManage: false, canQuality: false };
const EMAIL = 'mc@onelatampharma.com';
function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
}
const H = { 'x-forwarded-for': '10.4.4.4', 'user-agent': 'vitest' };
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (q: string) => new Request(`http://x/api${q}`, { headers: H });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas del S12 · aprobadores autorizados', () => {
  it('[SGC-REQ-007] sin sesión responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const all = await Promise.all([approvers.GET(get('?company=3')), approvers.POST(post({})), revoke.POST(post({}), params('1')), substitute.POST(post({}), params('1'))]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
  });

  it('[SGC-REQ-132][SGC-REQ-133] listar, autorizar y revocar pasan el acceso de la empresa (Calidad lo valida el servidor)', async () => {
    asUser([calidad]);
    m.listApproverAuthorizations.mockResolvedValue({ enforced: true, applies: false, items: [] });
    m.grantApproverAuthorization.mockResolvedValue({ id: 4 });
    m.revokeApproverAuthorization.mockResolvedValue({ revoked: true });
    expect(await (await approvers.GET(get('?company=3'))).json()).toEqual({ enforced: true, applies: false, items: [] });
    expect(m.listApproverAuthorizations).toHaveBeenCalledWith({ tag: 'prisma' }, calidad);
    expect((await approvers.GET(get(''))).status).toBe(400);
    await approvers.GET(get('?company=9'));
    expect(m.listApproverAuthorizations.mock.calls.at(-1)?.[1]).toBeNull();
    expect(await (await approvers.POST(post({ company: 3, email: 'jefe@olp.co', reason: 'Jefe de calidad' }))).json()).toEqual({ id: 4 });
    expect(m.grantApproverAuthorization.mock.calls[0][1]).toBe(calidad);
    expect(m.grantApproverAuthorization.mock.calls[0][3]).toMatchObject({ email: EMAIL, ip: '10.4.4.4' });
    expect((await approvers.POST(post({ company: 'x' }))).status).toBe(400);
    expect(await (await revoke.POST(post({ company: 3, reason: 'Cambió de cargo' }), params('4'))).json()).toEqual({ revoked: true });
    expect(m.revokeApproverAuthorization.mock.calls[0].slice(1, 3)).toEqual([calidad, 4]);
    expect((await revoke.POST(post({ company: 3 }), params('x'))).status).toBe(400);
    asUser([lectura]);
    m.grantApproverAuthorization.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad administra la lista de aprobadores autorizados.', 403));
    expect((await approvers.POST(post({ company: 3 }))).status).toBe(403);
    m.listApproverAuthorizations.mockRejectedValue(new Error('caída'));
    m.revokeApproverAuthorization.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await approvers.GET(get('?company=3'))).status).toBe(500);
    expect((await revoke.POST(post({ company: 3 }), params('4'))).status).toBe(500);
    spy.mockRestore();
  });

  it('[SGC-REQ-139] con role=aprobador la lista de personas se filtra por los aprobadores autorizados del proceso', async () => {
    asUser([lectura]);
    m.listApproverOptions.mockResolvedValue({ restricted: true, users: [{ email: 'jefe@olp.co', name: 'Jefe' }] });
    m.listEligibleUsers.mockResolvedValue([{ email: 'a@olp.co', name: null }]);
    expect(await (await users.GET(get('?company=3&role=aprobador&process=5'))).json()).toEqual({ restricted: true, users: [{ email: 'jefe@olp.co', name: 'Jefe' }] });
    expect(m.listApproverOptions.mock.calls[0].slice(1, 3)).toEqual([OLP, 5]);
    await users.GET(get('?company=3&role=aprobador&process=abc'));
    expect(m.listApproverOptions.mock.calls[1][2]).toBeNull();
    expect(await (await users.GET(get('?company=3'))).json()).toEqual({ users: [{ email: 'a@olp.co', name: null }] });
  });
});

describe('Rutas del S12 · firmante sustituto', () => {
  it('[SGC-REQ-135] asignar sustituto: tarea de la empresa del usuario; el grupo exclusivo lo valida el servidor', async () => {
    asUser([lectura]);
    m.requestOfTask.mockResolvedValue({ idRequest: 1, idCompany: OLP });
    m.assignSubstitute.mockResolvedValue({ idAssignee: 77 });
    const body = { idAssignee: 5, toEmail: 'sust@olp.co', reason: 'Vacaciones del titular' };
    expect(await (await substitute.POST(post(body), params('9'))).json()).toEqual({ idAssignee: 77 });
    expect(m.assignSubstitute.mock.calls[0].slice(1, 4)).toEqual(['notificador', 9, body]);
    expect(m.assignSubstitute.mock.calls[0][4]).toMatchObject({ email: EMAIL, ip: '10.4.4.4' });
    expect((await substitute.POST(post(body), params('x'))).status).toBe(400);
    m.requestOfTask.mockResolvedValue({ idRequest: 1, idCompany: 9 });
    expect((await substitute.POST(post(body), params('9'))).status).toBe(404);
    m.requestOfTask.mockResolvedValue({ idRequest: 1, idCompany: OLP });
    m.assignSubstitute.mockRejectedValue(new SgcError('Solo el grupo exclusivo de Calidad «Firmantes sustitutos» (SGC-SUSTITUTOS) asigna un firmante sustituto.', 403));
    expect((await substitute.POST(post(body), params('9'))).status).toBe(403);
  });
});
