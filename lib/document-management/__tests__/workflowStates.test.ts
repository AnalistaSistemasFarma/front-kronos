import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_WORKFLOW_STATES,
  INITIAL_STATE,
  CLOSED_STATES,
  isClosedState,
  getAvailableActions,
  findAction,
  isValidTransition,
  STATE_DISPLAY_ORDER,
  WORKFLOW_ACTIONS,
} from '../workflowStates';

// Pruebas unitarias PURAS (sin BD) del grafo de transiciones de los 14 estados
// documentales. Objetivo: que cualquier cambio futuro al grafo sea explícito y
// no rompa por accidente los caminos que ya validamos con Nicolás.

describe('DOCUMENT_WORKFLOW_STATES', () => {
  it('contiene exactamente los 14 estados literales, sin duplicados', () => {
    expect(DOCUMENT_WORKFLOW_STATES).toHaveLength(14);
    expect(new Set(DOCUMENT_WORKFLOW_STATES).size).toBe(14);
  });

  it('incluye los 14 nombres exactos definidos por el negocio', () => {
    const expected = [
      'En creación',
      'En elaboración',
      'En revisión',
      'En aprobación',
      'Aprobado',
      'En divulgación',
      'Vigente',
      'Reasignación',
      'Reelaboración',
      'Rechazado',
      'Obsoleto',
      'Anulado',
      'Visto bueno calidad',
      'Eliminado',
    ];
    expect([...DOCUMENT_WORKFLOW_STATES].sort()).toEqual([...expected].sort());
  });

  it('asigna un display_order único 0..13 a cada estado', () => {
    const orders = DOCUMENT_WORKFLOW_STATES.map((s) => STATE_DISPLAY_ORDER[s]);
    expect(new Set(orders).size).toBe(14);
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(13);
  });
});

describe('INITIAL_STATE', () => {
  it('es "En creación"', () => {
    expect(INITIAL_STATE).toBe('En creación');
  });
});

describe('CLOSED_STATES / isClosedState', () => {
  it('marca Rechazado, Obsoleto, Anulado y Eliminado como cerrados', () => {
    expect(CLOSED_STATES).toEqual(
      expect.arrayContaining(['Rechazado', 'Obsoleto', 'Anulado', 'Eliminado'])
    );
    for (const s of CLOSED_STATES) expect(isClosedState(s)).toBe(true);
  });

  it('NO marca Vigente como cerrado (admite anular / marcar_obsoleto)', () => {
    expect(isClosedState('Vigente')).toBe(false);
  });

  it('los estados cerrados no tienen ninguna acción de salida en el grafo', () => {
    for (const s of CLOSED_STATES) {
      expect(getAvailableActions(s)).toHaveLength(0);
    }
  });
});

describe('getAvailableActions / findAction', () => {
  it('desde "En creación" solo permite iniciar_elaboracion, anular y eliminar', () => {
    const actions = getAvailableActions('En creación').map((a) => a.action);
    expect(new Set(actions)).toEqual(new Set(['iniciar_elaboracion', 'anular', 'eliminar']));
  });

  it('desde "En revisión" permite aprobar, pedir ajustes, rechazar o reasignar', () => {
    const actions = getAvailableActions('En revisión').map((a) => a.action);
    expect(new Set(actions)).toEqual(
      new Set(['aprobar_revision', 'solicitar_ajustes', 'rechazar', 'reasignar', 'anular'])
    );
  });

  it('el rechazo en revisión y en aprobación exige motivo (requiresReason)', () => {
    expect(findAction('En revisión', 'rechazar')?.requiresReason).toBe(true);
    expect(findAction('En aprobación', 'rechazar')?.requiresReason).toBe(true);
  });

  it('findAction devuelve undefined para una acción que no aplica desde ese estado', () => {
    expect(findAction('Vigente', 'aprobar_revision')).toBeUndefined();
  });

  it('un estado sin acciones definidas devuelve un arreglo vacío', () => {
    expect(getAvailableActions('Obsoleto')).toEqual([]);
  });
});

describe('isValidTransition', () => {
  it('valida una transición correcta', () => {
    expect(isValidTransition('En creación', 'iniciar_elaboracion', 'En elaboración')).toBe(true);
  });

  it('rechaza una transición con destino incorrecto', () => {
    expect(isValidTransition('En creación', 'iniciar_elaboracion', 'Vigente')).toBe(false);
  });

  it('rechaza una acción inexistente desde ese estado', () => {
    expect(isValidTransition('Vigente', 'rechazar', 'Rechazado')).toBe(false);
  });
});

describe('Ciclo de reelaboración (rechazo -> reelaboración -> elaboración)', () => {
  it('solicitar_ajustes en revisión lleva a Reelaboración, y desde ahí se retoma en En elaboración', () => {
    expect(isValidTransition('En revisión', 'solicitar_ajustes', 'Reelaboración')).toBe(true);
    expect(isValidTransition('Reelaboración', 'reanudar_elaboracion', 'En elaboración')).toBe(true);
  });
});

describe('Camino feliz completo hasta Vigente', () => {
  it('recorre los 7 estados de la ruta principal con una acción válida en cada paso', () => {
    const happyPath: Array<[string, string, string]> = [
      ['En creación', 'iniciar_elaboracion', 'En elaboración'],
      ['En elaboración', 'enviar_a_revision', 'En revisión'],
      ['En revisión', 'aprobar_revision', 'En aprobación'],
      ['En aprobación', 'aprobar', 'Visto bueno calidad'],
      ['Visto bueno calidad', 'aprobar_calidad', 'Aprobado'],
      ['Aprobado', 'iniciar_divulgacion', 'En divulgación'],
      ['En divulgación', 'publicar_vigente', 'Vigente'],
    ];
    for (const [from, action, to] of happyPath) {
      expect(isValidTransition(from, action, to)).toBe(true);
    }
  });
});

describe('Anular es un escape global salvo desde estados ya cerrados', () => {
  it('todo estado no cerrado (excepto Vigente ya cubierto aparte) admite anular', () => {
    const nonClosed = DOCUMENT_WORKFLOW_STATES.filter((s) => !isClosedState(s));
    for (const s of nonClosed) {
      expect(findAction(s, 'anular')).toBeDefined();
    }
  });
});

describe('Cada WORKFLOW_ACTIONS tiene from/to válidos dentro del catálogo de estados', () => {
  it('from y to de cada acción pertenecen a DOCUMENT_WORKFLOW_STATES', () => {
    const valid = new Set(DOCUMENT_WORKFLOW_STATES);
    for (const def of WORKFLOW_ACTIONS) {
      expect(valid.has(def.from)).toBe(true);
      expect(valid.has(def.to)).toBe(true);
    }
  });
});
