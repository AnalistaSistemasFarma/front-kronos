import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 11 (copias no controladas y eventos del visor) con la sesión, la base y OneDrive simulados.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'getCopyConfig', 'listCopiesForQuality', 'listMyCopies', 'requestUncontrolledCopy', 'decideUncontrolledCopy', 'cancelUncontrolledCopy', 'consumeUncontrolledCopy', 'downloadVerifiedPdf', 'auditCreate'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma', sgcAuditLog: { create: m.auditCreate } } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'notificador' }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadVerifiedPdf: m.downloadVerifiedPdf }));
vi.mock('../../../../lib/sgc/db/uncontrolledCopies', () => ({
  getCopyConfig: m.getCopyConfig,
  listCopiesForQuality: m.listCopiesForQuality,
  listMyCopies: m.listMyCopies,
  requestUncontrolledCopy: m.requestUncontrolledCopy,
  decideUncontrolledCopy: m.decideUncontrolledCopy,
  cancelUncontrolledCopy: m.cancelUncontrolledCopy,
  consumeUncontrolledCopy: m.consumeUncontrolledCopy,
}));

import { SgcError } from '../../../../lib/sgc/errors';
import * as copies from '../uncontrolled-copies/route';
import * as decision from '../uncontrolled-copies/[id]/decision/route';
import * as cancel from '../uncontrolled-copies/[id]/cancel/route';
import * as file from '../uncontrolled-copies/[id]/file/route';
import * as events from '../viewer-events/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const EMAIL = 'ana@onelatampharma.com';
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

describe('Rutas del S11 · copias no controladas', () => {
  it('[SGC-REQ-007] sin sesión responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const all = await Promise.all([copies.GET(get('?company=3')), copies.POST(post({})), decision.POST(post({}), params('1')), cancel.POST(post({}), params('1')), file.GET(get(''), params('1')), events.POST(post({}))]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
  });

  it('[SGC-REQ-127][SGC-REQ-128] pedir, listar «mías» o las de Calidad, decidir y cancelar, con la persona de la sesión', async () => {
    asUser([lectura]);
    m.getCopyConfig.mockResolvedValue({ types: ['FO'], days: 30, maxDays: 90 });
    m.listMyCopies.mockResolvedValue([{ id: 1 }]);
    m.listCopiesForQuality.mockResolvedValue({ canDecide: true, copies: [] });
    m.requestUncontrolledCopy.mockResolvedValue({ idCopyRequest: 5 });
    m.decideUncontrolledCopy.mockResolvedValue({ status: 'autorizada' });
    m.cancelUncontrolledCopy.mockResolvedValue({ status: 'cancelada' });
    expect(await (await copies.GET(get('?company=3'))).json()).toEqual({ config: { types: ['FO'], days: 30, maxDays: 90 }, copies: [{ id: 1 }] });
    expect(await (await copies.GET(get('?company=3&vista=calidad&estado=pendiente'))).json()).toMatchObject({ canDecide: true });
    expect(m.listCopiesForQuality).toHaveBeenCalledWith({ tag: 'prisma', sgcAuditLog: expect.anything() }, lectura, EMAIL, { status: 'pendiente' });
    expect((await copies.GET(get(''))).status).toBe(400);
    expect((await copies.GET(get('?company=9'))).status).toBe(403);
    expect((await copies.POST(post({ company: 3, idDocument: 7, justification: 'x' }))).status).toBe(201);
    expect(m.requestUncontrolledCopy.mock.calls[0][5]).toMatchObject({ email: EMAIL, ip: '10.4.4.4' });
    expect((await copies.POST(post({}))).status).toBe(400);
    expect((await copies.POST(post({ company: 9 }))).status).toBe(403);
    expect((await decision.POST(post({ company: 3, decision: 'autorizar', reason: 'ok ok ok ok' }), params('5'))).status).toBe(200);
    expect(m.decideUncontrolledCopy.mock.calls[0].slice(2, 4)).toEqual([lectura, 5]);
    expect((await decision.POST(post({ company: 3 }), params('x'))).status).toBe(400);
    expect((await decision.POST(post({ company: 9 }), params('5'))).status).toBe(403);
    m.decideUncontrolledCopy.mockRejectedValue(new SgcError('Solo el grupo de Calidad…', 403));
    expect((await decision.POST(post({ company: 3 }), params('5'))).status).toBe(403);
    expect(await (await cancel.POST(post({ company: 3 }), params('5'))).json()).toEqual({ status: 'cancelada' });
    expect((await cancel.POST(post({}), params('5'))).status).toBe(400);
    expect((await cancel.POST(post({ company: 9 }), params('5'))).status).toBe(403);
    m.listMyCopies.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await copies.GET(get('?company=3'))).status).toBe(500);
    m.cancelUncontrolledCopy.mockRejectedValue(new Error('caída'));
    expect((await cancel.POST(post({ company: 3 }), params('5'))).status).toBe(500);
    m.requestUncontrolledCopy.mockRejectedValue(new Error('caída'));
    expect((await copies.POST(post({ company: 3 }))).status).toBe(500);
    spy.mockRestore();
  });

  it('[SGC-REQ-129] la copia autorizada sale estampada «COPIA NO CONTROLADA»: impresión en línea; descarga como adjunto', async () => {
    asUser([lectura]);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    m.downloadVerifiedPdf.mockResolvedValue(await pdf.save());
    m.consumeUncontrolledCopy.mockResolvedValue({ code: 'OLP-FO-01', versionNumber: 1, pdfItemId: 'it', pdfSha256: 'h', requesterEmail: EMAIL, authorizedBy: 'mc@olp.co', authorizedAt: new Date(), expiresAt: new Date(), destination: null });
    const p = await file.GET(get('?modo=impresion'), params('5'));
    expect(p.status).toBe(200);
    expect(p.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(m.consumeUncontrolledCopy.mock.calls[0].slice(1, 3)).toEqual([5, 'impresion']);
    expect((await PDFDocument.load(new Uint8Array(await p.arrayBuffer()), { updateMetadata: false })).getProducer()).toContain('NO controlada');
    const d = await file.GET(get('?modo=descarga'), params('5'));
    expect(d.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect((await file.GET(get(''), params('0'))).status).toBe(400);
    m.consumeUncontrolledCopy.mockRejectedValue(new SgcError('La copia no controlada venció: pida una nueva.', 403));
    expect((await file.GET(get(''), params('5'))).status).toBe(403);
  });
});

describe('Rutas del S11 · eventos del visor', () => {
  it('[SGC-REQ-131] el intento de captura queda en la auditoría; eventos o recursos inválidos se rechazan', async () => {
    asUser([lectura]);
    const ok = await events.POST(post({ event: 'imprimir_pantalla', resource: '/api/sgc/documents/7/versions/11/file' }));
    expect(ok.status).toBe(201);
    expect(m.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'documento.visor_evento', actor_email: EMAIL, entity_id: 'imprimir_pantalla', id_company: OLP }) });
    expect((await events.POST(post({ event: 'otro', resource: '/api/sgc/x' }))).status).toBe(400);
    expect((await events.POST(post({ event: 'copiar', resource: 'https://x' }))).status).toBe(400);
    asUser([]);
    expect((await events.POST(post({ event: 'copiar', resource: '/api/sgc/x' }))).status).toBe(403);
    asUser([lectura, { ...lectura, idCompany: 4 }]);
    await events.POST(post({ event: 'copiar', resource: '/api/sgc/x' }));
    expect(m.auditCreate.mock.calls.at(-1)?.[0].data.id_company).toBeNull();
    m.auditCreate.mockRejectedValue(new Error('caída'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await events.POST(post({ event: 'imprimir_bloqueado', resource: '/api/sgc/x' }))).status).toBe(500);
    spy.mockRestore();
  });
});
