import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta de «Relacionar con padre» (documentos padre e hijos, 2026-10-19) con la
// sesión y la base simuladas. Las reglas van en lib/sgc/__tests__/padres-hijos.test.ts
// y, contra un SQL Server real, en tests/integration/sgc/padres-hijos.integration.test.ts.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'getParentOptions', 'setDocumentParent'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/db/relations', () => ({ getParentOptions: m.getParentOptions, setDocumentParent: m.setDocumentParent }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as parent from '../relations/parent/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'qa.sgc@gsslatam.com';
const ACTOR = { email: EMAIL, ip: '10.0.0.7', userAgent: 'vitest' };
const H = { 'x-forwarded-for': '10.0.0.7:4444', 'user-agent': 'vitest' };
const post = (body: unknown) => new Request('http://x/', { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (url: string) => new Request(`http://x${url}`, { headers: H });

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Ruta «Relacionar con padre»', () => {
  it('[SGC-REQ-007] sin sesión responde 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await parent.GET(get('/?document=1'))).status).toBe(401);
    expect((await parent.POST(post({}))).status).toBe(401);
  });

  it('[SGC-REQ-183] consulta las opciones del documento con el acceso de la SESIÓN; sin documento, 400', async () => {
    asUser([calidad]);
    m.getParentOptions.mockResolvedValue({ isParentType: false, parent: null, candidates: [] });
    expect((await parent.GET(get('/?document=7'))).status).toBe(200);
    expect(m.getParentOptions).toHaveBeenCalledWith({ tag: 'prisma' }, [calidad], 7);
    expect((await parent.GET(get('/'))).status).toBe(400);
    expect((await parent.GET(get('/?document=x'))).status).toBe(400);
  });

  it('[SGC-REQ-183] relaciona con el actor de la sesión (IP y navegador); la regla de negocio sale con su estado y mensaje', async () => {
    asUser([calidad]);
    m.setDocumentParent.mockResolvedValue({ id_document_relation: 9 });
    const body = { idChild: 2, idParent: 1, reason: 'Formato del procedimiento 01', via: 'arrastre' };
    expect((await parent.POST(post(body))).status).toBe(201);
    expect(m.setDocumentParent).toHaveBeenCalledWith({ tag: 'prisma' }, [calidad], body, ACTOR);
    expect((await parent.POST(new Request('http://x', { method: 'POST', body: 'no' }))).status).toBe(400);
    asUser([lectura]);
    m.setDocumentParent.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad relaciona documentos.', 403));
    const denied = await parent.POST(post(body));
    expect(denied.status).toBe(403);
    m.setDocumentParent.mockRejectedValue(new SgcError('OLP-GGC-01-FR-001 ya tiene documento padre: un hijo tiene un solo padre.', 409));
    const conflict = await parent.POST(post(body));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toMatch(/un solo padre/);
  });
});
