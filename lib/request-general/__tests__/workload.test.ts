import { describe, expect, it } from 'vitest';
import {
  SELF_APPROVAL_ERROR,
  authorizationDecisionBlock,
  buildReassignNote,
  isSelfApproval,
  computeWorkload,
  isRequestResponsible,
  isSignatureAuthorization,
  isResponsible,
  isTaskReassignable,
  taskRejection,
  validateReassignRequest,
  type ReassignScope,
  type WorkloadTask,
} from '../workload';

const members = [
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Beto' },
  { id: 'c', name: 'Caro' },
];
const t = (id: number, who: string | null, status = 4, req: number | null = 10, auth = 0): WorkloadTask => ({
  id,
  id_assigned: who,
  id_status: status,
  id_process_category: 1,
  id_request_general: req,
  is_authorization: auth,
});

describe('computeWorkload', () => {
  it('calcula % sobre las abiertas del grupo, ignora cerradas y ajenos', () => {
    const r = computeWorkload(members, [
      t(1, 'a'), t(2, 'a'), t(3, 'a'), t(4, 'b'),
      t(5, 'a', 2), t(6, 'b', 3), t(7, 'b', 6), t(8, 'zz'), t(9, null),
      t(10, 'b', 1, 99),
    ]);
    expect(r.total).toBe(5);
    expect(r.members.map((m) => [m.id, m.openTasks, m.percent])).toEqual([
      ['a', 3, 60], ['b', 2, 40], ['c', 0, 0],
    ]);
  });
  it('sin tareas da 0 % y no divide por cero', () => {
    const r = computeWorkload(members, []);
    expect(r.total).toBe(0);
    expect(r.members.every((m) => m.percent === 0)).toBe(true);
  });
  it('redondea a un decimal', () => {
    const r = computeWorkload(members, [t(1, 'a'), t(2, 'b'), t(3, 'c')]);
    expect(r.members[0].percent).toBe(33.3);
  });
});

const scope: ReassignScope = { actorId: 'a', ownedRequestIds: [10, 11], delegateIds: ['a', 'b', 'c'] };

describe('permisos de reasignación', () => {
  it('no es responsable sin solicitudes propias o sin área', () => {
    expect(isResponsible({ ownedRequestIds: [], delegateIds: ['a'] })).toBe(false);
    expect(isResponsible({ ownedRequestIds: [1], delegateIds: [] })).toBe(false);
    expect(isResponsible(scope)).toBe(true);
  });
  it('rechaza cerradas, solicitudes ajenas, asignados fuera del área y mismo destino', () => {
    expect(taskRejection(scope, undefined, 'b')).toBe('NOT_FOUND');
    expect(taskRejection(scope, t(1, 'a', 2), 'b')).toBe('CLOSED');
    expect(taskRejection(scope, t(1, 'a', 4, 99), 'b')).toBe('REQUEST_NOT_OWNED');
    expect(taskRejection(scope, t(1, 'zz'), 'b')).toBe('ASSIGNEE_OUTSIDE_AREA');
    expect(taskRejection(scope, t(1, 'b'), 'b')).toBe('SAME_ASSIGNEE');
    expect(taskRejection(scope, t(1, 'a'), 'b')).toBeNull();
    expect(isTaskReassignable(scope, t(1, 'c', 1, 11))).toBe(true);
  });
});

describe('isRequestResponsible', () => {
  it('usa requests_general.id_assigned si está diligenciado (no el responsable del proceso)', () => {
    expect(isRequestResponsible('a', { id_assigned: 'a', processResponsibleIds: ['b'] })).toBe(true);
    expect(isRequestResponsible('b', { id_assigned: 'a', processResponsibleIds: ['b'] })).toBe(false);
  });
  it('si id_assigned está vacío usa el responsable del proceso de esa solicitud', () => {
    expect(isRequestResponsible('b', { id_assigned: ' ', processResponsibleIds: ['b'] })).toBe(true);
    expect(isRequestResponsible('c', { id_assigned: null, processResponsibleIds: ['b'] })).toBe(false);
    expect(isRequestResponsible('', { id_assigned: null, processResponsibleIds: [''] })).toBe(false);
  });
});

describe('validateReassignRequest', () => {
  const map = new Map([[1, t(1, 'a')], [2, t(2, 'a', 4, 99)], [3, t(3, 'c')]]);
  it('403 si no es responsable', () => {
    const r = validateReassignRequest({ ...scope, ownedRequestIds: [] }, { taskIds: [1], toUserId: 'b' }, map, ['b']);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it('422 si el destino está inactivo o fuera del área', () => {
    expect(validateReassignRequest(scope, { taskIds: [1], toUserId: 'b' }, map, ['a'])).toMatchObject({ status: 422 });
    expect(validateReassignRequest(scope, { taskIds: [1], toUserId: 'zz' }, map, ['zz'])).toMatchObject({ status: 422 });
  });
  it('400 en entradas inválidas', () => {
    expect(validateReassignRequest(scope, { taskIds: [], toUserId: 'b' }, map, ['b'])).toMatchObject({ status: 400 });
    expect(validateReassignRequest(scope, { taskIds: ['x'], toUserId: 'b' }, map, ['b'])).toMatchObject({ status: 400 });
    expect(validateReassignRequest(scope, { taskIds: [1], toUserId: '' }, map, ['b'])).toMatchObject({ status: 400 });
  });
  it('todo o nada: 409 si alguna tarea no es reasignable', () => {
    const r = validateReassignRequest(scope, { taskIds: [1, 2], toUserId: 'b' }, map, ['b']);
    expect(r).toMatchObject({ ok: false, status: 409, rejected: [{ id: 2, reason: 'REQUEST_NOT_OWNED' }] });
  });
  it('acepta y deduplica', () => {
    expect(validateReassignRequest(scope, { taskIds: [1, 1, 3], toUserId: 'b' }, map, ['b'])).toEqual({ ok: true, taskIds: [1, 3] });
  });
});

describe('autorizaciones (msg 16541)', () => {
  const auth = (over: Partial<WorkloadTask> = {}): WorkloadTask => ({ ...t(20, 'a', 1, 10, 1), id_requester: 'r', ...over });
  it('se reasignan con la misma regla a otro colaborador activo del área', () => {
    expect(taskRejection(scope, auth(), 'b')).toBeNull();
    expect(isTaskReassignable(scope, auth())).toBe(true);
    expect(validateReassignRequest(scope, { taskIds: [20], toUserId: 'b' }, new Map([[20, auth()]]), ['b'])).toEqual({ ok: true, taskIds: [20] });
  });
  it('solo si el actor es responsable de la solicitud', () => {
    expect(taskRejection(scope, auth({ id_request_general: 99 }), 'b')).toBe('REQUEST_NOT_OWNED');
  });
  it('bloquea la autoaprobación: destino = solicitante', () => {
    const s2 = { ...scope, delegateIds: ['a', 'b', 'c', 'r'] };
    expect(taskRejection(s2, auth(), 'r')).toBe('SELF_APPROVAL_REQUESTER');
    expect(validateReassignRequest(s2, { taskIds: [20], toUserId: 'r' }, new Map([[20, auth()]]), ['r'])).toMatchObject({ status: 422, rejected: [{ id: 20, reason: 'SELF_APPROVAL_REQUESTER' }] });
  });
  it('bloquea que el responsable se asigne la aprobación a sí mismo', () => {
    expect(taskRejection(scope, auth({ id_assigned: 'b' }), 'a')).toBe('SELF_APPROVAL_ACTOR');
    // una tarea normal sí puede tomarla el actor
    expect(taskRejection(scope, t(21, 'b'), 'a')).toBeNull();
  });
  it('el solicitante como destino solo se bloquea en autorizaciones', () => {
    expect(taskRejection(scope, { ...t(22, 'a'), id_requester: 'b' }, 'b')).toBeNull();
  });
  it('las de firma/Orion siguen fuera', () => {
    for (const o of [{ resolution: '[orionAuth] x' }, { resolution: '[orionFile:abc]' }, { type_authorization: 'Firma' }, { task: 'Autorizar firma' }, { task: 'Firma digital contrato' }]) {
      expect(isSignatureAuthorization(auth(o))).toBe(true);
      expect(taskRejection(scope, auth(o), 'b')).toBe('SIGNATURE_AUTHORIZATION');
    }
    expect(isSignatureAuthorization({ ...t(23, 'a'), task: 'Autorizar firma' })).toBe(false);
  });
  it('sin aprobador (id_assigned NULL) no se reasigna desde el panel', () => {
    expect(taskRejection(scope, auth({ id_assigned: null }), 'b')).toBe('ASSIGNEE_OUTSIDE_AREA');
  });
});

describe('buildReassignNote', () => {
  it('incluye de quién, a quién, quién y motivo', () => {
    const n = buildReassignNote({ taskName: 'Revisar', taskId: 7, fromName: 'Ana', toName: 'Beto', actorName: 'Caro', reason: ' vacaciones ' });
    expect(n).toContain('#7');
    expect(n).toContain('de Ana a Beto');
    expect(n).toContain('Realizada por Caro');
    expect(n).toContain('Motivo: vacaciones');
  });
});

describe('autorizaciones (SynerLink c47 msg 16541)', () => {
  const auth = (id: number, who: string, extra: Partial<WorkloadTask> = {}): WorkloadTask => ({
    ...t(id, who, 4, 10, 1),
    id_requester: 'c',
    ...extra,
  });
  it('una autorización abierta de una solicitud propia es reasignable con la misma regla', () => {
    expect(taskRejection(scope, auth(1, 'a'), 'b')).toBeNull();
    expect(isTaskReassignable(scope, auth(1, 'a'))).toBe(true);
    expect(isTaskReassignable(scope, { ...auth(1, 'a'), is_authorization: true })).toBe(true);
  });
  it('no se reasignan autorizaciones ya aprobadas (2) o rechazadas (3)', () => {
    expect(taskRejection(scope, auth(1, 'a', { id_status: 2 }), 'b')).toBe('CLOSED');
    expect(taskRejection(scope, auth(1, 'a', { id_status: 3 }), 'b')).toBe('CLOSED');
  });
  it('sigue exigiendo ser responsable de la solicitud y destino del área', () => {
    expect(taskRejection(scope, auth(1, 'a', { id_request_general: 99 }), 'b')).toBe('REQUEST_NOT_OWNED');
    expect(validateReassignRequest(scope, { taskIds: [1], toUserId: 'zz' }, new Map([[1, auth(1, 'a')]]), ['zz'])).toMatchObject({ status: 422 });
  });
  it('autoaprobación: no se reasigna al creador de la solicitud (422 con mensaje claro)', () => {
    expect(isSelfApproval(auth(1, 'a'), 'c')).toBe(true);
    expect(isSelfApproval(auth(1, 'a'), 'b')).toBe(false);
    expect(isSelfApproval({ is_authorization: 0, id_requester: 'c' }, 'c')).toBe(false);
    expect(isSelfApproval({ is_authorization: 1, id_requester: null }, 'c')).toBe(false);
    expect(taskRejection(scope, auth(1, 'a'), 'c')).toBe('SELF_APPROVAL_REQUESTER');
    const map = new Map([[1, auth(1, 'a')], [3, t(3, 'b')]]);
    const r = validateReassignRequest(scope, { taskIds: [1, 3], toUserId: 'c' }, map, ['c']);
    expect(r).toEqual({ ok: false, status: 422, error: SELF_APPROVAL_ERROR, rejected: [{ id: 1, reason: 'SELF_APPROVAL_REQUESTER' }] });
  });
  it('una tarea normal sí puede ir al creador de la solicitud (la regla es solo para autorizaciones)', () => {
    expect(taskRejection(scope, { ...t(1, 'a'), id_requester: 'c' }, 'c')).toBeNull();
  });
  it('las firmas/validaciones de documento Orion no se reasignan aquí', () => {
    expect(taskRejection(scope, auth(1, 'a', { resolution: '[orionAuth] x' }), 'b')).toBe('SIGNATURE_AUTHORIZATION');
    expect(taskRejection(scope, auth(1, 'a', { resolution: '[orionReview] [orionFile:9]' }), 'b')).toBe('SIGNATURE_AUTHORIZATION');
  });
  it('la nota de bitácora deja al nuevo como aprobador y al anterior sin permiso', () => {
    const n = buildReassignNote({ taskName: 'Autorizar compra', taskId: 5, fromName: 'Ana', toName: 'Beto', actorName: 'Ana', isAuthorization: true });
    expect(n).toContain('Reasignación de autorización');
    expect(n).toContain('pasó de Ana a Beto, que queda como aprobador');
    expect(n).toContain('Ana ya no puede aprobarla');
  });
});

describe('aprobador efectivo tras reasignar (authorizationDecisionBlock)', () => {
  it('el nuevo asignado puede aprobar/rechazar', () => {
    expect(authorizationDecisionBlock({ sessionUserId: 'b', currentAssignee: 'b', currentStatus: 4 })).toBeNull();
  });
  it('el asignado anterior ya no puede (403)', () => {
    expect(authorizationDecisionBlock({ sessionUserId: 'a', currentAssignee: 'b', currentStatus: 4 })).toMatchObject({ status: 403 });
  });
  it('sin sesión 401; ya aprobada o rechazada 409', () => {
    expect(authorizationDecisionBlock({ sessionUserId: null, currentAssignee: 'b', currentStatus: 4 })).toMatchObject({ status: 401 });
    expect(authorizationDecisionBlock({ sessionUserId: 'b', currentAssignee: 'b', currentStatus: 2 })).toMatchObject({ status: 409 });
    expect(authorizationDecisionBlock({ sessionUserId: 'b', currentAssignee: 'b', currentStatus: 3 })).toMatchObject({ status: 409 });
  });
  it('autorización del pool (sin asignar) la decide quien tenga sesión', () => {
    expect(authorizationDecisionBlock({ sessionUserId: 'c', currentAssignee: null, currentStatus: 4 })).toBeNull();
  });
});
