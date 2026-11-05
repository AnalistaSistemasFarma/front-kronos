import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #805 + Workflow SAP: al editar un campo condicionante, una Tarea SAP condicionada que
 * queda habilitada debe crearse (sin responsable) y ejecutarse, igual que una tarea normal.
 */

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  tasks: [] as Row[],
  conds: [] as Row[],
  selected: [] as Row[],
  existing: new Set<number>(),
  inserts: [] as { id_task: number; id_user: unknown }[],
  notified: [] as unknown[],
  sapRuns: [] as unknown[],
}));

vi.mock('mssql', () => {
  class Request {
    params: Record<string, unknown> = {};
    input(name: string, _t: unknown, v: unknown) {
      this.params[name] = v;
      return this;
    }
    async query(q: string) {
      if (/FROM requests_general rg/.test(q)) return { recordset: [{ id_process_category: 5, subject_request: 'QA' }] };
      if (/FROM task_condition_option/.test(q)) return { recordset: h.conds };
      if (/FROM request_form_value/.test(q)) return { recordset: h.selected };
      if (/FROM task_process_category tpc\s+LEFT JOIN user_task_request_general/.test(q)) return { recordset: h.tasks };
      if (/SELECT COUNT\(\*\) AS cnt/.test(q)) return { recordset: [{ cnt: h.existing.has(Number(this.params.id_task)) ? 1 : 0 }] };
      if (/INSERT INTO task_request_general/.test(q)) {
        h.inserts.push({ id_task: Number(this.params.id_task), id_user: this.params.id_user ?? null });
        return { recordset: [{ id: 9000 + h.inserts.length }] };
      }
      throw new Error('consulta inesperada: ' + q.slice(0, 80));
    }
  }
  const sql = { Request, Int: 'Int', NVarChar: 'NVarChar' };
  return { default: sql };
});
vi.mock('../../notificationEvents.js', () => ({
  notifyActivityAssigned: vi.fn(async (x: unknown) => {
    h.notified.push(x);
  }),
  fireAndForgetNotification: (p: Promise<unknown>) => {
    Promise.resolve(p).catch(() => undefined);
  },
}));
vi.mock('../../orion/internalTasks', () => ({ orionSignatureTemplateSql: () => '(1 = 0)' }));
vi.mock('../../workflow-sap/engine', () => ({
  runSapExecutors: vi.fn(async (id: unknown) => {
    h.sapRuns.push(id);
    return { executed: 1, errors: 0 };
  }),
}));

import { fireConditionalTasksForRequest } from '../fireConditionalTasks.js';

const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  h.tasks = [];
  h.conds = [];
  h.selected = [];
  h.existing = new Set();
  h.inserts = [];
  h.notified = [];
  h.sapRuns = [];
});

describe('tareas condicionadas al editar un campo (#805) con Workflow SAP', () => {
  it('crea la Tarea SAP condicionada sin responsable y corre el motor de Tareas SAP', async () => {
    h.tasks = [
      { id_task: 10, task: 'Revisión', is_sequential: false, display_order: 1, is_authorization: 0, task_kind: 'normal', id_user: 'u1', email: 'a@x' },
      { id_task: 11, task: '⚡ Pasar a AE', is_sequential: false, display_order: 2, is_authorization: 0, task_kind: 'sap_executor', id_user: null, email: null },
    ];
    h.conds = [{ id_task: 11, id_option: 77 }];
    h.selected = [{ id_option: 77 }];
    h.existing = new Set([10]); // la tarea normal ya existía desde la creación

    const created = await fireConditionalTasksForRequest({}, { requestId: 123 });
    await flush();

    expect(h.inserts).toEqual([{ id_task: 11, id_user: null }]);
    expect(created).toEqual([{ id_task: 11, newTaskId: 9001, userId: null, sapExecutor: true }]);
    expect(h.sapRuns).toEqual([123]);
    expect(h.notified).toEqual([]); // a una Tarea SAP no se le notifica a nadie
  });

  it('si la opción que la habilita no está elegida, no la crea ni corre el motor', async () => {
    h.tasks = [{ id_task: 11, task: '⚡ SAP', is_sequential: false, display_order: 2, is_authorization: 0, task_kind: 'sap_executor', id_user: null, email: null }];
    h.conds = [{ id_task: 11, id_option: 77 }];
    h.selected = [{ id_option: 78 }];
    await fireConditionalTasksForRequest({}, { requestId: 123 });
    await flush();
    expect(h.inserts).toEqual([]);
    expect(h.sapRuns).toEqual([]);
  });

  it('una tarea normal condicionada se sigue creando y notificando como antes, sin correr el motor', async () => {
    h.tasks = [{ id_task: 12, task: 'Ajuste', is_sequential: false, display_order: 1, is_authorization: 0, task_kind: 'normal', id_user: 'u2', email: 'b@x' }];
    h.conds = [{ id_task: 12, id_option: 5 }];
    h.selected = [{ id_option: 5 }];
    const created = await fireConditionalTasksForRequest({}, { requestId: 7 });
    await flush();
    expect(h.inserts).toEqual([{ id_task: 12, id_user: 'u2' }]);
    expect(created[0]).toMatchObject({ id_task: 12, userId: 'u2', sapExecutor: false });
    expect(h.notified).toHaveLength(1);
    expect(h.sapRuns).toEqual([]);
  });

  it('una tarea normal sin responsable se sigue omitiendo; la autorización sin responsable se crea con NULL', async () => {
    h.tasks = [
      { id_task: 13, task: 'Sin responsable', is_sequential: false, display_order: 1, is_authorization: 0, task_kind: 'normal', id_user: null, email: null },
      { id_task: 14, task: 'Autorización', is_sequential: false, display_order: 2, is_authorization: 1, task_kind: 'authorization', id_user: null, email: null },
    ];
    await fireConditionalTasksForRequest({}, { requestId: 8 });
    await flush();
    expect(h.inserts).toEqual([{ id_task: 14, id_user: null }]);
    expect(h.sapRuns).toEqual([]);
  });

  it('la Tarea SAP secuencial que no es la primera la deja para el avance del flujo', async () => {
    h.tasks = [
      { id_task: 20, task: 'Primera', is_sequential: true, display_order: 1, is_authorization: 0, task_kind: 'normal', id_user: 'u1', email: 'a@x' },
      { id_task: 21, task: '⚡ SAP', is_sequential: true, display_order: 2, is_authorization: 0, task_kind: 'sap_executor', id_user: null, email: null },
    ];
    h.existing = new Set([20]);
    await fireConditionalTasksForRequest({}, { requestId: 9 });
    await flush();
    expect(h.inserts).toEqual([]);
    expect(h.sapRuns).toEqual([]);
  });

  it('no duplica una Tarea SAP que ya existe', async () => {
    h.tasks = [{ id_task: 11, task: '⚡ SAP', is_sequential: false, display_order: 2, is_authorization: 0, task_kind: 'sap_executor', id_user: null, email: null }];
    h.existing = new Set([11]);
    await fireConditionalTasksForRequest({}, { requestId: 123 });
    await flush();
    expect(h.inserts).toEqual([]);
    expect(h.sapRuns).toEqual([]);
  });
});
