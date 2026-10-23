import { describe, expect, it } from 'vitest';
import { SAP_ACTIONS, actionsFor, getSapAction, triggersFor, validateTaskAction } from './catalog';

describe('catálogo de acciones SAP', () => {
  it('tiene claves únicas y cada acción con disparadores y mapeo', () => {
    const keys = SAP_ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of SAP_ACTIONS) {
      expect(a.triggers.length).toBeGreaterThan(0);
      expect(a.mapping.length).toBeGreaterThan(0);
    }
  });

  it('cubre los efectos SAP actuales de la autorización (LA, A, NAD, ENC)', () => {
    const states = SAP_ACTIONS.map((a) => a.resultingState).filter(Boolean);
    expect(states).toEqual(expect.arrayContaining(['LA', 'A', 'NAD', 'ENC']));
  });

  it('bloquea los campos de compatibilidad con SAPSEND', () => {
    const draft = getSapAction('purchase.create_draft')!;
    expect(draft.mapping.find((m) => m.target === 'U_SEND_UserId')?.editable).toBe(false);
    expect(draft.mapping.find((m) => m.target === 'Comments')?.editable).toBe(true);
  });
});

describe('validateTaskAction', () => {
  it('acepta una configuración válida', () => {
    expect(
      validateTaskAction({ taskKind: 'authorization', actionKey: 'purchase.publish_firm', trigger: 'on_final_approve' })
    ).toEqual([]);
  });

  it('rechaza acción inexistente, disparador o tipo de tarea no permitidos', () => {
    expect(validateTaskAction({ taskKind: 'normal', actionKey: 'sap.libre', trigger: 'on_execute' })[0]).toContain(
      'no existe'
    );
    const errs = validateTaskAction({ taskKind: 'normal', actionKey: 'purchase.state_rejected', trigger: 'on_start' });
    expect(errs).toHaveLength(2);
  });

  it('rechaza editar campos bloqueados o desconocidos del mapeo', () => {
    const errs = validateTaskAction({
      taskKind: 'sap_executor',
      actionKey: 'purchase.create_draft',
      trigger: 'on_execute',
      mapping: { Comments: 'Asunto', U_SEND_Dep: '10', Inventado: 'x' },
    });
    expect(errs).toHaveLength(3); // no disponible aún + campo bloqueado + campo inventado
    expect(errs.join(' ')).toContain('U_SEND_Dep');
    expect(errs.join(' ')).toContain('Inventado');
  });
});

describe('actionsFor / triggersFor', () => {
  it('ofrece solo acciones disponibles para el tipo y disparador', () => {
    expect(actionsFor('sap_executor', 'on_execute').map((a) => a.key)).toEqual([
      'purchase.state_to_authorize',
      'purchase.publish_firm',
    ]);
    expect(actionsFor('authorization', 'on_reject').map((a) => a.key)).toEqual(['purchase.state_rejected']);
    expect(triggersFor('normal')).toEqual([]);
  });
});
