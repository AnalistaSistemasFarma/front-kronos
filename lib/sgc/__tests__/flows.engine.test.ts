import { describe, expect, it } from 'vitest';
import { normalizeFlowDefinition, type SgcFlowDefinition } from '../flows/definition';
import { SGC_DOCUMENT_FLOW_V1 } from '../flows/documentFlow';
import {
  assigneesInTurn,
  dueDate,
  evaluateCondition,
  firstTask,
  normalizeSigners,
  parseSigningModes,
  pickAssigneeForDecision,
  planSignerChange,
  resolveNextStep,
  sgcStatusColor,
  signingModeFor,
  taskOutcome,
  type SgcAssigneeState,
} from '../flows/engine';

/** Reglas de ejecución del motor de flujos validados (Sprint 2). */

const def = normalizeFlowDefinition(JSON.parse(JSON.stringify(SGC_DOCUMENT_FLOW_V1)));
const ctx = { requestType: 'nuevo', requiresTraining: true };
const a = (id: number, email: string | null, order: number, status: SgcAssigneeState['status'] = 'pendiente', pool: string | null = null): SgcAssigneeState => ({
  id,
  userEmail: email,
  poolTypeCode: pool,
  signOrder: order,
  status,
});

describe('SGC · motor de flujos: recorrido', () => {
  it('[SGC-REQ-027] recorre solicitud → elaboración → revisión → aprobación → divulgación → capacitación → completada', () => {
    expect(firstTask(def).key).toBe('solicitud');
    const path: string[] = [];
    let key = 'solicitud';
    for (;;) {
      const next = resolveNextStep(def, key, 'aprobar', ctx);
      if (next.kind === 'terminal') {
        path.push(next.status);
        break;
      }
      path.push(next.task.key);
      key = next.task.key;
    }
    expect(path).toEqual(['elaboracion', 'revision', 'aprobacion', 'divulgacion', 'capacitacion', 'completada']);
  });

  it('[SGC-REQ-031] devolver regresa a elaboración y cancelar cierra como cancelada; una acción no definida responde 409', () => {
    expect(resolveNextStep(def, 'revision', 'devolver', ctx)).toMatchObject({ kind: 'task', task: { key: 'elaboracion' } });
    expect(resolveNextStep(def, 'aprobacion', 'devolver', ctx)).toMatchObject({ kind: 'task', task: { key: 'elaboracion' } });
    expect(resolveNextStep(def, 'elaboracion', 'cancelar', ctx)).toEqual({ kind: 'terminal', status: 'cancelada' });
    expect(() => resolveNextStep(def, 'elaboracion', 'devolver', ctx)).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('[SGC-REQ-023] una tarea cuya condición no se cumple se salta siguiendo su «aprobar»', () => {
    const next = resolveNextStep(def, 'divulgacion', 'aprobar', { requestType: 'nuevo', requiresTraining: false });
    expect(next).toEqual({ kind: 'terminal', status: 'completada' });
    expect(evaluateCondition(null, ctx)).toBe(true);
    expect(evaluateCondition('solicitud_es_nueva', ctx)).toBe(true);
    expect(evaluateCondition('solicitud_sobre_documento', ctx)).toBe(false);
    expect(evaluateCondition('solicitud_sobre_documento', { ...ctx, requestType: 'modificacion' })).toBe(true);
    expect(evaluateCondition('desconocida' as never, ctx)).toBe(false);
  });

  it('[SGC-REQ-023] detecta definiciones rotas en ejecución (destino inexistente, salto sin aprobar, ciclo de condiciones)', () => {
    const broken: SgcFlowDefinition = JSON.parse(JSON.stringify(def));
    broken.transitions.find((t) => t.from === 'solicitud' && t.action === 'aprobar')!.to = 'nada';
    expect(() => resolveNextStep(broken, 'solicitud', 'aprobar', ctx)).toThrow(expect.objectContaining({ status: 500 }));

    const noSkip: SgcFlowDefinition = JSON.parse(JSON.stringify(def));
    noSkip.transitions = noSkip.transitions.filter((t) => t.from !== 'capacitacion');
    noSkip.tasks.find((t) => t.key === 'capacitacion')!.conditionKey = 'solicitud_sobre_documento';
    expect(() => resolveNextStep(noSkip, 'divulgacion', 'aprobar', ctx)).toThrow(/no tiene transición/);

    const cycle: SgcFlowDefinition = {
      tasks: [
        { ...def.tasks[0], key: 'x', stepOrder: 0 },
        { ...def.tasks[1], key: 'y', stepOrder: 1, conditionKey: 'solicitud_sobre_documento' },
      ],
      transitions: [
        { from: 'x', action: 'aprobar', to: 'y', terminalStatus: null },
        { from: 'y', action: 'aprobar', to: 'y', terminalStatus: null },
      ],
      formFields: [],
    };
    expect(() => resolveNextStep(cycle, 'x', 'aprobar', ctx)).toThrow(/ciclo/);
  });
});

describe('SGC · motor de flujos: firmas en orden o en paralelo', () => {
  const list = [a(1, 'r1@x.co', 1), a(2, 'r2@x.co', 2), a(3, null, 3, 'pendiente', 'SGC-VERIF-CALIDAD')];

  it('[SGC-REQ-029] en paralelo le toca a todos los pendientes; en orden, solo al primero', () => {
    expect(assigneesInTurn(list, 'paralelo').map((x) => x.id)).toEqual([1, 2, 3]);
    expect(assigneesInTurn(list, 'orden').map((x) => x.id)).toEqual([1]);
    expect(assigneesInTurn([a(1, 'r1@x.co', 1, 'aprobado'), ...list.slice(1)], 'orden').map((x) => x.id)).toEqual([2]);
    expect(assigneesInTurn(list, null).map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('[SGC-REQ-029] la tarea no avanza hasta que firmen todos los vigentes; una devolución la devuelve', () => {
    expect(taskOutcome([a(1, 'x', 1, 'aprobado'), a(2, 'y', 2)])).toBe('abierta');
    expect(taskOutcome([a(1, 'x', 1, 'aprobado'), a(2, 'y', 2, 'aprobado'), a(3, 'z', 3, 'reemplazado')])).toBe('resuelta');
    expect(taskOutcome([a(1, 'x', 1, 'aprobado'), a(2, 'y', 2, 'devuelto')])).toBe('devuelta');
    expect(taskOutcome([a(1, 'x', 1, 'anulado')])).toBe('abierta');
  });

  it('[SGC-REQ-029] en orden, quien no está en turno recibe 409; en paralelo decide de una vez', () => {
    const actor = { email: 'R2@x.co', poolTypeCodes: [] };
    expect(() => pickAssigneeForDecision(list, 'orden', actor, { elaboratorEmail: 'e@x.co', allowElaborator: false })).toThrow(expect.objectContaining({ status: 409 }));
    expect(pickAssigneeForDecision(list, 'paralelo', actor, { elaboratorEmail: 'e@x.co', allowElaborator: false }).id).toBe(2);
  });

  it('[SGC-REQ-033] un cupo de grupo lo toma cualquiera del grupo; si la persona tiene cupo propio y de grupo, primero el propio', () => {
    const calidad = { email: 'cal@x.co', poolTypeCodes: ['SGC-VERIF-CALIDAD'] };
    expect(pickAssigneeForDecision(list, 'paralelo', calidad, { elaboratorEmail: 'e@x.co', allowElaborator: false }).id).toBe(3);
    const both = [a(1, 'cal@x.co', 1), a(3, null, 2, 'pendiente', 'SGC-VERIF-CALIDAD')];
    expect(pickAssigneeForDecision(both, 'paralelo', calidad, { elaboratorEmail: 'e@x.co', allowElaborator: false }).id).toBe(1);
    expect(() => pickAssigneeForDecision(list, 'paralelo', { email: 'otro@x.co', poolTypeCodes: [] }, { elaboratorEmail: null, allowElaborator: false })).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });

  it('[SGC-REQ-030] el elaborador no revisa ni aprueba su propio documento (segregación de funciones)', () => {
    const own = [a(1, 'e@x.co', 1)];
    expect(() => pickAssigneeForDecision(own, 'paralelo', { email: 'e@x.co', poolTypeCodes: [] }, { elaboratorEmail: 'E@x.co', allowElaborator: false })).toThrow(/elaborador no puede/);
    expect(pickAssigneeForDecision(own, null, { email: 'e@x.co', poolTypeCodes: [] }, { elaboratorEmail: 'e@x.co', allowElaborator: true }).id).toBe(1);
  });
});

describe('SGC · motor de flujos: firmantes que asigna el elaborador', () => {
  const eligible = new Set(['r1@x.co', 'r2@x.co', 'e@x.co']);
  const opts = { stepName: 'Revisión', elaboratorEmail: 'e@x.co', eligibleEmails: eligible };

  it('[SGC-REQ-030] normaliza la lista (minúsculas, orden de elección) y valida permisos, repetidos y al elaborador', () => {
    expect(normalizeSigners([' R2@x.co ', { email: 'r1@x.co' }], opts)).toEqual([
      { email: 'r2@x.co', order: 1 },
      { email: 'r1@x.co', order: 2 },
    ]);
    expect(() => normalizeSigners([], opts)).toThrow(/al menos 1/);
    expect(() => normalizeSigners('x', opts)).toThrow(/al menos 1/);
    expect(() => normalizeSigners(['r1@x.co', 'r1@x.co'], opts)).toThrow(/repetido/);
    expect(() => normalizeSigners(['e@x.co'], opts)).toThrow(/elaborador no puede ser firmante/);
    expect(() => normalizeSigners(['nadie@x.co'], opts)).toThrow(/no tiene permiso/);
    expect(() => normalizeSigners(['r1@x.co', 'r2@x.co'], { ...opts, max: 1 })).toThrow(/máximo 1/);
  });

  it('[SGC-REQ-030] planifica altas, bajas y cambios de orden; quien ya decidió no se puede retirar', () => {
    const current = [
      { email: 'r1@x.co', order: 1, decided: false },
      { email: 'r2@x.co', order: 2, decided: true },
    ];
    expect(planSignerChange(current, [{ email: 'r2@x.co', order: 1 }, { email: 'r3@x.co', order: 2 }])).toEqual({
      add: [{ email: 'r3@x.co', order: 2 }],
      remove: ['r1@x.co'],
      reorder: [{ email: 'r2@x.co', order: 1 }],
      unchanged: false,
    });
    expect(planSignerChange(current, [{ email: 'r1@x.co', order: 1 }, { email: 'r2@x.co', order: 2 }]).unchanged).toBe(true);
    expect(() => planSignerChange(current, [{ email: 'r1@x.co', order: 1 }])).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('[SGC-REQ-029] el modo de firma se elige en cada documento (o se toma el de la definición)', () => {
    const revision = def.tasks.find((t) => t.key === 'revision')!;
    const elaboracion = def.tasks.find((t) => t.key === 'elaboracion')!;
    expect(signingModeFor(revision, {})).toBe('paralelo');
    expect(signingModeFor(revision, { revision: 'orden' })).toBe('orden');
    expect(signingModeFor(revision, { revision: 'otro' })).toBe('paralelo');
    expect(signingModeFor({ ...revision, signingModeDefault: null }, {})).toBe('paralelo');
    expect(signingModeFor(elaboracion, { elaboracion: 'orden' })).toBeNull();
    expect(parseSigningModes('{"revision":"orden","x":"raro"}')).toEqual({ revision: 'orden' });
    expect(parseSigningModes('[1]')).toEqual({});
    expect(parseSigningModes('no-json')).toEqual({});
    expect(parseSigningModes(null)).toEqual({});
  });
});

describe('SGC · motor de flujos: vocabulario idéntico a SynerLink', () => {
  it('[SGC-REQ-032] colores de estado como en SynerLink y fecha objetivo por días', () => {
    expect(['Sin Empezar', 'Abierto', 'Resuelto', 'En espera', 'Devuelto', 'Cancelado', undefined].map((s) => sgcStatusColor(s))).toEqual(['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'red']);
    const start = new Date('2026-10-01T00:00:00Z');
    expect(dueDate(start, 5)?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(dueDate(start, null)).toBeNull();
  });
});
