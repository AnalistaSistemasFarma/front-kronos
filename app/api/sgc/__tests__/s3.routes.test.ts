import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 3 (/api/sgc/**: firma electrónica propia, maestro de
// firmas, borrador en la app, PDF controlado, verificación y reporte de
// auditoría) con la sesión y la base simuladas. Las reglas van en
// lib/sgc/__tests__ y, contra un SQL Server real, en
// tests/integration/sgc/firma.integration.test.ts.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getSgcAccessForUser', 'getAccessSubject',
    'signTask', 'generateControlledVersion', 'verifyDocumentVersion', 'listSignatureMasters', 'registerSignatureMaster', 'revokeSignatureMaster',
    'listDraftRevisions', 'saveDraftRevision', 'getDraftRevision', 'getVigenteBaseHtml', 'importWordToHtml',
    'getDocumentAuditReport', 'auditReportToCsv', 'requestOfTask', 'taskOfAuthorization', 'companyOfRequest', 'findUniqueOrThrow', 'sgcSignatureDeps',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { sgcRequest: { findUniqueOrThrow: m.findUniqueOrThrow } } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadSgcFile: vi.fn() }));
vi.mock('../../../../lib/sgc/pdf/render', () => ({ docxToHtml: vi.fn() }));
vi.mock('../../../../lib/sgc/signature/deps', () => ({ sgcSignatureDeps: m.sgcSignatureDeps }));
vi.mock('../../../../lib/sgc/db/requests', () => ({ requestOfTask: m.requestOfTask, taskOfAuthorization: m.taskOfAuthorization, companyOfRequest: m.companyOfRequest }));
vi.mock('../../../../lib/sgc/db/signatures', () => ({
  signTask: m.signTask, generateControlledVersion: m.generateControlledVersion, verifyDocumentVersion: m.verifyDocumentVersion,
  listSignatureMasters: m.listSignatureMasters, registerSignatureMaster: m.registerSignatureMaster, revokeSignatureMaster: m.revokeSignatureMaster,
}));
vi.mock('../../../../lib/sgc/db/drafts', () => ({
  listDraftRevisions: m.listDraftRevisions, saveDraftRevision: m.saveDraftRevision, getDraftRevision: m.getDraftRevision, getVigenteBaseHtml: m.getVigenteBaseHtml, importWordToHtml: m.importWordToHtml,
}));
vi.mock('../../../../lib/sgc/db/auditReport', () => ({ getDocumentAuditReport: m.getDocumentAuditReport, auditReportToCsv: m.auditReportToCsv }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as sign from '../tasks/[id]/sign/route';
import * as authSign from '../authorizations/[id]/sign/route';
import * as masters from '../signature/masters/route';
import * as masterRevoke from '../signature/masters/[id]/revoke/route';
import * as draft from '../requests/[id]/draft/route';
import * as draftRev from '../requests/[id]/draft/[revision]/route';
import * as draftBase from '../requests/[id]/draft/base/route';
import * as draftWord from '../requests/[id]/draft/word/route';
import * as pdf from '../requests/[id]/controlled-pdf/route';
import * as verify from '../documents/[id]/versions/[versionId]/verify/route';
import * as audit from '../documents/[id]/audit/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const gestion = { ...lectura, canManage: true };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'qa.sgc@gsslatam.com';
const PASSWORD = 'Contraseña-que-no-se-registra';

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [3] });
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const req = (url: string, body?: unknown, method = 'POST') =>
  new Request(`http://x${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7:4444', 'user-agent': 'vitest' } });
const get = (url: string) => new Request(`http://x${url}`);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.sgcSignatureDeps.mockReturnValue({ deps: true });
});

describe('Rutas S3 · sesión obligatoria', () => {
  it('[SGC-REQ-007] sin sesión todas las rutas del S3 responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const p1 = params({ id: '1' });
    const all = await Promise.all([
      sign.POST(req('/', {}), p1), authSign.POST(req('/', {}), p1), masters.GET(get('/?company=3')), masters.POST(req('/', {})), masterRevoke.POST(req('/', {}), p1),
      draft.GET(get('/'), p1), draft.POST(req('/', {}), p1), draftRev.GET(get('/'), params({ id: '1', revision: 'ultima' })), draftBase.GET(get('/'), p1), draftWord.POST(req('/', {}), p1),
      pdf.POST(req('/', {}), p1), verify.GET(get('/'), params({ id: '1', versionId: '2' })), audit.GET(get('/'), p1),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
    expect(m.signTask).not.toHaveBeenCalled();
  });
});

describe('Rutas S3 · firmar', () => {
  it('[SGC-REQ-038][SGC-REQ-049] firmar una tarea pasa la contraseña SOLO al servicio de firma propio (sin Orión) con el origen de la sesión', async () => {
    asUser([gestion]);
    m.requestOfTask.mockResolvedValue({ idRequest: 5, idCompany: OLP });
    m.signTask.mockResolvedValue({ outcome: 'resuelta', next: 'revision', controlledPdf: { status: null } });
    const body = { meaning: 'elaboro', reason: 'Soy el autor', consentAccepted: true, password: PASSWORD };
    const r = await sign.POST(req('/api/sgc/tasks/9/sign', body), params({ id: '9' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(await r.json()).toMatchObject({ outcome: 'resuelta' });
    expect(m.signTask).toHaveBeenCalledWith(expect.anything(), { deps: true }, 9, body, { email: EMAIL, ip: '10.0.0.7', userAgent: 'vitest' });
    m.requestOfTask.mockResolvedValue({ idRequest: 5, idCompany: 99 });
    expect((await sign.POST(req('/', body), params({ id: '9' }))).status).toBe(404);
    expect((await sign.POST(req('/', body), params({ id: 'x' }))).status).toBe(400);
    expect((await sign.POST(new Request('http://x', { method: 'POST', body: 'no' }), params({ id: '9' }))).status).toBe(400);
  });

  it('[SGC-REQ-038] una contraseña incorrecta responde 403 con el mensaje de negocio y no filtra nada más', async () => {
    asUser([gestion]);
    m.requestOfTask.mockResolvedValue({ idRequest: 5, idCompany: OLP });
    m.signTask.mockRejectedValue(new SgcError('Contraseña incorrecta: no se firmó. Escriba su contraseña de SynerLink.', 403));
    const r = await sign.POST(req('/', { password: PASSWORD }), params({ id: '9' }));
    expect(r.status).toBe(403);
    const txt = JSON.stringify(await r.json());
    expect(txt).toContain('no se firmó');
    expect(txt).not.toContain(PASSWORD);
    m.signTask.mockRejectedValue(new Error(`fallo interno con ${PASSWORD}`));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const e = await sign.POST(req('/', { password: PASSWORD }), params({ id: '9' }));
    spy.mockRestore();
    expect(e.status).toBe(500);
    expect(JSON.stringify(await e.json())).not.toContain(PASSWORD);
  });

  it('[SGC-REQ-033][SGC-REQ-038] autorizar firmando decide el cupo exacto de la autorización', async () => {
    asUser([gestion]);
    m.taskOfAuthorization.mockResolvedValue({ idTask: 12, idAssignee: 77, idCompany: OLP });
    m.signTask.mockResolvedValue({ outcome: 'abierta' });
    expect((await authSign.POST(req('/', { meaning: 'aprobo', password: 'x' }), params({ id: '4' }))).status).toBe(200);
    expect(m.signTask.mock.calls[0][2]).toBe(12);
    expect(m.signTask.mock.calls[0][3]).toMatchObject({ idAssignee: 77, meaning: 'aprobo' });
    m.taskOfAuthorization.mockResolvedValue({ idTask: 12, idAssignee: 77, idCompany: 50 });
    expect((await authSign.POST(req('/', {}), params({ id: '4' }))).status).toBe(404);
    expect((await authSign.POST(req('/', {}), params({ id: '0' }))).status).toBe(400);
  });
});

describe('Rutas S3 · maestro de firmas (solo Calidad)', () => {
  it('[SGC-REQ-050] consultar, registrar y revocar el maestro de firmas es de Aseguramiento de Calidad', async () => {
    asUser([gestion]);
    expect((await masters.GET(get('/api/sgc/signature/masters?company=3'))).status).toBe(403);
    expect((await masters.GET(get('/api/sgc/signature/masters'))).status).toBe(400);
    expect((await masters.POST(req('/', { company: OLP }))).status).toBe(403);
    expect((await masterRevoke.POST(req('/', { company: OLP, reason: 'x' }), params({ id: '1' }))).status).toBe(403);
    asUser([calidad]);
    m.listSignatureMasters.mockResolvedValue([{ id: 1 }]);
    m.registerSignatureMaster.mockResolvedValue({ id: 2 });
    m.revokeSignatureMaster.mockResolvedValue({ ok: true });
    expect(await (await masters.GET(get('/api/sgc/signature/masters?company=3'))).json()).toEqual({ masters: [{ id: 1 }] });
    expect((await masters.POST(req('/', { company: OLP, email: 'a@b.co', imagePng: 'data:image/png;base64,AA', reason: 'Inducción' }))).status).toBe(201);
    expect(m.registerSignatureMaster.mock.calls[0][2]).toEqual({ email: 'a@b.co', imagePng: 'data:image/png;base64,AA', reason: 'Inducción' });
    expect((await masterRevoke.POST(req('/', { company: OLP, reason: 'Retiro' }), params({ id: '2' }))).status).toBe(200);
    expect((await masters.POST(new Request('http://x', { method: 'POST', body: '[' })))).toHaveProperty('status', 400);
    expect((await masterRevoke.POST(req('/', { company: OLP }), params({ id: 'x' }))).status).toBe(400);
  });
});

describe('Rutas S3 · borrador editado en la app', () => {
  it('[SGC-REQ-047][SGC-REQ-048] listar, guardar revisiones, leer una, partir de la vigente e importar un Word', async () => {
    asUser([gestion]);
    m.listDraftRevisions.mockResolvedValue({ revisions: [] });
    m.saveDraftRevision.mockResolvedValueOnce({ id: 1, number: 1, unchanged: false }).mockResolvedValueOnce({ id: null, number: 1, unchanged: true });
    m.getDraftRevision.mockResolvedValue({ id: 1, html: '<p>x</p>' });
    m.getVigenteBaseHtml.mockResolvedValue({ html: '<p>v</p>' });
    m.importWordToHtml.mockResolvedValue({ html: '<p>w</p>' });
    const p = params({ id: '5' });
    expect((await draft.GET(get('/'), p)).status).toBe(200);
    expect((await draft.POST(req('/', { html: '<p>hola</p>', note: 'n' }), p)).status).toBe(201);
    expect((await draft.POST(req('/', { html: '<p>hola</p>' }), p)).status).toBe(200);
    expect(m.saveDraftRevision.mock.calls[0][2]).toEqual({ html: '<p>hola</p>', note: 'n', origin: undefined, originRef: undefined });
    expect((await draftRev.GET(get('/'), params({ id: '5', revision: 'ultima' }))).status).toBe(200);
    expect(m.getDraftRevision.mock.calls[0][2]).toBe('ultima');
    expect((await draftRev.GET(get('/'), params({ id: '5', revision: '3' }))).status).toBe(200);
    expect(m.getDraftRevision.mock.calls[1][2]).toBe(3);
    expect((await draftRev.GET(get('/'), params({ id: '5', revision: 'x' }))).status).toBe(400);
    expect((await draftBase.GET(get('/'), p)).status).toBe(200);
    const form = new FormData();
    form.append('file', new File([new Uint8Array([80, 75, 3, 4])], 'P.docx'));
    expect((await draftWord.POST(new Request('http://x', { method: 'POST', body: form }), p)).status).toBe(200);
    expect(m.importWordToHtml.mock.calls[0][3]).toMatchObject({ fileName: 'P.docx' });
    expect((await draftWord.POST(new Request('http://x', { method: 'POST', body: new FormData() }), p)).status).toBe(400);
    for (const bad of [draft.GET(get('/'), params({ id: 'x' })), draft.POST(req('/', {}), params({ id: 'x' })), draftBase.GET(get('/'), params({ id: '0' }))]) expect((await bad).status).toBe(400);
    m.saveDraftRevision.mockRejectedValue(new SgcError('Solo el elaborador edita el borrador del documento.', 403));
    expect((await draft.POST(req('/', { html: 'x' }), p)).status).toBe(403);
  });
});

describe('Rutas S3 · PDF controlado, verificación y reporte de auditoría', () => {
  it('[SGC-REQ-045] reintentar el PDF controlado es de Calidad y solo con la solicitud aprobada', async () => {
    m.companyOfRequest.mockResolvedValue(OLP);
    asUser([gestion]);
    expect((await pdf.POST(req('/', {}), params({ id: '5' }))).status).toBe(403);
    asUser([calidad]);
    m.findUniqueOrThrow.mockResolvedValueOnce({ status: 'abierta' });
    expect((await pdf.POST(req('/', {}), params({ id: '5' }))).status).toBe(409);
    m.findUniqueOrThrow.mockResolvedValueOnce({ status: 'en_espera' });
    m.generateControlledVersion.mockResolvedValue({ idDocumentVersion: 8, created: true });
    expect(await (await pdf.POST(req('/', {}), params({ id: '5' }))).json()).toEqual({ idDocumentVersion: 8, created: true });
    expect((await pdf.POST(req('/', {}), params({ id: 'x' }))).status).toBe(400);
  });

  it('[SGC-REQ-046] verificar una versión devuelve el resultado; ids inválidos, 400', async () => {
    asUser([lectura]);
    m.verifyDocumentVersion.mockResolvedValue({ ok: false, problems: ['alterado'] });
    const r = await verify.GET(get('/'), params({ id: '1', versionId: '2' }));
    expect(await r.json()).toEqual({ ok: false, problems: ['alterado'] });
    expect(m.verifyDocumentVersion.mock.calls[0].slice(4, 6)).toEqual([1, 2]);
    expect((await verify.GET(get('/'), params({ id: '1', versionId: 'x' }))).status).toBe(400);
  });

  it('[SGC-REQ-051] el reporte de auditoría sale en JSON o CSV; errores de negocio con su estado', async () => {
    asUser([calidad]);
    m.getDocumentAuditReport.mockResolvedValue({ document: { code: 'OLP-GC-PR-001' }, events: [] });
    m.auditReportToCsv.mockReturnValue('﻿"fecha_utc"\r\n');
    expect(await (await audit.GET(get('/'), params({ id: '1' }))).json()).toMatchObject({ document: { code: 'OLP-GC-PR-001' } });
    const csv = await audit.GET(get('/api/sgc/documents/1/audit?formato=csv'), params({ id: '1' }));
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('auditoria-OLP-GC-PR-001.csv');
    m.getDocumentAuditReport.mockRejectedValue(new SgcError('El reporte de auditoría es de Aseguramiento de Calidad.', 403));
    expect((await audit.GET(get('/'), params({ id: '1' }))).status).toBe(403);
    expect((await audit.GET(get('/'), params({ id: 'x' }))).status).toBe(400);
  });
});
