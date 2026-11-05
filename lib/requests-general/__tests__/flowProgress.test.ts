import { describe, expect, it } from 'vitest';
import { buildRequestFlow, type FlowTaskInstance, type FlowTemplateTask } from '../flowProgress';

const tpl = (id: number, task: string, order: number, seq = true): FlowTemplateTask => ({
  id,
  task,
  displayOrder: order,
  isSequential: seq,
});
const inst = (idTask: number, task: string, order: number, idStatus: number, assigned = 'Ana'): FlowTaskInstance => ({
  idTask,
  task,
  displayOrder: order,
  idStatus,
  assigned,
});

const template = [tpl(10, 'Radicar', 1), tpl(11, 'Revisión jurídica', 2), tpl(12, 'Pago', 3)];

describe('flujo de la solicitud', () => {
  it('cuenta también las tareas que aún no se crean (secuenciales)', () => {
    const flow = buildRequestFlow(template, [inst(10, 'Radicar', 1, 2), inst(11, 'Revisión jurídica', 2, 4, 'Nicolás')]);
    expect(flow.steps.map((s) => s.status)).toEqual(['done', 'current', 'pending']);
    expect(flow).toMatchObject({ total: 3, done: 1, percent: 33, currentIndex: 2, currentName: 'Revisión jurídica' });
    expect(flow.steps[1]!.assignees).toEqual(['Nicolás']);
  });

  it('terminado: sin paso actual y 100 %', () => {
    const flow = buildRequestFlow(template, [
      inst(10, 'Radicar', 1, 2),
      inst(11, 'Revisión jurídica', 2, 2),
      inst(12, 'Pago', 3, 2),
    ]);
    expect(flow).toMatchObject({ done: 3, total: 3, percent: 100, currentIndex: null, currentName: null });
  });

  it('una tarea con varias personas sigue abierta hasta que todas resuelvan', () => {
    const flow = buildRequestFlow(template, [
      inst(10, 'Radicar', 1, 2, 'Ana'),
      inst(10, 'Radicar', 1, 4, 'Luis'),
    ]);
    expect(flow.steps[0]).toMatchObject({ status: 'current', doneCount: 1, totalCount: 2 });
  });

  it('las canceladas no cuentan en el avance; las creadas fuera de la plantilla salen en su orden', () => {
    const flow = buildRequestFlow(template, [
      inst(10, 'Radicar', 1, 3),
      inst(99, 'Ajuste extra', 2, 4),
    ]);
    expect(flow.steps.map((s) => s.name)).toEqual(['Radicar', 'Revisión jurídica', 'Ajuste extra', 'Pago']);
    expect(flow.steps[0]!.status).toBe('cancelled');
    expect(flow).toMatchObject({ total: 3, done: 0, currentIndex: 2, currentName: 'Ajuste extra' });
  });

  it('sin plantilla ni tareas: vacío', () => {
    expect(buildRequestFlow([], [])).toMatchObject({ steps: [], total: 0, percent: 0, currentIndex: null });
  });
});
