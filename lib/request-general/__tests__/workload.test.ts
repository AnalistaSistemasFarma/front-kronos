import { describe, expect, it } from 'vitest';
import {
  buildReassignNote,
  computeWorkload,
  isRequestResponsible,
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
  it('rechaza cerradas, solicitudes ajenas, autorizaciones, asignados fuera del área y mismo destino', () => {
    expect(taskRejection(scope, undefined, 'b')).toBe('NOT_FOUND');
    expect(taskRejection(scope, t(1, 'a', 2), 'b')).toBe('CLOSED');
    expect(taskRejection(scope, t(1, 'a', 4, 99), 'b')).toBe('REQUEST_NOT_OWNED');
    expect(taskRejection(scope, t(1, 'a', 4, 10, 1), 'b')).toBe('AUTHORIZATION_TASK');
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

describe('buildReassignNote', () => {
  it('incluye de quién, a quién, quién y motivo', () => {
    const n = buildReassignNote({ taskName: 'Revisar', taskId: 7, fromName: 'Ana', toName: 'Beto', actorName: 'Caro', reason: ' vacaciones ' });
    expect(n).toContain('#7');
    expect(n).toContain('de Ana a Beto');
    expect(n).toContain('Realizada por Caro');
    expect(n).toContain('Motivo: vacaciones');
  });
});
