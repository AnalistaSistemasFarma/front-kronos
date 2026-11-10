import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Subproceso vinculado: al cerrarse la solicitud hija, la tarea de origen con closes_request cierra la madre. */
const h = vi.hoisted(() => ({ origin: {} as Record<string, unknown>, open: 0, updates: [] as unknown[], advanced: 0, closed: [] as unknown[] }));

vi.mock('mssql', () => {
  class Request {
    params: Record<string, unknown> = {};
    input(n: string, _t: unknown, v: unknown) {
      this.params[n] = v;
      return this;
    }
    async query(q: string) {
      if (/FROM task_request_general trg\s+INNER JOIN task_process_category tpc ON tpc.id = trg.id_task\s+LEFT JOIN requests_general/.test(q)) return { recordset: [h.origin] };
      if (/UPDATE task_request_general/.test(q)) {
        h.updates.push(this.params);
        return { rowsAffected: [1] };
      }
      if (/SELECT COUNT\(\*\) AS n/.test(q)) return { recordset: [{ n: h.open }] };
      throw new Error('consulta inesperada');
    }
  }
  return { default: { Request, Int: 'Int', NVarChar: () => 'NVarChar' } };
});
vi.mock('../advanceSequentialTask.js', () => ({ advanceSequentialTask: vi.fn(async () => { h.advanced++; }) }));
vi.mock('../closeRequestGeneral.js', () => ({ closeRequestGeneral: vi.fn(async (_p: unknown, a: unknown) => { h.closed.push(a); return true; }) }));
vi.mock('../../orion/internalTasks', () => ({ orionInternalTaskSql: () => '(1 = 0)' }));

import { closeLinkedOriginTask } from '../closeLinkedOriginTask.js';
const pool = {} as never;

beforeEach(() => {
  h.origin = { id: 2086, id_task: 807, id_request_general: 10125, id_status: 4, display_order: 1, task: 'Solicitud de Firma', closes_request: true, id_process_category: 210, subject_request: 'QA' };
  h.open = 0;
  h.updates = [];
  h.advanced = 0;
  h.closed = [];
});

describe('cierre de la tarea de origen de un subproceso', () => {
  it('con closes_request y sin tareas abiertas, cierra la solicitud madre', async () => {
    await closeLinkedOriginTask(pool, { originTaskId: 2086, mirroredStatus: 2, closedByUserId: 'u3', linkedRequestId: 10126 });
    expect(h.updates).toHaveLength(1);
    expect(h.advanced).toBe(1);
    expect(h.closed).toEqual([{ requestId: 10125, closedByUserId: 'u3', resolution: 'Cerrada automáticamente al cerrarse la tarea «Solicitud de Firma» (solicitud #10126).' }]);
  });

  it('si quedan tareas abiertas, la madre sigue abierta', async () => {
    h.open = 1;
    await closeLinkedOriginTask(pool, { originTaskId: 2086, mirroredStatus: 2, closedByUserId: 'u3', linkedRequestId: 10126 });
    expect(h.closed).toEqual([]);
  });

  it('sin closes_request no cierra la madre (comportamiento de siempre)', async () => {
    h.origin.closes_request = false;
    await closeLinkedOriginTask(pool, { originTaskId: 2086, mirroredStatus: 2, closedByUserId: 'u3', linkedRequestId: 10126 });
    expect(h.advanced).toBe(1);
    expect(h.closed).toEqual([]);
  });

  it('si la hija se canceló (3), no avanza ni cierra la madre', async () => {
    await closeLinkedOriginTask(pool, { originTaskId: 2086, mirroredStatus: 3, closedByUserId: 'u3', linkedRequestId: 10126 });
    expect(h.updates).toHaveLength(1);
    expect(h.advanced).toBe(0);
    expect(h.closed).toEqual([]);
  });

  it('tarea de origen ya cerrada: no hace nada', async () => {
    h.origin.id_status = 2;
    await closeLinkedOriginTask(pool, { originTaskId: 2086, mirroredStatus: 2, closedByUserId: 'u3', linkedRequestId: 10126 });
    expect(h.updates).toEqual([]);
    expect(h.closed).toEqual([]);
  });
});
