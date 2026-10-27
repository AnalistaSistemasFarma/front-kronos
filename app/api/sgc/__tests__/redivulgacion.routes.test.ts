import { beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-10-26: ruta de la REDIVULGACIÓN de un documento vigente (vista previa y
// creación, solo Calidad), con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'previewRedissemination', 'createRedissemination'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'avisos' }));
vi.mock('../../../../lib/sgc/db/requests', () => ({ previewRedissemination: m.previewRedissemination, createRedissemination: m.createRedissemination }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as route from '../documents/[id]/redissemination/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: true, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'maria.camila@onelatampharma.com';
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas · redivulgación de un documento vigente', () => {
  it('[SGC-REQ-053] sin sesión 401; inválida 400; otra empresa 404; sin Calidad 403', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await route.POST(post({ company: 3 }), params('7'))).status).toBe(401);
    asUser([lectura]);
    expect((await route.POST(post({ company: 3 }), params('x'))).status).toBe(400);
    expect((await route.POST(post({ company: 99, action: 'crear' }), params('7'))).status).toBe(404);
    expect((await route.POST(post({ company: 3, action: 'crear' }), params('7'))).status).toBe(403);
    asUser([calidad]);
    expect((await route.POST(post({ company: 3, action: 'otra' }), params('7'))).status).toBe(400);
    expect(m.createRedissemination).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-053] vista previa y creación (201) con el alcance, el motivo y la confirmación; los errores de negocio con su mensaje', async () => {
    asUser([calidad]);
    m.previewRedissemination.mockResolvedValue({ readers: 3, alreadyRead: 1 });
    const entries = [{ kind: 'departamento', idDepartment: 4 }];
    expect(await (await route.POST(post({ company: 3, action: 'vista_previa', entries }), params('7'))).json()).toEqual({ readers: 3, alreadyRead: 1 });
    expect(m.previewRedissemination.mock.calls[0][2]).toEqual({ idDocument: 7, entries, reason: undefined, confirmRepeat: undefined });
    m.createRedissemination.mockResolvedValue({ idRequest: 55 });
    const res = await route.POST(post({ company: 3, action: 'crear', entries, reason: 'Reinducción anual', confirmRepeat: true }), params('7'));
    expect(res.status).toBe(201);
    const [db, notifier, access, input, actor] = m.createRedissemination.mock.calls[0];
    expect([db, notifier, access.idCompany, input, actor.email]).toEqual([{ tag: 'prisma' }, 'avisos', 3, { idDocument: 7, entries, reason: 'Reinducción anual', confirmRepeat: true }, EMAIL]);
    m.createRedissemination.mockRejectedValue(new SgcError('1 persona(s) del alcance ya leyeron la versión 1: Confírmelo para continuar.', 409));
    const bad = await route.POST(post({ company: 3, action: 'crear', entries, reason: 'Reinducción anual' }), params('7'));
    expect(bad.status).toBe(409);
    expect((await bad.json()).error).toMatch(/Confírmelo/);
  });
});
