import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sprint 6 — endurecimiento de las rutas /api/sgc/** con la sesión y la base
// simuladas: límite de tasa (429 con Retry-After), cuerpo máximo y acceso
// antes de leer un formulario con archivos (413/403), el visor no consulta ni
// audita a quien no tiene ningún acceso al SGC, y los datos de quién registró
// a cada persona por cargo quedan solo para Calidad.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'getVersionForViewer', 'createInitialDocument', 'listMasterDocuments',
    'auditCreate', 'downloadVerifiedPdf', 'getIcalFeed', 'listCargoMembers', 'addCargoMember', 'uploadAttachment', 'createAccessRequest',
    'listAccessRequests', 'listRequestableDocuments', 'verifyVersionByCode',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { sgcAuditLog: { create: m.auditCreate } } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({
  getAccessSubject: m.getAccessSubject,
  getVersionForViewer: m.getVersionForViewer,
  createInitialDocument: m.createInitialDocument,
  listMasterDocuments: m.listMasterDocuments,
}));
vi.mock('../../../../lib/sgc/onedrive', () => ({ uploadToSgcStorage: vi.fn(), downloadVerifiedPdf: m.downloadVerifiedPdf }));
vi.mock('../../../../lib/sgc/db/ical', () => ({ getIcalFeed: m.getIcalFeed }));
vi.mock('../../../../lib/sgc/db/cargoMembers', () => ({ listCargoMembers: m.listCargoMembers, addCargoMember: m.addCargoMember }));
vi.mock('../../../../lib/sgc/db/requests', () => ({ uploadAttachment: m.uploadAttachment }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'notifier' }));
vi.mock('../../../../lib/sgc/db/accessRequests', () => ({ createAccessRequest: m.createAccessRequest, listAccessRequests: m.listAccessRequests, listRequestableDocuments: m.listRequestableDocuments }));
vi.mock('../../../../lib/sgc/db/verify', () => ({ verifyVersionByCode: m.verifyVersionByCode }));

import { GET as getFile } from '../documents/[id]/versions/[versionId]/file/route';
import { POST as postDoc } from '../documents/route';
import { GET as icalFeed } from '../ical/[token]/route';
import { GET as getCargos } from '../cargo-members/route';
import { POST as postAttachment } from '../requests/[id]/attachments/route';
import { POST as postAccessRequest } from '../access-requests/route';
import { GET as verify } from '../verify/route';
import { SGC_RATE_RULES } from '../../../../lib/sgc/rateLimit';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
let EMAIL = 'qa.s6@gsslatam.com';

function asUser(access: object[], email = EMAIL) {
  m.getServerSession.mockResolvedValue({ user: { email } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email, departmentIds: [3] });
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const multipart = (contentLength: string) =>
  new Request('http://x/api/sgc/documents', { method: 'POST', body: 'x', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': contentLength } });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  // Cada prueba con su propia persona: el limitador es del proceso.
  EMAIL = `qa.s6.${Math.random().toString(36).slice(2)}@gsslatam.com`;
});

describe('SGC · S6 · rutas endurecidas', () => {
  it('[SGC-REQ-081] sin ningún acceso al SGC el visor responde 403 sin consultar la base ni escribir auditoría', async () => {
    asUser([]);
    const r = await getFile(new Request('http://x/api/sgc/documents/1/versions/1/file'), params({ id: '1', versionId: '1' }));
    expect(r.status).toBe(403);
    expect(m.getVersionForViewer).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-080] el visor corta las ráfagas de una persona con 429 y Retry-After', async () => {
    asUser([lectura]);
    m.getVersionForViewer.mockResolvedValue(null);
    let last: Response | null = null;
    for (let i = 0; i <= SGC_RATE_RULES.archivo.max; i++) last = await getFile(new Request('http://x/api/sgc/documents/1/versions/1/file'), params({ id: '1', versionId: '1' }));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(m.getVersionForViewer).toHaveBeenCalledTimes(SGC_RATE_RULES.archivo.max);
  });

  it('[SGC-REQ-080] verificar por código y pedir accesos también tienen límite', async () => {
    asUser([lectura]);
    m.verifyVersionByCode.mockResolvedValue({ verdict: 'vigente' });
    let v: Response | null = null;
    for (let i = 0; i <= SGC_RATE_RULES.verificacion.max; i++) v = await verify(new Request('http://x/api/sgc/verify?empresa=3&codigo=A&version=1'));
    expect(v!.status).toBe(429);
    m.createAccessRequest.mockResolvedValue({ idAccessRequest: 1, message: 'ok' });
    let a: Response | null = null;
    for (let i = 0; i <= SGC_RATE_RULES.solicitudAcceso.max; i++) {
      a = await postAccessRequest(new Request('http://x/api/sgc/access-requests', { method: 'POST', body: JSON.stringify({ company: OLP, code: 'X', justification: 'Necesito consultarlo' }), headers: { 'content-type': 'application/json' } }));
    }
    expect(a!.status).toBe(429);
    expect(m.createAccessRequest).toHaveBeenCalledTimes(SGC_RATE_RULES.solicitudAcceso.max);
  });

  it('[SGC-REQ-080] el iCal público limita por IP y su respuesta lleva nosniff', async () => {
    m.getIcalFeed.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const ip = `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const call = () => icalFeed(new Request('http://x/api/sgc/ical/tok.ics', { headers: { 'x-forwarded-for': `${ip}:5000` } }), params({ token: 'tok.ics' }));
    const first = await call();
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Content-Type-Options')).toBe('nosniff');
    let last: Response = first;
    for (let i = 1; i <= SGC_RATE_RULES.ical.max; i++) last = await call();
    expect(last.status).toBe(429);
  });

  it('[SGC-REQ-081] un formulario con archivos demasiado grande o de quien no tiene acceso se rechaza ANTES de leerlo', async () => {
    asUser([lectura]);
    expect((await postDoc(multipart(String(200 * 1024 * 1024)))).status).toBe(413);
    // Con consulta (sin Calidad) la carga de vigentes se rechaza sin leer el cuerpo.
    expect((await postDoc(multipart('100'))).status).toBe(403);
    expect(m.createInitialDocument).not.toHaveBeenCalled();
    asUser([]);
    const att = await postAttachment(multipart('100'), params({ id: '5' }));
    expect(att.status).toBe(403);
    expect(m.uploadAttachment).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-091] quién registró a cada persona por cargo (y por qué) solo lo ve Calidad', async () => {
    const data = { cargos: [{ id: 1, name: 'Jefe' }], members: [{ id: 9, idCargo: 1, cargo: 'Jefe', email: 'p@x.co', name: 'P', addedBy: 'cal@x.co', addedAt: '2026-10-01', reason: 'Inducción' }] };
    m.listCargoMembers.mockResolvedValue(data);
    asUser([lectura]);
    const r1 = await (await getCargos(new Request('http://x/api/sgc/cargo-members?company=3'))).json();
    expect(r1.members[0]).toEqual({ id: 9, idCargo: 1, cargo: 'Jefe', email: 'p@x.co', name: 'P', addedAt: '2026-10-01' });
    asUser([calidad]);
    const r2 = await (await getCargos(new Request('http://x/api/sgc/cargo-members?company=3'))).json();
    expect(r2.members[0]).toMatchObject({ addedBy: 'cal@x.co', reason: 'Inducción' });
  });
});
