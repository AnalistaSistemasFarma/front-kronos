import { describe, expect, it } from 'vitest';
import {
  emptySelection,
  linkedItems,
  requestItem,
  selectionPayload,
  setSelected,
  taskItem,
  workflowItem,
  type RequestRow,
  type TaskRow,
} from '../reassignmentBoard';
import { dedupeAssigneeRows, delegatedAssigneeApply, effectiveAssigneeSql } from '../reassignmentDelegation';

const flow = (id: number) =>
  workflowItem({ id, process: `Flujo ${id}`, category: 'Cat', active: true, assigned: ['A'], companies: ['C'], departments: ['D'] });

const request = (id: number, flowId: number | null) =>
  requestItem({ id, subject: `Sol ${id}`, company: 'C', process: `Flujo ${flowId}`, id_process_category: flowId } as RequestRow);

const task = (id: number) =>
  taskItem({ id, id_task: 1, task: 'T', id_request_general: 100, subject_request: 'S', company: 'C' } as TaskRow);

const universe = [flow(1), flow(2), request(10, 1), request(11, 1), request(20, 2), task(500)];

describe('selección unificada de solicitudes por flujo', () => {
  it('marcar una solicitud marca su flujo y todas las solicitudes del flujo', () => {
    const next = setSelected(emptySelection(), [request(10, 1)], true, universe);
    expect([...next.workflows]).toEqual([1]);
    expect([...next.requests].sort()).toEqual([10, 11]);
    expect(next.tasks.size).toBe(0);
  });

  it('marcar el flujo marca sus solicitudes', () => {
    const next = setSelected(emptySelection(), [flow(2)], true, universe);
    expect([...next.workflows]).toEqual([2]);
    expect([...next.requests]).toEqual([20]);
  });

  it('desmarcar una solicitud desmarca el flujo completo', () => {
    const all = setSelected(emptySelection(), [flow(1), flow(2)], true, universe);
    const next = setSelected(all, [request(11, 1)], false, universe);
    expect([...next.workflows]).toEqual([2]);
    expect([...next.requests]).toEqual([20]);
  });

  it('las tareas se marcan solas, sin arrastrar nada', () => {
    expect(linkedItems([task(500)], universe).map((i) => i.key)).toEqual(['tasks-500']);
    const next = setSelected(emptySelection(), [task(500)], true, universe);
    expect([...next.tasks]).toEqual([500]);
    expect(next.workflows.size + next.requests.size).toBe(0);
  });

  it('una solicitud sin flujo no arrastra otras', () => {
    const next = setSelected(emptySelection(), [request(99, null)], true, universe);
    expect([...next.requests]).toEqual([99]);
    expect(next.workflows.size).toBe(0);
  });

  it('el payload lleva flujos y solicitudes del mismo flujo', () => {
    const next = setSelected(emptySelection(), [request(10, 1)], true, universe);
    expect(selectionPayload(next)).toEqual({ workflowIds: [1], requestIds: expect.arrayContaining([10, 11]), taskIds: [] });
  });
});

describe('reglas de tareas futuras', () => {
  it('el responsable efectivo usa la regla y si no la plantilla', () => {
    expect(effectiveAssigneeSql('utrg.id_user')).toBe('COALESCE(dlg.id_user, utrg.id_user)');
    const apply = delegatedAssigneeApply('tpc.id', 'utrg.id_user');
    expect(apply).toContain("dlg_d.item_type = 'template_task'");
    expect(apply).toContain('dlg_d.id_item = tpc.id');
    expect(apply).toContain('dlg_d.users_before = utrg.id_user');
    expect(apply).toContain('dlg_d.returned = 0');
    expect(apply).toContain('dlg_u.isActive = 1');
    expect(apply).toMatch(/ORDER BY dlg_d\.id_reassignment DESC\s*\) dlg$/);
  });

  it('dos responsables redirigidos a la misma persona generan una sola tarea', () => {
    const rows = [
      { id_task: 1, id_user: 'B' },
      { id_task: 1, id_user: 'b' },
      { id_task: 1, id_user: 'C' },
      { id_task: 2, id_user: 'B' },
      { id_task: 3, id_user: null },
      { id_task: 3, id_user: null },
    ];
    expect(dedupeAssigneeRows(rows)).toEqual([
      { id_task: 1, id_user: 'B' },
      { id_task: 1, id_user: 'C' },
      { id_task: 2, id_user: 'B' },
      { id_task: 3, id_user: null },
      { id_task: 3, id_user: null },
    ]);
  });
});
