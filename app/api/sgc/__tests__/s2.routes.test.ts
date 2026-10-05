import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 2 (/api/sgc/**: flujos validados, matriz, Autorizaciones
// SGC, solicitudes y Tareas documentales) con la sesión y la base simuladas.
// Las reglas se prueban en lib/sgc/__tests__ y, contra un SQL Server real, en
// tests/integration/sgc/flujos.integration.test.ts.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getSgcAccessForUser', 'getAccessSubject',
    'listFlowProcesses', 'createFlowProcess', 'updateFlowProcess', 'createDraftVersion', 'getFlowVersion', 'saveDraftDefinition', 'publishFlowVersion', 'discardDraftVersion', 'listConfigChanges',
    'listMatrix', 'addMatrixEntry', 'deactivateMatrixEntry', 'suggestForTarget',
    'listAuthorizationTypes', 'saveAuthorizationType', 'grantAuthorizationTypeUser', 'revokeAuthorizationTypeUser', 'listAuthorizationInbox',
    'createRequest', 'listMyRequests', 'getRequestDetail', 'addNote', 'uploadAttachment', 'getAttachmentForDownload', 'withdrawAttachment', 'setSigners', 'cancelRequest', 'saveFormValues',
    'listTaskInbox', 'getTaskDetail', 'decideTask', 'reassignTask', 'listEligibleUsers', 'companyOfRequest', 'requestOfTask', 'taskOfAuthorization', 'getRequestForm',
    'downloadVerifiedFile', 'uploadToSgcStorage', 'downloadSgcFile', 'buildLayoutPreview', 'currentDraftInTx',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: vi.fn() }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadVerifiedFile: m.downloadVerifiedFile, uploadToSgcStorage: m.uploadToSgcStorage, downloadSgcFile: m.downloadSgcFile }));
vi.mock('../../../../lib/sgc/db/layout', () => ({ buildLayoutPreview: m.buildLayoutPreview }));
vi.mock('../../../../lib/sgc/db/signatureRecord', () => ({ currentDraftInTx: m.currentDraftInTx }));
vi.mock('../../../../lib/sgc/db/flows', () => ({
  listFlowProcesses: m.listFlowProcesses, createFlowProcess: m.createFlowProcess, updateFlowProcess: m.updateFlowProcess, createDraftVersion: m.createDraftVersion,
  getFlowVersion: m.getFlowVersion, saveDraftDefinition: m.saveDraftDefinition, publishFlowVersion: m.publishFlowVersion, discardDraftVersion: m.discardDraftVersion, listConfigChanges: m.listConfigChanges,
}));
vi.mock('../../../../lib/sgc/db/matrix', () => ({ listMatrix: m.listMatrix, addMatrixEntry: m.addMatrixEntry, deactivateMatrixEntry: m.deactivateMatrixEntry, suggestForTarget: m.suggestForTarget }));
vi.mock('../../../../lib/sgc/db/authorizations', () => ({
  listAuthorizationTypes: m.listAuthorizationTypes, saveAuthorizationType: m.saveAuthorizationType, grantAuthorizationTypeUser: m.grantAuthorizationTypeUser,
  revokeAuthorizationTypeUser: m.revokeAuthorizationTypeUser, listAuthorizationInbox: m.listAuthorizationInbox,
}));
vi.mock('../../../../lib/sgc/db/requests', () => ({
  createRequest: m.createRequest, listMyRequests: m.listMyRequests, getRequestDetail: m.getRequestDetail, addNote: m.addNote, uploadAttachment: m.uploadAttachment,
  getAttachmentForDownload: m.getAttachmentForDownload, withdrawAttachment: m.withdrawAttachment, setSigners: m.setSigners, cancelRequest: m.cancelRequest, saveFormValues: m.saveFormValues,
  listTaskInbox: m.listTaskInbox, getTaskDetail: m.getTaskDetail, decideTask: m.decideTask, reassignTask: m.reassignTask, listEligibleUsers: m.listEligibleUsers,
  companyOfRequest: m.companyOfRequest, requestOfTask: m.requestOfTask, taskOfAuthorization: m.taskOfAuthorization, getRequestForm: m.getRequestForm,
}));

import { SgcError } from '../../../../lib/sgc/errors';
import * as flows from '../flows/route';
import * as flowId from '../flows/[id]/route';
import * as flowVersions from '../flows/[id]/versions/route';
import * as version from '../flows/versions/[versionId]/route';
import * as publish from '../flows/versions/[versionId]/publish/route';
import * as discard from '../flows/versions/[versionId]/discard/route';
import * as changes from '../flows/changes/route';
import * as matrix from '../matrix/route';
import * as matrixOff from '../matrix/[id]/deactivate/route';
import * as authTypes from '../authorization-types/route';
import * as authTypeUsers from '../authorization-types/[id]/users/route';
import * as authTypeRevoke from '../authorization-types/users/[id]/revoke/route';
import * as auths from '../authorizations/route';
import * as authDecision from '../authorizations/[id]/decision/route';
import * as requests from '../requests/route';
import * as requestForm from '../requests/form/route';
import * as requestId from '../requests/[id]/route';
import * as notes from '../requests/[id]/notes/route';
import * as attachments from '../requests/[id]/attachments/route';
import * as attachmentId from '../requests/[id]/attachments/[attachmentId]/route';
import * as withdraw from '../requests/[id]/attachments/[attachmentId]/withdraw/route';
import * as signers from '../requests/[id]/signers/route';
import * as cancel from '../requests/[id]/cancel/route';
import * as formValues from '../requests/[id]/form-values/route';
import * as tasks from '../tasks/route';
import * as taskId from '../tasks/[id]/route';
import * as decision from '../tasks/[id]/decision/route';
import * as reassign from '../tasks/[id]/reassign/route';
import * as users from '../users/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const gestion = { ...lectura, canManage: true };
const flujos = { ...lectura, canAdminFlows: true };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'qa.sgc@gsslatam.com';

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [3] });
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const req = (url: string, body?: unknown, method = 'POST') =>
  new Request(`http://x${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7:4444' } });
const get = (url: string) => new Request(`http://x${url}`);
const status = (r: Response) => r.status;

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas S2 · sesión obligatoria', () => {
  it('[SGC-REQ-007] sin sesión todas las rutas del S2 responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const p1 = params({ id: '1' });
    const pv = params({ versionId: '1' });
    const pa = params({ id: '1', attachmentId: '2' });
    const all = await Promise.all([
      flows.GET(get('/api/sgc/flows?company=3')), flows.POST(req('/api/sgc/flows', {})), flowId.PATCH(req('/', {}, 'PATCH'), p1), flowVersions.POST(req('/', {}), p1),
      version.GET(get('/?company=3'), pv), version.PUT(req('/', {}, 'PUT'), pv), publish.POST(req('/', {}), pv), discard.POST(req('/', {}), pv), changes.GET(get('/?company=3')),
      matrix.GET(get('/?company=3')), matrix.POST(req('/', {})), matrixOff.POST(req('/', {}), p1),
      authTypes.GET(get('/?company=3')), authTypes.POST(req('/', {})), authTypeUsers.POST(req('/', {}), p1), authTypeRevoke.POST(req('/', {}), p1), auths.GET(get('/')), authDecision.POST(req('/', {}), p1),
      requests.GET(get('/')), requests.POST(req('/', {})), requestForm.GET(get('/?company=3')), requestId.GET(get('/'), p1), notes.POST(req('/', {}), p1), attachments.POST(req('/', {}), p1),
      attachmentId.GET(get('/'), pa), withdraw.POST(req('/', {}), pa), signers.POST(req('/', {}), p1), cancel.POST(req('/', {}), p1), formValues.PUT(req('/', {}, 'PUT'), p1),
      tasks.GET(get('/')), taskId.GET(get('/'), p1), decision.POST(req('/', {}), p1), reassign.POST(req('/', {}), p1), users.GET(get('/?company=3')),
    ]);
    expect(all.map(status)).toEqual(all.map(() => 401));
  });
});

describe('Rutas S2 · administración de flujos validados', () => {
  it('[SGC-REQ-037] ver flujos exige administración de flujos o Calidad; crear y editar, solo administración de flujos', async () => {
    asUser([gestion]);
    expect(status(await flows.GET(get('/api/sgc/flows?company=3')))).toBe(403);
    expect(status(await flows.GET(get('/api/sgc/flows')))).toBe(400);
    expect(status(await changes.GET(get('/api/sgc/flows/changes?company=3')))).toBe(403);
    expect(status(await changes.GET(get('/api/sgc/flows/changes')))).toBe(400);
    expect(status(await version.GET(get('/?company=3'), params({ versionId: '4' })))).toBe(403);
    asUser([calidad]);
    m.listFlowProcesses.mockResolvedValue([{ id: 1 }]);
    const list = await flows.GET(get('/api/sgc/flows?company=3'));
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toContain('no-store');
    expect(await list.json()).toEqual({ flows: [{ id: 1 }] });
    for (const call of [
      flows.POST(req('/api/sgc/flows', { company: OLP })),
      flowId.PATCH(req('/', { company: OLP }, 'PATCH'), params({ id: '1' })),
      flowVersions.POST(req('/', { company: OLP }), params({ id: '1' })),
      version.PUT(req('/', { company: OLP }, 'PUT'), params({ versionId: '1' })),
      publish.POST(req('/', { company: OLP }), params({ versionId: '1' })),
      discard.POST(req('/', { company: OLP }), params({ versionId: '1' })),
    ]) {
      expect(status(await call)).toBe(403);
    }
    expect(m.createFlowProcess).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-024][SGC-REQ-025][SGC-REQ-026] la administración de flujos crea, edita, versiona, publica y consulta el registro de cambios', async () => {
    asUser([flujos]);
    m.createFlowProcess.mockResolvedValue({ idFlowProcess: 2, idFlowVersion: 5 });
    m.updateFlowProcess.mockResolvedValue({ name: 'X' });
    m.createDraftVersion.mockResolvedValue({ idFlowVersion: 6, versionNumber: 2 });
    m.getFlowVersion.mockResolvedValue({ version: { id: 6 } });
    m.saveDraftDefinition.mockResolvedValue({ changes: ['x'] });
    m.publishFlowVersion.mockResolvedValue({ published: 2 });
    m.discardDraftVersion.mockResolvedValue({ discarded: 2 });
    m.listConfigChanges.mockResolvedValue([{ id: '1' }]);
    expect(status(await flows.POST(req('/api/sgc/flows', { company: OLP, code: 'CC', reason: 'nuevo flujo' })))).toBe(201);
    expect(m.createFlowProcess.mock.calls[0][3]).toEqual({ email: EMAIL, ip: '10.0.0.7', userAgent: null });
    expect(status(await flowId.PATCH(req('/', { company: OLP, name: 'X', reason: 'ajuste' }, 'PATCH'), params({ id: '2' })))).toBe(200);
    expect(status(await flowVersions.POST(req('/', { company: OLP, reason: 'nueva versión' }), params({ id: '2' })))).toBe(201);
    expect(status(await version.GET(get('/?company=3'), params({ versionId: '6' })))).toBe(200);
    expect(status(await version.PUT(req('/', { company: OLP, definition: {}, reason: 'editar' }, 'PUT'), params({ versionId: '6' })))).toBe(200);
    expect(status(await publish.POST(req('/', { company: OLP, reason: 'publicar' }), params({ versionId: '6' })))).toBe(200);
    expect(status(await discard.POST(req('/', { company: OLP, reason: 'descartar' }), params({ versionId: '6' })))).toBe(200);
    const ch = await changes.GET(get('/api/sgc/flows/changes?company=3&process=2&entity=flow_version'));
    expect(await ch.json()).toEqual({ changes: [{ id: '1' }] });
    expect(m.listConfigChanges).toHaveBeenCalledWith({}, OLP, { idFlowProcess: 2, entity: 'flow_version' });
  });

  it('[SGC-REQ-007] peticiones mal formadas y errores de negocio se responden sin filtrar detalles', async () => {
    asUser([flujos]);
    expect(status(await flows.POST(new Request('http://x', { method: 'POST', body: 'no-json' })))).toBe(400);
    expect(status(await flowId.PATCH(req('/', { company: OLP }, 'PATCH'), params({ id: 'abc' })))).toBe(400);
    expect(status(await flowVersions.POST(req('/', ['x']), params({ id: '1' })))).toBe(400);
    expect(status(await version.GET(get('/'), params({ versionId: '1' })))).toBe(400);
    expect(status(await version.PUT(req('/', {}, 'PUT'), params({ versionId: '0' })))).toBe(400);
    expect(status(await publish.POST(req('/', {}), params({ versionId: 'x' })))).toBe(400);
    m.saveDraftDefinition.mockRejectedValue(new SgcError('Solo se edita una versión en borrador', 409));
    const r = await version.PUT(req('/', { company: OLP, definition: {} }, 'PUT'), params({ versionId: '1' }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Solo se edita una versión en borrador' });
    m.publishFlowVersion.mockRejectedValue(new Error('detalle interno SQL'));
    const e = await publish.POST(req('/', { company: OLP }), params({ versionId: '1' }));
    expect(e.status).toBe(500);
    expect(JSON.stringify(await e.json())).not.toContain('SQL');
  });
});

describe('Rutas S2 · matriz y Autorizaciones SGC', () => {
  it('[SGC-REQ-034] la matriz se consulta con acceso de lectura (sugerencia incluida) y se edita solo con flujos o Calidad', async () => {
    asUser([lectura]);
    m.listMatrix.mockResolvedValue([{ id: 1 }]);
    m.suggestForTarget.mockResolvedValue([{ role: 'revisor' }]);
    expect(await (await matrix.GET(get('/api/sgc/matrix?company=3'))).json()).toEqual({ matrix: [{ id: 1 }] });
    expect(await (await matrix.GET(get('/api/sgc/matrix?company=3&process=10&documentType=20'))).json()).toEqual({ suggestion: [{ role: 'revisor' }] });
    expect(m.suggestForTarget).toHaveBeenCalledWith({}, OLP, { idProcess: 10, idDocumentType: 20 });
    expect(status(await matrix.GET(get('/api/sgc/matrix?company=1')))).toBe(403);
    expect(status(await matrix.GET(get('/api/sgc/matrix')))).toBe(400);
    expect(status(await matrix.POST(req('/', { company: OLP })))).toBe(403);
    expect(status(await matrixOff.POST(req('/', { company: OLP }), params({ id: '1' })))).toBe(403);
    asUser([calidad]);
    m.addMatrixEntry.mockResolvedValue({ id: 9 });
    m.deactivateMatrixEntry.mockResolvedValue({ id: 9 });
    expect(status(await matrix.POST(req('/', { company: OLP, role: 'revisor', reason: 'alta' })))).toBe(201);
    expect(status(await matrix.POST(req('/', null)))).toBe(400);
    expect(status(await matrixOff.POST(req('/', { company: OLP, reason: 'baja' }), params({ id: '9' })))).toBe(200);
    expect(status(await matrixOff.POST(req('/', { company: OLP }), params({ id: 'x' })))).toBe(400);
  });

  it('[SGC-REQ-033] los tipos y grupos de Autorizaciones SGC los configura flujos o Calidad; la bandeja la ve cualquiera con acceso', async () => {
    asUser([gestion]);
    expect(status(await authTypes.GET(get('/?company=3')))).toBe(403);
    expect(status(await authTypes.GET(get('/')))).toBe(400);
    expect(status(await authTypes.POST(req('/', { company: OLP })))).toBe(403);
    expect(status(await authTypeUsers.POST(req('/', { company: OLP }), params({ id: '1' })))).toBe(403);
    expect(status(await authTypeRevoke.POST(req('/', { company: OLP }), params({ id: '1' })))).toBe(403);
    m.listAuthorizationInbox.mockResolvedValue([{ id: 1 }]);
    const inbox = await auths.GET(get('/api/sgc/authorizations?company=3&status=pendiente'));
    expect(await inbox.json()).toEqual({ authorizations: [{ id: 1 }] });
    expect(m.listAuthorizationInbox).toHaveBeenCalledWith({}, EMAIL, [gestion], { status: 'pendiente', idCompany: OLP });
    asUser([flujos]);
    m.listAuthorizationTypes.mockResolvedValue([]);
    m.saveAuthorizationType.mockResolvedValue({ id: 1 });
    m.grantAuthorizationTypeUser.mockResolvedValue({ id: 2 });
    m.revokeAuthorizationTypeUser.mockResolvedValue({ id: 2 });
    expect(status(await authTypes.GET(get('/?company=3')))).toBe(200);
    expect(status(await authTypes.POST(req('/', { company: OLP, code: 'X1', name: 'X', reason: 'nuevo' })))).toBe(201);
    expect(status(await authTypes.POST(req('/', { company: OLP, id: 1, name: 'X', reason: 'editar' })))).toBe(200);
    expect(status(await authTypes.POST(req('/', 'x')))).toBe(400);
    expect(status(await authTypeUsers.POST(req('/', { company: OLP, email: 'a@x.co', reason: 'alta' }), params({ id: '1' })))).toBe(201);
    expect(status(await authTypeUsers.POST(req('/', { company: OLP }), params({ id: 'no' })))).toBe(400);
    expect(status(await authTypeRevoke.POST(req('/', { company: OLP, reason: 'baja' }), params({ id: '2' })))).toBe(200);
    expect(status(await authTypeRevoke.POST(req('/', null), params({ id: '2' })))).toBe(400);
  });

  it('[SGC-REQ-033] autorizar/rechazar decide el cupo exacto con el mismo motor de la tarea (autorizar = aprobar, rechazar = devolver)', async () => {
    asUser([gestion]);
    m.taskOfAuthorization.mockResolvedValue({ idTask: 40, idAssignee: 77, idCompany: OLP });
    m.decideTask.mockResolvedValue({ outcome: 'abierta' });
    expect(status(await authDecision.POST(req('/', { decision: 'autorizar', comment: 'ok' }), params({ id: '5' })))).toBe(200);
    expect(m.decideTask.mock.calls[0][2]).toBe(40);
    expect(m.decideTask.mock.calls[0][3]).toEqual({ decision: 'aprobar', comment: 'ok', idAssignee: 77 });
    await authDecision.POST(req('/', { decision: 'rechazar', comment: 'corregir anexo' }), params({ id: '5' }));
    expect(m.decideTask.mock.calls[1][3]).toMatchObject({ decision: 'devolver' });
    expect(status(await authDecision.POST(req('/', { decision: 'otra' }), params({ id: '5' })))).toBe(400);
    expect(status(await authDecision.POST(req('/', {}), params({ id: 'x' })))).toBe(400);
    m.taskOfAuthorization.mockResolvedValue({ idTask: 40, idAssignee: 77, idCompany: 1 });
    expect(status(await authDecision.POST(req('/', { decision: 'autorizar' }), params({ id: '5' })))).toBe(404);
  });
});

describe('Rutas S2 · solicitudes y Tareas documentales', () => {
  it('[SGC-REQ-028] crear una solicitud exige acceso a la empresa; la ruta pasa solo los campos esperados', async () => {
    asUser([gestion]);
    m.createRequest.mockResolvedValue({ idRequest: 11 });
    const r = await requests.POST(req('/', { company: OLP, requestType: 'nuevo', subject: 'S', description: 'D', idProcess: 1, idDocumentType: 2, formValues: { urgencia: 'Alta' }, requesterEmail: 'otro@x.co' }));
    expect(r.status).toBe(201);
    const input = m.createRequest.mock.calls[0][3];
    expect(input).toMatchObject({ idCompany: OLP, requestType: 'nuevo', formValues: { urgencia: 'Alta' } });
    expect(input).not.toHaveProperty('requesterEmail');
    await requests.POST(req('/', { company: OLP, formValues: 'x' }));
    expect(m.createRequest.mock.calls[1][3].formValues).toEqual({});
    expect(status(await requests.POST(req('/', { company: 1 })))).toBe(403);
    expect(status(await requests.POST(req('/', null)))).toBe(400);
    m.listMyRequests.mockResolvedValue([]);
    expect(status(await requests.GET(get('/api/sgc/requests?company=3')))).toBe(200);
    m.getRequestForm.mockResolvedValue({ fields: [] });
    expect(status(await requestForm.GET(get('/?company=3')))).toBe(200);
    expect(status(await requestForm.GET(get('/?company=1')))).toBe(403);
    expect(status(await requestForm.GET(get('/')))).toBe(400);
  });

  it('[SGC-REQ-037] la vista de una solicitud o tarea delega el permiso (404 si no se revela); ids inválidos, 404', async () => {
    asUser([lectura]);
    m.getRequestDetail.mockRejectedValue(new SgcError('Solicitud no encontrada.', 404));
    expect(status(await requestId.GET(get('/'), params({ id: '1' })))).toBe(404);
    expect(status(await requestId.GET(get('/'), params({ id: 'x' })))).toBe(404);
    m.getTaskDetail.mockResolvedValue({ request: { id: 1 } });
    expect(status(await taskId.GET(get('/'), params({ id: '3' })))).toBe(200);
    expect(m.getTaskDetail).toHaveBeenCalledWith({}, 3, { email: EMAIL, access: [lectura] });
    expect(status(await taskId.GET(get('/'), params({ id: '-1' })))).toBe(404);
    m.listTaskInbox.mockResolvedValue([{ idTask: 3 }]);
    expect(await (await tasks.GET(get('/api/sgc/tasks?status=abierta&request=9'))).json()).toEqual({ tasks: [{ idTask: 3 }] });
    expect(m.listTaskInbox).toHaveBeenCalledWith({}, EMAIL, [lectura], { status: 'abierta', idCompany: null, idRequest: 9 });
  });

  it('[SGC-REQ-029][SGC-REQ-031] decidir, reasignar, cambiar firmantes y cancelar validan empresa y delegan al motor', async () => {
    asUser([gestion]);
    m.requestOfTask.mockResolvedValue({ idRequest: 1, idCompany: OLP });
    m.companyOfRequest.mockResolvedValue(OLP);
    m.decideTask.mockResolvedValue({ outcome: 'resuelta' });
    m.reassignTask.mockResolvedValue({ idAssignee: 3 });
    m.setSigners.mockResolvedValue({ changed: true });
    m.cancelRequest.mockResolvedValue({ status: 'cancelada' });
    expect(status(await decision.POST(req('/', { decision: 'aprobar', comment: 'ok', idAssignee: 99 }), params({ id: '4' })))).toBe(200);
    expect(m.decideTask.mock.calls[0][3]).toEqual({ decision: 'aprobar', comment: 'ok' });
    expect(status(await reassign.POST(req('/', { toEmail: 'b@x.co', reason: 'vacaciones' }), params({ id: '4' })))).toBe(200);
    expect(m.reassignTask.mock.calls[0][2]).toEqual(gestion);
    expect(status(await signers.POST(req('/', { stepKey: 'revision', signers: ['a@x.co'] }), params({ id: '1' })))).toBe(200);
    expect(status(await cancel.POST(req('/', { reason: 'ya no se necesita' }), params({ id: '1' })))).toBe(200);
    for (const bad of [decision.POST(req('/', null), params({ id: '4' })), reassign.POST(req('/', {}), params({ id: 'x' })), signers.POST(req('/', 1), params({ id: '1' })), cancel.POST(req('/', {}), params({ id: '0' }))]) {
      expect(status(await bad)).toBe(400);
    }
    m.requestOfTask.mockResolvedValue({ idRequest: 1, idCompany: 1 });
    m.companyOfRequest.mockResolvedValue(1);
    expect(status(await decision.POST(req('/', { decision: 'aprobar' }), params({ id: '4' })))).toBe(404);
    expect(status(await reassign.POST(req('/', { toEmail: 'x' }), params({ id: '4' })))).toBe(404);
    expect(status(await signers.POST(req('/', { stepKey: 'x' }), params({ id: '1' })))).toBe(404);
    expect(status(await cancel.POST(req('/', { reason: 'x' }), params({ id: '1' })))).toBe(404);
    m.requestOfTask.mockRejectedValue(new SgcError('Tarea no encontrada.', 404));
    expect(status(await decision.POST(req('/', { decision: 'aprobar' }), params({ id: '4' })))).toBe(404);
  });

  it('[SGC-REQ-032] historial, adjuntos (con descarga verificada y retiro) e información adicional', async () => {
    asUser([gestion]);
    m.addNote.mockResolvedValue({ ok: true });
    m.saveFormValues.mockResolvedValue({ saved: {} });
    m.withdrawAttachment.mockResolvedValue({ ok: true });
    m.uploadAttachment.mockResolvedValue({ id: 5, sha256: 'a' });
    expect(status(await notes.POST(req('/', { body: 'hola' }), params({ id: '1' })))).toBe(201);
    expect(status(await notes.POST(req('/', null), params({ id: '1' })))).toBe(400);
    expect(status(await formValues.PUT(req('/', { values: {} }, 'PUT'), params({ id: '1' })))).toBe(200);
    expect(status(await formValues.PUT(req('/', null, 'PUT'), params({ id: '1' })))).toBe(400);
    expect(status(await withdraw.POST(req('/', { reason: 'versión equivocada' }), params({ id: '1', attachmentId: '5' })))).toBe(200);
    expect(status(await withdraw.POST(req('/', {}), params({ id: '1', attachmentId: 'x' })))).toBe(400);

    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'borrador.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    form.append('purpose', 'borrador');
    expect(status(await attachments.POST(new Request('http://x', { method: 'POST', body: form }), params({ id: '1' })))).toBe(201);
    const input = m.uploadAttachment.mock.calls[0][3];
    expect(input).toMatchObject({ purpose: 'borrador', fileName: 'borrador.docx' });
    expect(Array.from(input.bytes)).toEqual([1, 2, 3]);
    expect(status(await attachments.POST(new Request('http://x', { method: 'POST', body: new FormData() }), params({ id: '1' })))).toBe(400);

    // 2026-10-05 (RN «Ver documento» nunca descarga): se entrega para el visor, nunca como attachment.
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 x');
    m.getAttachmentForDownload.mockResolvedValue({ itemId: 'it', fileName: 'Acta ñ.pdf', contentType: 'application/pdf', sha256: 'abc', purpose: 'soporte' });
    m.downloadVerifiedFile.mockResolvedValue(pdfBytes);
    const dl = await attachmentId.GET(get('/'), params({ id: '1', attachmentId: '5' }));
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''Acta%20%C3%B1.pdf");
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(dl.headers.get('cache-control')).toContain('no-store');
    expect(m.downloadVerifiedFile).toHaveBeenCalledWith('it', 'abc');
    expect(m.currentDraftInTx).not.toHaveBeenCalled();
    // Formato que no se convierte (p. ej. un .doc o una imagen): 415.
    m.getAttachmentForDownload.mockResolvedValue({ itemId: 'it', fileName: 'Viejo.doc', contentType: '', sha256: 'abc', purpose: 'soporte' });
    m.downloadVerifiedFile.mockResolvedValue(new Uint8Array([9]));
    const unsupported = await attachmentId.GET(get('/'), params({ id: '1', attachmentId: '5' }));
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toEqual({ error: 'Este archivo solo es visible en la app' });
    // Abrir la URL directo en una pestaña (visor nativo con «Descargar»): no se entrega.
    expect(status(await attachmentId.GET(new Request('http://x/', { headers: { 'sec-fetch-dest': 'document' } }), params({ id: '1', attachmentId: '5' })))).toBe(415);
    // El borrador VIGENTE sale compuesto con el encabezado del SGC (la vista previa del documento final).
    m.getAttachmentForDownload.mockResolvedValue({ itemId: 'it', fileName: 'Borrador.docx', contentType: '', sha256: 'abc', purpose: 'borrador' });
    m.currentDraftInTx.mockResolvedValue({ kind: 'borrador_adjunto', ref: 'adjunto:5', format: 'docx' });
    m.buildLayoutPreview.mockResolvedValue(pdfBytes);
    m.downloadVerifiedFile.mockClear();
    const draft = await attachmentId.GET(get('/'), params({ id: '1', attachmentId: '5' }));
    expect(draft.status).toBe(200);
    expect(draft.headers.get('content-type')).toBe('application/pdf');
    expect(draft.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''Borrador.pdf");
    expect(m.buildLayoutPreview.mock.calls[0][3]).toMatchObject({ email: expect.any(String) });
    expect(m.buildLayoutPreview.mock.calls[0][4]).toEqual({ runningHeader: true });
    expect(m.downloadVerifiedFile).not.toHaveBeenCalled();
    m.getAttachmentForDownload.mockResolvedValue({ itemId: 'it', fileName: 'Acta ñ.pdf', contentType: 'application/pdf', sha256: 'abc', purpose: 'soporte' });
    expect(status(await attachmentId.GET(get('/'), params({ id: '1', attachmentId: 'x' })))).toBe(404);
    m.downloadVerifiedFile.mockRejectedValue(new SgcError('no coincide', 409));
    expect(status(await attachmentId.GET(get('/'), params({ id: '1', attachmentId: '5' })))).toBe(409);
  });

  it('[SGC-REQ-030] las personas elegibles como firmantes se consultan solo con acceso a la empresa', async () => {
    asUser([lectura]);
    m.listEligibleUsers.mockResolvedValue([{ email: 'a@x.co', name: 'A' }]);
    expect(await (await users.GET(get('/?company=3'))).json()).toEqual({ users: [{ email: 'a@x.co', name: 'A' }] });
    expect(status(await users.GET(get('/?company=1')))).toBe(403);
    expect(status(await users.GET(get('/')))).toBe(400);
  });
});
