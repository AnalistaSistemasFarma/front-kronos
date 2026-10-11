import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 5 (/api/sgc/**: mapa de relaciones, calendario y avisos
// de vencimiento, iCal privado y solicitudes de acceso) con la sesión y la
// base simuladas. Las reglas van en lib/sgc/__tests__ y, contra un SQL Server
// real con reloj controlado, en tests/integration/sgc/vencimientos.integration.test.ts.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getSgcAccessForUser', 'getAccessSubject',
    'getRelationGraph', 'addDocumentRelation', 'removeDocumentRelation', 'saveGraphLayout', 'listDocumentRelations',
    'listReviewCalendar', 'getAlertSchedulerStatus', 'listAlertConfigs', 'saveAlertConfig', 'listAlertLog', 'runDailySgcJob', 'sgcAlertDeps',
    'createIcalToken', 'getIcalStatus', 'revokeIcalToken', 'getIcalFeed',
    'createAccessRequest', 'listAccessRequests', 'listRequestableDocuments', 'decideAccessRequest', 'cancelAccessRequest',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'notifier' }));
vi.mock('../../../../lib/sgc/db/relations', () => ({ getRelationGraph: m.getRelationGraph, addDocumentRelation: m.addDocumentRelation, removeDocumentRelation: m.removeDocumentRelation, saveGraphLayout: m.saveGraphLayout, listDocumentRelations: m.listDocumentRelations }));
vi.mock('../../../../lib/sgc/db/reviewAlerts', () => ({ listReviewCalendar: m.listReviewCalendar, getAlertSchedulerStatus: m.getAlertSchedulerStatus, listAlertConfigs: m.listAlertConfigs, saveAlertConfig: m.saveAlertConfig, listAlertLog: m.listAlertLog, runDailySgcJob: m.runDailySgcJob }));
vi.mock('../../../../lib/sgc/alerts/job', () => ({ sgcAlertDeps: m.sgcAlertDeps }));
vi.mock('../../../../lib/sgc/db/ical', () => ({ createIcalToken: m.createIcalToken, getIcalStatus: m.getIcalStatus, revokeIcalToken: m.revokeIcalToken, getIcalFeed: m.getIcalFeed }));
vi.mock('../../../../lib/sgc/db/accessRequests', () => ({ createAccessRequest: m.createAccessRequest, listAccessRequests: m.listAccessRequests, listRequestableDocuments: m.listRequestableDocuments, decideAccessRequest: m.decideAccessRequest, cancelAccessRequest: m.cancelAccessRequest }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as relations from '../relations/route';
import * as relRemove from '../relations/[id]/remove/route';
import * as layout from '../relations/layout/route';
import * as docRelations from '../documents/[id]/relations/route';
import * as calendar from '../review-calendar/route';
import * as config from '../review-alerts/config/route';
import * as log from '../review-alerts/log/route';
import * as run from '../review-alerts/run/route';
import * as ical from '../ical/route';
import * as feed from '../ical/[token]/route';
import * as accessReq from '../access-requests/route';
import * as decide from '../access-requests/[id]/decide/route';
import * as cancel from '../access-requests/[id]/cancel/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const gestion = { ...lectura, canManage: true };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'qa.sgc@gsslatam.com';
const SUBJECT = { email: EMAIL, departmentIds: [3] };
const ACTOR = { email: EMAIL, ip: '10.0.0.7', userAgent: 'vitest' };

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue(SUBJECT);
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const H = { 'x-forwarded-for': '10.0.0.7:4444', 'user-agent': 'vitest' };
const req = (url: string, body?: unknown, method = 'POST') => new Request(`http://x${url}`, body === undefined ? { method, headers: H } : { method, body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (url: string) => new Request(`http://x${url}`, { headers: H });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas S5 · sesión obligatoria', () => {
  it('[SGC-REQ-007] sin sesión todas las rutas del S5 responden 401 (salvo el iCal, que va por token)', async () => {
    m.getServerSession.mockResolvedValue(null);
    const p = params({ id: '1' });
    const all = await Promise.all([
      relations.GET(get('/?company=3')), relations.POST(req('/', {})), relRemove.POST(req('/', {}), p), layout.PUT(req('/', {}, 'PUT')), docRelations.GET(get('/'), p),
      calendar.GET(get('/?company=3')), config.GET(get('/?company=3')), config.POST(req('/', {})), log.GET(get('/?company=3')), run.POST(req('/', {})),
      ical.GET(get('/?company=3')), ical.POST(req('/', {})), ical.DELETE(req('/?company=3', undefined, 'DELETE')),
      accessReq.GET(get('/?company=3')), accessReq.POST(req('/', {})), decide.POST(req('/', {}), p), cancel.POST(req('/', {}), p),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
  });
});

describe('Rutas S5 · mapa de relaciones', () => {
  it('[SGC-REQ-072][SGC-REQ-075] el mapa sale con el acceso y los departamentos de la SESIÓN (respeta permisos); obsoletos solo si se piden', async () => {
    asUser([lectura]);
    m.getRelationGraph.mockResolvedValue({ nodes: [], edges: [], layout: {}, processTypeOrder: [] });
    expect((await relations.GET(get('/?company=3'))).status).toBe(200);
    expect(m.getRelationGraph).toHaveBeenCalledWith({ tag: 'prisma' }, lectura, SUBJECT, { statuses: ['vigente'] });
    await relations.GET(get('/?company=3&obsoletos=1'));
    expect(m.getRelationGraph).toHaveBeenLastCalledWith({ tag: 'prisma' }, lectura, SUBJECT, { statuses: ['vigente', 'obsoleto'] });
    expect((await relations.GET(get('/'))).status).toBe(400);
    expect((await relations.GET(get('/?company=9'))).status).toBe(403);
  });

  it('[SGC-REQ-071] registrar, retirar y relaciones de la ficha van a su regla; un error de negocio sale con su mensaje', async () => {
    asUser([calidad]);
    m.addDocumentRelation.mockResolvedValue({ id_document_relation: 4 });
    const body = { idSource: 1, targetCode: 'OLP-GC-FO-001', type: 'formato', note: 'n', reason: 'Formato del procedimiento' };
    expect((await relations.POST(req('/', body))).status).toBe(201);
    expect(m.addDocumentRelation).toHaveBeenCalledWith({ tag: 'prisma' }, [calidad], { ...body, idTarget: undefined }, ACTOR);
    expect((await relations.POST(new Request('http://x', { method: 'POST', body: 'no' }))).status).toBe(400);
    m.removeDocumentRelation.mockResolvedValue({ is_active: false });
    expect((await relRemove.POST(req('/', { reason: 'Ya no aplica la relación' }), params({ id: '4' }))).status).toBe(200);
    expect(m.removeDocumentRelation).toHaveBeenCalledWith({ tag: 'prisma' }, [calidad], 4, 'Ya no aplica la relación', ACTOR);
    expect((await relRemove.POST(req('/', {}), params({ id: 'x' }))).status).toBe(400);
    m.listDocumentRelations.mockResolvedValue([]);
    expect(await (await docRelations.GET(get('/'), params({ id: '7' }))).json()).toEqual({ relations: [] });
    m.listDocumentRelations.mockResolvedValue(null);
    expect((await docRelations.GET(get('/'), params({ id: '7' }))).status).toBe(404);
    expect((await docRelations.GET(get('/'), params({ id: '0' }))).status).toBe(404);
    m.addDocumentRelation.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad registra relaciones entre documentos.', 403));
    const r = await relations.POST(req('/', body));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Calidad/);
  });

  it('[SGC-REQ-073] el diseño del mapa se guarda para la persona de la sesión', async () => {
    asUser([lectura]);
    m.saveGraphLayout.mockResolvedValue({ saved: 2 });
    expect(await (await layout.PUT(req('/', { company: 3, layout: { '1': { x: 0, y: 0 } } }, 'PUT'))).json()).toEqual({ saved: 2 });
    expect(m.saveGraphLayout).toHaveBeenCalledWith({ tag: 'prisma' }, lectura, EMAIL, { '1': { x: 0, y: 0 } });
    expect((await layout.PUT(req('/', { layout: {} }, 'PUT'))).status).toBe(400);
    expect((await layout.PUT(req('/', { company: 9, layout: {} }, 'PUT'))).status).toBe(403);
  });
});

describe('Rutas S5 · calendario y avisos', () => {
  it('[SGC-REQ-067] el calendario sale con los permisos de la sesión; Calidad recibe además el estado del programador', async () => {
    asUser([gestion]);
    m.listReviewCalendar.mockResolvedValue({ today: '2026-10-01', items: [] });
    const r = await calendar.GET(get('/?company=3'));
    expect(await r.json()).toEqual({ today: '2026-10-01', items: [], me: EMAIL, canQuality: false, canManage: true, scheduler: null });
    expect(m.listReviewCalendar).toHaveBeenCalledWith({ tag: 'prisma' }, gestion, SUBJECT);
    expect(m.getAlertSchedulerStatus).not.toHaveBeenCalled();
    asUser([calidad]);
    m.getAlertSchedulerStatus.mockResolvedValue({ id: 3, active: true });
    expect((await (await calendar.GET(get('/?company=3'))).json()).scheduler).toEqual({ id: 3, active: true });
    expect((await calendar.GET(get('/'))).status).toBe(400);
    expect((await calendar.GET(get('/?company=9'))).status).toBe(403);
  });

  it('[SGC-REQ-068][SGC-REQ-070] configurar avisos, ver el registro y ejecutar ahora: solo Calidad', async () => {
    asUser([gestion]);
    expect((await config.GET(get('/?company=3'))).status).toBe(403);
    expect((await config.POST(req('/', { company: 3 }))).status).toBe(403);
    expect((await log.GET(get('/?company=3'))).status).toBe(403);
    expect((await run.POST(req('/', { company: 3 }))).status).toBe(403);
    asUser([calidad]);
    m.listAlertConfigs.mockResolvedValue([{ id: 1 }]);
    expect(await (await config.GET(get('/?company=3'))).json()).toEqual({ configs: [{ id: 1 }] });
    expect((await config.GET(get('/'))).status).toBe(400);
    m.saveAlertConfig.mockResolvedValue({ id: 2 });
    const body = { company: 3, scope: 'tipo', idDocumentType: 5, offsets: [30, 0], reason: 'Ajuste de Calidad para formatos' };
    expect((await config.POST(req('/', body))).status).toBe(201);
    expect(m.saveAlertConfig).toHaveBeenCalledWith({ tag: 'prisma' }, calidad, body, ACTOR);
    expect((await config.POST(req('/', { scope: 'x' }))).status).toBe(400);
    m.listAlertLog.mockResolvedValue([]);
    await log.GET(get('/?company=3&document=7'));
    expect(m.listAlertLog).toHaveBeenCalledWith({ tag: 'prisma' }, calidad, { idDocument: 7 });
    await log.GET(get('/?company=3'));
    expect(m.listAlertLog).toHaveBeenLastCalledWith({ tag: 'prisma' }, calidad, { idDocument: null });
    expect((await log.GET(get('/'))).status).toBe(400);
    m.sgcAlertDeps.mockReturnValue('deps');
    m.runDailySgcJob.mockResolvedValue({ sent: 1 });
    expect(await (await run.POST(req('/', { company: 3 }))).json()).toEqual({ summary: { sent: 1 } });
    expect(m.runDailySgcJob).toHaveBeenCalledWith({ tag: 'prisma' }, 'deps', { idCompany: 3, source: 'manual', actorEmail: EMAIL });
    expect((await run.POST(req('/', {}))).status).toBe(400);
    m.runDailySgcJob.mockRejectedValue(new Error('boom interno'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const e = await run.POST(req('/', { company: 3 }));
    spy.mockRestore();
    expect(e.status).toBe(500);
    expect(JSON.stringify(await e.json())).not.toContain('boom');
  });
});

describe('Rutas S5 · iCal privado', () => {
  it('[SGC-REQ-076] crear (se muestra una vez, URL pública), consultar estado y revocar el enlace de la persona', async () => {
    asUser([lectura]);
    m.getIcalStatus.mockResolvedValue({ active: false });
    expect(await (await ical.GET(get('/?company=3'))).json()).toEqual({ active: false });
    expect((await ical.GET(get('/?company=9'))).status).toBe(403);
    expect((await ical.GET(get('/'))).status).toBe(403);
    m.createIcalToken.mockResolvedValue({ token: 't'.repeat(43), path: `/api/sgc/ical/${'t'.repeat(43)}` });
    const prev = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'https://synerlink.pruebas/';
    const c = await ical.POST(req('/', { company: 3 }));
    expect(c.status).toBe(201);
    expect(await c.json()).toEqual({ url: `https://synerlink.pruebas/api/sgc/ical/${'t'.repeat(43)}`, webcal: `webcal://synerlink.pruebas/api/sgc/ical/${'t'.repeat(43)}` });
    delete process.env.NEXTAUTH_URL;
    expect((await (await ical.POST(req('/', { company: 3 }))).json()).url).toMatch(/^http:\/\/x\/api\/sgc\/ical\//);
    if (prev !== undefined) process.env.NEXTAUTH_URL = prev;
    expect(m.createIcalToken).toHaveBeenCalledWith({ tag: 'prisma' }, lectura, ACTOR);
    expect((await ical.POST(req('/', { company: 9 }))).status).toBe(403);
    m.revokeIcalToken.mockResolvedValue({ revoked: 1 });
    expect(await (await ical.DELETE(req('/?company=3', undefined, 'DELETE'))).json()).toEqual({ revoked: 1 });
    expect((await ical.DELETE(req('/', undefined, 'DELETE'))).status).toBe(403);
  });

  it('[SGC-REQ-076] el calendario por token: text/calendar sin caché; token inválido o revocado → 404 sin detalle', async () => {
    m.getIcalFeed.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const r = await feed.GET(get('/'), params({ token: `${'a'.repeat(43)}.ics` }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(await r.text()).toContain('BEGIN:VCALENDAR');
    expect(m.getIcalFeed).toHaveBeenCalledWith({ tag: 'prisma' }, 'a'.repeat(43), expect.objectContaining({ ip: '10.0.0.7', userAgent: 'vitest' }));
    m.getIcalFeed.mockResolvedValue(null);
    const n = await feed.GET(get('/'), params({ token: 'x' }));
    expect(n.status).toBe(404);
    expect(await n.text()).toBe('No encontrado');
    m.getIcalFeed.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const e = await feed.GET(get('/'), params({ token: 'x' }));
    spy.mockRestore();
    expect(e.status).toBe(500);
    expect(await e.text()).not.toContain('boom');
  });
});

describe('Rutas S5 · solicitudes de acceso', () => {
  it('[SGC-REQ-077] pedir acceso, ver mis solicitudes y los documentos que se pueden pedir, con la persona de la sesión', async () => {
    asUser([lectura]);
    m.listAccessRequests.mockResolvedValue({ mine: [], all: null });
    m.listRequestableDocuments.mockResolvedValue([{ idDocument: 2 }]);
    expect(await (await accessReq.GET(get('/?company=3'))).json()).toEqual({ mine: [], all: null, requestable: [{ idDocument: 2 }], canQuality: false });
    expect(m.listAccessRequests).toHaveBeenCalledWith({ tag: 'prisma' }, lectura, EMAIL);
    expect(m.listRequestableDocuments).toHaveBeenCalledWith({ tag: 'prisma' }, lectura, SUBJECT);
    expect((await accessReq.GET(get('/'))).status).toBe(400);
    expect((await accessReq.GET(get('/?company=9'))).status).toBe(403);
    m.createAccessRequest.mockResolvedValue({ idAccessRequest: 5, message: 'Solicitud registrada.' });
    const body = { company: 3, code: 'OLP-QA-VERIF-001', justification: 'Necesito consultarlo para auditoría' };
    expect((await accessReq.POST(req('/', body))).status).toBe(201);
    expect(m.createAccessRequest).toHaveBeenCalledWith({ tag: 'prisma' }, 'notifier', lectura, SUBJECT, { idDocument: undefined, code: 'OLP-QA-VERIF-001', justification: body.justification }, ACTOR);
    expect((await accessReq.POST(req('/', {}))).status).toBe(400);
    expect((await accessReq.POST(req('/', { company: 9 }))).status).toBe(403);
  });

  it('[SGC-REQ-078] Calidad decide (la regla verifica el permiso) y quien pidió cancela la suya', async () => {
    asUser([calidad]);
    m.decideAccessRequest.mockResolvedValue({ status: 'aprobada', idDocumentAccess: 9 });
    const d = await decide.POST(req('/', { decision: 'aprobar', reason: 'Justificación suficiente', expiresAt: null }), params({ id: '5' }));
    expect(await d.json()).toEqual({ status: 'aprobada', idDocumentAccess: 9 });
    expect(m.decideAccessRequest).toHaveBeenCalledWith({ tag: 'prisma' }, 'notifier', [calidad], 5, { decision: 'aprobar', reason: 'Justificación suficiente', expiresAt: null }, ACTOR);
    expect((await decide.POST(req('/', {}), params({ id: 'x' }))).status).toBe(400);
    expect((await decide.POST(new Request('http://x', { method: 'POST', body: 'no' }), params({ id: '5' }))).status).toBe(400);
    m.decideAccessRequest.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad decide las solicitudes de acceso.', 403));
    expect((await decide.POST(req('/', { decision: 'aprobar' }), params({ id: '5' }))).status).toBe(403);
    m.cancelAccessRequest.mockResolvedValue({ status: 'cancelada' });
    expect(await (await cancel.POST(req('/', {}), params({ id: '5' }))).json()).toEqual({ status: 'cancelada' });
    expect(m.cancelAccessRequest).toHaveBeenCalledWith({ tag: 'prisma' }, [calidad], 5, ACTOR);
    expect((await cancel.POST(req('/', {}), params({ id: '-1' }))).status).toBe(400);
  });
});
