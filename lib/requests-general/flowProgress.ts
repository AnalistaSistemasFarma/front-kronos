/**
 * Flujo completo de una solicitud: TODAS las tareas de su proceso en orden (también las que
 * aún no existen, porque las secuenciales se crean recién cuando cierra la anterior), con el
 * estado de cada una. Sirve para la barra de avance de los listados y la secuencia del detalle.
 */

/** Tarea de la plantilla del proceso que aplica a esta solicitud (condiciones cumplidas). */
export type FlowTemplateTask = {
  id: number;
  task: string;
  displayOrder: number | null;
  isSequential: boolean;
};

/** Tarea ya creada en la solicitud (task_request_general). */
export type FlowTaskInstance = {
  idTask: number;
  task: string;
  displayOrder: number | null;
  idStatus: number | null;
  assigned: string | null;
};

export type FlowStepStatus = 'done' | 'current' | 'pending' | 'cancelled';

export type FlowStep = {
  key: string;
  name: string;
  status: FlowStepStatus;
  /** Responsables de las tareas ya creadas (vacío si aún no se crea). */
  assignees: string[];
  /** Instancias resueltas / creadas (p. ej. varias personas en la misma tarea). */
  doneCount: number;
  totalCount: number;
  sequential: boolean;
};

export type RequestFlow = {
  steps: FlowStep[];
  /** Pasos que cuentan para el avance (los cancelados no). */
  total: number;
  done: number;
  percent: number;
  /** Paso en el que va (1 = primero) y su nombre; null si terminó o no tiene pasos. */
  currentIndex: number | null;
  currentName: string | null;
};

const STATUS_RESOLVED = 2;
const STATUS_CANCELLED = 3;

function stepStatus(instances: FlowTaskInstance[]): FlowStepStatus {
  if (instances.length === 0) return 'pending';
  const open = instances.some((i) => i.idStatus !== STATUS_RESOLVED && i.idStatus !== STATUS_CANCELLED);
  if (open) return 'current';
  return instances.some((i) => i.idStatus === STATUS_RESOLVED) ? 'done' : 'cancelled';
}

function orderOf(displayOrder: number | null, id: number): [number, number] {
  return [displayOrder ?? 0, id];
}

function compareOrder(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * Une la plantilla (lo que falta) con lo creado (lo que va). Las tareas creadas que no están en
 * la plantilla (firmas de documentos, tareas de una versión anterior del flujo) también salen,
 * en su posición del orden.
 */
export function buildRequestFlow(template: FlowTemplateTask[], instances: FlowTaskInstance[]): RequestFlow {
  const byTask = new Map<number, FlowTaskInstance[]>();
  for (const inst of instances) {
    const list = byTask.get(inst.idTask) ?? [];
    list.push(inst);
    byTask.set(inst.idTask, list);
  }

  const entries: Array<{ order: [number, number]; step: FlowStep }> = [];
  const seen = new Set<number>();
  const toStep = (id: number, name: string, list: FlowTaskInstance[], sequential: boolean): FlowStep => ({
    key: `t-${id}`,
    name,
    status: stepStatus(list),
    assignees: Array.from(new Set(list.map((i) => String(i.assigned || '').trim()).filter(Boolean))),
    doneCount: list.filter((i) => i.idStatus === STATUS_RESOLVED).length,
    totalCount: list.length,
    sequential,
  });

  for (const t of template) {
    seen.add(t.id);
    entries.push({ order: orderOf(t.displayOrder, t.id), step: toStep(t.id, t.task, byTask.get(t.id) ?? [], t.isSequential) });
  }
  for (const [idTask, list] of byTask) {
    if (seen.has(idTask)) continue;
    const first = list[0]!;
    entries.push({ order: orderOf(first.displayOrder, idTask), step: toStep(idTask, first.task, list, false) });
  }
  entries.sort((a, b) => compareOrder(a.order, b.order));

  const steps = entries.map((e) => e.step);
  const counted = steps.filter((s) => s.status !== 'cancelled');
  const done = counted.filter((s) => s.status === 'done').length;
  const total = counted.length;
  // "Paso X de N" se cuenta sin los cancelados, igual que el total.
  const current = counted.find((s) => s.status === 'current') ?? counted.find((s) => s.status === 'pending') ?? null;
  return {
    steps,
    total,
    done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    currentIndex: current ? counted.indexOf(current) + 1 : null,
    currentName: current?.name ?? null,
  };
}
