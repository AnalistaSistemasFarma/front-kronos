import { describe, expect, it } from 'vitest';
import { describeDefinitionChanges, normalizeFlowDefinition, requiredAuthorizationTypes, type SgcFlowDefinition } from '../flows/definition';
import { SGC_AUTH_TYPE_APPROVAL, SGC_AUTH_TYPE_QUALITY, SGC_DOCUMENT_FLOW_V1, isSgcDocumentRequestType } from '../flows/documentFlow';

/** Motor genérico de flujos validados — validación de definiciones (Sprint 2). */

const clone = (d: SgcFlowDefinition): SgcFlowDefinition => JSON.parse(JSON.stringify(d));
const minimal = () => ({
  tasks: [
    { key: 'inicio', name: 'Inicio', stepOrder: 0, role: 'solicitante', assignment: 'solicitante' },
    { key: 'fin', name: 'Fin', stepOrder: 1, role: 'elaborador', assignment: 'elaborador' },
  ],
  transitions: [
    { from: 'inicio', action: 'aprobar', to: 'fin' },
    { from: 'fin', action: 'aprobar', terminalStatus: 'completada' },
  ],
  formFields: [],
});

describe('SGC · definición de flujos validados', () => {
  it('[SGC-REQ-027] el flujo documental v1 es válido: 6 pasos, divulgación y capacitación en espera (S4), capacitación condicionada al tipo', () => {
    const def = normalizeFlowDefinition(clone(SGC_DOCUMENT_FLOW_V1));
    expect(def.tasks.map((t) => t.key)).toEqual(['solicitud', 'elaboracion', 'revision', 'aprobacion', 'divulgacion', 'capacitacion']);
    expect(def.tasks.filter((t) => !t.isEnabled).map((t) => t.key)).toEqual(['divulgacion', 'capacitacion']);
    const aprobacion = def.tasks.find((t) => t.key === 'aprobacion')!;
    expect(aprobacion).toMatchObject({ multiAssignee: true, signingModeDefault: 'orden', signatureMeaning: 'aprobo', isAuthorization: true, poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY });
    expect(def.tasks.find((t) => t.key === 'revision')).toMatchObject({ multiAssignee: true, signingModeDefault: 'paralelo', signatureMeaning: 'reviso' });
    expect(def.tasks.find((t) => t.key === 'capacitacion')?.conditionKey).toBe('tipo_exige_capacitacion');
    expect(requiredAuthorizationTypes(def)).toEqual([SGC_AUTH_TYPE_APPROVAL, SGC_AUTH_TYPE_QUALITY].sort());
    // Devolver, reasignar y cancelar son acciones: devolver solo va a elaboración.
    expect(def.transitions.filter((t) => t.action === 'devolver').every((t) => t.to === 'elaboracion')).toBe(true);
    expect(isSgcDocumentRequestType('nueva_version')).toBe(true);
    expect(isSgcDocumentRequestType('anulacion')).toBe(false);
  });

  it('[SGC-REQ-023] ordena las tareas, normaliza campos y deja fuera el tipo de autorización si la tarea no es de autorización', () => {
    const raw = minimal();
    raw.tasks.reverse();
    const def = normalizeFlowDefinition({
      ...raw,
      tasks: raw.tasks.map((t) => ({ ...t, authorizationTypeCode: 'X-Y' })),
      formFields: [
        { key: 'bb', label: 'B', type: 'seleccion', options: ['uno', 'uno', ' dos ', ''], sortOrder: 2 },
        { key: 'aa', label: 'A', type: 'texto', taskKey: 'fin', sortOrder: 1, helpText: 'ayuda' },
      ],
    });
    expect(def.tasks.map((t) => t.key)).toEqual(['inicio', 'fin']);
    expect(def.tasks.every((t) => t.authorizationTypeCode === null && t.isEnabled)).toBe(true);
    expect(def.formFields.map((f) => f.key)).toEqual(['aa', 'bb']);
    expect(def.formFields[1].options).toEqual(['uno', 'dos']);
    expect(def.formFields[0]).toMatchObject({ taskKey: 'fin', helpText: 'ayuda', options: [] });
  });

  const invalid: [string, (d: ReturnType<typeof minimal>) => unknown, RegExp][] = [
    ['sin tareas', (d) => ({ ...d, tasks: [] }), /al menos una tarea/],
    ['no es objeto', () => null, /inválida/],
    ['clave inválida', (d) => (d.tasks[1].key = 'Fin X', d), /minúsculas/],
    ['clave repetida', (d) => (d.tasks[1].key = 'inicio', d), /repetida/],
    ['orden repetido', (d) => (d.tasks[1].stepOrder = 0, d), /Orden de tarea repetido/],
    ['rol inválido', (d) => ((d.tasks[1] as Record<string, unknown>).role = 'jefe', d), /rol/],
    ['nombre vacío', (d) => (d.tasks[1].name = ' ', d), /nombre es obligatorio/],
    ['orden fuera de rango', (d) => (d.tasks[1].stepOrder = 200, d), /orden/],
    ['primera tarea de firmantes', (d) => Object.assign(d.tasks[0], { assignment: 'firmantes', multiAssignee: true, signingModeDefault: 'orden' }) && d, /primera tarea/],
    ['primera tarea con condición', (d) => Object.assign(d.tasks[0], { conditionKey: 'solicitud_es_nueva' }) && d, /no puede tener condición/],
    ['varios sin firmantes', (d) => Object.assign(d.tasks[1], { multiAssignee: true }) && d, /varios responsables solo aplica/],
    ['firmantes sin varios', (d) => Object.assign(d.tasks[1], { assignment: 'firmantes' }) && d, /admite varios responsables/],
    ['firmantes sin modo', (d) => Object.assign(d.tasks[1], { assignment: 'firmantes', multiAssignee: true }) && d, /modo de firma/],
    ['autorización sin tipo', (d) => Object.assign(d.tasks[1], { isAuthorization: true }) && d, /tipo de autorización/],
    ['calidad sin grupo', (d) => Object.assign(d.tasks[1], { assignment: 'calidad' }) && d, /grupo de Calidad/],
    ['código de tipo inválido', (d) => Object.assign(d.tasks[1], { poolAuthorizationTypeCode: '1x' }) && d, /código de tipo/],
    ['origen inexistente', (d) => (d.transitions.push({ from: 'otra', action: 'cancelar', terminalStatus: 'cancelada' } as never), d), /origen "otra" no existe/],
    ['sin destino ni cierre', (d) => (d.transitions[0] = { from: 'inicio', action: 'aprobar' } as never, d), /destino o el cierre/],
    ['destino y cierre', (d) => (d.transitions[0] = { from: 'inicio', action: 'aprobar', to: 'fin', terminalStatus: 'completada' } as never, d), /no ambas/],
    ['destino inexistente', (d) => (d.transitions[0] = { from: 'inicio', action: 'aprobar', to: 'nada' } as never, d), /destino "nada" no existe/],
    ['a sí misma', (d) => (d.transitions.push({ from: 'fin', action: 'devolver', to: 'fin' } as never), d), /a sí misma/],
    ['devolver sin destino', (d) => (d.transitions.push({ from: 'fin', action: 'devolver', terminalStatus: 'cancelada' } as never), d), /tarea anterior regresa/],
    ['devolver hacia adelante', (d) => (d.transitions.push({ from: 'inicio', action: 'devolver', to: 'fin' } as never), d), /solo se puede devolver/],
    ['aprobar hacia atrás', (d) => (d.transitions[1] = { from: 'fin', action: 'aprobar', to: 'inicio' } as never, d), /avanza a una tarea posterior/],
    ['aprobar cancela', (d) => (d.transitions[1] = { from: 'fin', action: 'aprobar', terminalStatus: 'cancelada' } as never, d), /no puede cancelar/],
    ['cancelar a una tarea', (d) => (d.transitions.push({ from: 'inicio', action: 'cancelar', to: 'fin' } as never), d), /cierra la solicitud como cancelada/],
    ['transición repetida', (d) => (d.transitions.push({ from: 'inicio', action: 'aprobar', to: 'fin' } as never), d), /ya existe una transición/],
    ['tarea sin aprobar', (d) => (d.transitions.pop(), d), /no tiene transición "aprobar"/],
    ['acción inválida', (d) => (d.transitions.push({ from: 'inicio', action: 'saltar', to: 'fin' } as never), d), /acción/],
    ['campo con tarea inexistente', (d) => ({ ...d, formFields: [{ key: 'x', label: 'X', type: 'texto', taskKey: 'nada' }] }), /tarea "nada" no existe/],
    ['lista con una opción', (d) => ({ ...d, formFields: [{ key: 'x', label: 'X', type: 'seleccion', options: ['a'] }] }), /al menos 2 opciones/],
    ['opción larga', (d) => ({ ...d, formFields: [{ key: 'x', label: 'X', type: 'seleccion', options: ['a', 'b'.repeat(151)] }] }), /150 caracteres/],
    ['campo repetido', (d) => ({ ...d, formFields: [{ key: 'xx', label: 'X', type: 'texto' }, { key: 'xx', label: 'Y', type: 'numero' }] }), /ya existe en ese formulario/],
    ['demasiadas tareas', (d) => ({ ...d, tasks: Array.from({ length: 31 }, (_, i) => ({ ...d.tasks[0], key: `t${i}x`, stepOrder: i })) }), /máximo 30 tareas/],
    ['demasiados campos', (d) => ({ ...d, formFields: Array.from({ length: 61 }, (_, i) => ({ key: `c${i}x`, label: 'c', type: 'texto' })) }), /máximo 60 campos/],
    ['descripción larga', (d) => Object.assign(d.tasks[1], { description: 'x'.repeat(1001) }) && d, /1000 caracteres/],
  ];
  it.each(invalid)('[SGC-REQ-023] rechaza una definición inválida: %s', (_name, mutate, message) => {
    expect(() => normalizeFlowDefinition(mutate(minimal()))).toThrow(message);
  });

  it('[SGC-REQ-023] exige que aprobar en orden llegue a un cierre «completada» (sin ciclos)', () => {
    const d = minimal();
    d.tasks.push({ key: 'extra', name: 'Extra', stepOrder: 2, role: 'revisor', assignment: 'elaborador' });
    d.transitions[1] = { from: 'fin', action: 'aprobar', to: 'extra' } as never;
    d.transitions.push({ from: 'extra', action: 'cancelar', terminalStatus: 'cancelada' } as never);
    expect(() => normalizeFlowDefinition(d)).toThrow(/no tiene transición "aprobar"/);
    d.transitions.push({ from: 'extra', action: 'aprobar', terminalStatus: 'completada' } as never);
    expect(normalizeFlowDefinition(d).tasks).toHaveLength(3);
  });

  it('[SGC-REQ-026] describe los cambios entre versiones (tareas, transiciones y campos) para el registro de cambios', () => {
    const before = normalizeFlowDefinition(clone(SGC_DOCUMENT_FLOW_V1));
    expect(describeDefinitionChanges(null, before)[0]).toMatch(/Definición inicial con 6 tareas/);
    expect(describeDefinitionChanges(before, before)).toEqual(['Sin cambios en la definición.']);
    const after = clone(before);
    after.tasks.find((t) => t.key === 'revision')!.targetDays = 3;
    after.tasks = after.tasks.filter((t) => t.key !== 'capacitacion');
    after.tasks.push({ ...after.tasks[1], key: 'verificacion', name: 'Verificación', stepOrder: 9 });
    after.transitions = after.transitions.filter((t) => t.from !== 'capacitacion');
    after.transitions.push({ from: 'verificacion', action: 'aprobar', to: null, terminalStatus: 'completada' });
    after.formFields[0].label = 'Referencia CC';
    after.formFields = after.formFields.filter((f) => f.key !== 'urgencia');
    after.formFields.push({ taskKey: null, key: 'nuevo', label: 'Nuevo', type: 'texto', required: false, options: [], helpText: null, sortOrder: 9 });
    const changes = describeDefinitionChanges(before, after).join('\n');
    expect(changes).toContain('Tarea Revisión (revision) cambió: targetDays');
    expect(changes).toContain('Tarea retirada: Capacitación (capacitacion)');
    expect(changes).toContain('Tarea agregada: Verificación (verificacion)');
    expect(changes).toContain('Transición agregada: verificacion:aprobar->completada');
    expect(changes).toContain('Transición retirada: capacitacion:aprobar->completada');
    expect(changes).toContain('Campo Referencia CC (solicitud.referencia_cambio) cambió');
    expect(changes).toContain('Campo retirado: Prioridad (solicitud.urgencia)');
    expect(changes).toContain('Campo agregado: Nuevo (solicitud.nuevo)');
  });
});
